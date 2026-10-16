/**
 * The readers one edited source makes of its plan (ADR-0051, ADR-0052): each
 * stream's content, an asset's file, generated silence, a later stream
 * converted to another rate, a mix of later streams (ADR-0072) and a
 * stream's processing, each made once, on the first read that needs it, and
 * released with the source.
 *
 * A processed stream is read from its render where the reading has a cache of
 * renders and the stream is one it would otherwise run from its start, or one a
 * preview cannot run as it is heard (`cached-streams.ts`), and through a run of
 * its own otherwise (`processed-content.ts`); a stream a spectral edit changes
 * likewise (`spectral-content.ts`). The chains are kept as they stand, so a
 * numeric parameter changed while the sound plays reaches the run of the stream
 * it names, and every run made after it (`running-parameters.ts`).
 *
 * A reading goes on with a plan that continues its own (ADR-0104): each reader
 * whose state was made from nothing the new plan reads differently keeps it, a
 * chain's run and a conversion's resampler among them, and reads the new
 * segments from then on; every other reader is let go, to be made afresh by the
 * next read that needs it (`reader-continuation.ts` says which). So a stream
 * that sounds as it did until a change goes on through the change without a
 * seam, its filters, delays and resamplers carried over.
 */

import {
  FailureKind,
  channelCount,
  failure,
  fail,
  findSlot,
  processorsOf,
  streamChain,
  succeed,
  withSlotReplaced,
  type AssetId,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type EditPlan,
  type EffectChain,
  type PlanSource,
  type PlanStream,
  type PlannedSpectralEdit,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { resamplingQualityOf } from '../dsp/resampling-grade.js';
import { CachedContent } from './cached-content.js';
import { MixedContent } from './mixed-content.js';
import {
  ConvertedContent,
  FileContent,
  MediaReadFailure,
  SilentContent,
  StreamContent,
  streamAsSource,
  type ContentReader,
  type MediaEntry,
  type ProcessedOutput,
  type ReadableContent,
  type StreamOutput,
} from './plan-content.js';
import { ProcessedContent, ProcessedStart, type PlanProcessing } from './processed-content.js';
import { continueReaders, conversionKey, type MadeReaders } from './reader-continuation.js';
import { resampledSource } from './resampled-source.js';
import type { ParameterChange, ParameterTarget } from './running-parameters.js';
import { SpectralContent } from './spectral-content.js';
import { StretchedContent } from './stretched-content.js';
import type { WindowSource } from '../spectral/forward-window.js';

/** The chain of each stream processed by one, as `plan` states it, by place. */
function chainsOf(plan: EditPlan): Map<number, EffectChain> {
  const chains = new Map<number, EffectChain>();
  plan.streams.forEach((stream, place) => {
    // A spectral edit's chain runs inside its frames, so a parameter changed
    // while it plays is heard once the plan is read again.
    const run = streamChain(stream.processing);
    if (run?.kind === 'chain') chains.set(place, run.chain);
  });
  return chains;
}

/** Whether `chain` runs the processor `change` names. */
function runs(chain: EffectChain, change: ParameterChange): boolean {
  for (const processor of processorsOf(chain.slots)) {
    if (processor.id === change.processor) return true;
  }
  return false;
}

/** `chain` with the parameter `change` names set to its value. */
function withChange(chain: EffectChain, change: ParameterChange): EffectChain {
  const found = findSlot(chain, change.processor);
  if (found?.slot.kind !== 'processor') return chain;
  const values = new Map(found.slot.values).set(change.parameter, change.value);
  return withSlotReplaced(chain, { ...found.slot, values }) ?? chain;
}

/**
 * The readers one edited source makes, each made once on the first read that
 * needs it and released with the source: a stream's content, an asset's file,
 * a converted stream and a mix, by where the plan names them.
 */
export class PlanReaders implements ParameterTarget {
  #plan: EditPlan;
  #media: readonly MediaEntry[];
  #entries: ReadonlyMap<AssetId, MediaEntry>;
  readonly #dsp: CanonicalDsp;
  readonly #processing: PlanProcessing;
  /**
   * The readers made, by what they read: each stream's content and output, the
   * runs of the chains this reading runs itself, each conversion by place and
   * rate, each file, and each distinct mix by the places it sums in their
   * order, which holds only the streams' outputs, so nothing releases it.
   */
  readonly #readers: MadeReaders = {
    streams: new Map(),
    outputs: new Map(),
    runs: new Map(),
    converted: new Map(),
    files: new Map(),
    mixes: new Map(),
  };
  /** The chain each processed stream runs, with the parameters changed while it plays. */
  #chains: Map<number, EffectChain>;
  /** Generated silence, by its channel count; it holds nothing, so nothing releases it. */
  readonly #silences = new Map<number, SilentContent>();
  #made: ContentReader[] = [];

  constructor(
    plan: EditPlan,
    media: readonly MediaEntry[],
    dsp: CanonicalDsp,
    processing: PlanProcessing,
  ) {
    this.#plan = plan;
    this.#media = media;
    this.#entries = new Map(media.map((entry) => [entry.asset, entry]));
    this.#dsp = dsp;
    this.#processing = processing;
    this.#chains = chainsOf(plan);
  }

  /**
   * Reads `plan`, which continues the plan read so far, from the next read on,
   * from the files `media` names, against which `plan` was validated. Called
   * between reads. Each reader whose state the new plan leaves as it was is
   * kept, reading the new plan's segments from now on; every other reader is
   * let go, and made again by the next read that needs it.
   */
  continueWith(plan: EditPlan, media: readonly MediaEntry[]): void {
    const entries = new Map(media.map((entry) => [entry.asset, entry]));
    const released = continueReaders(
      this.#readers,
      { before: this.#plan, after: plan },
      { before: this.#entries, after: entries },
      (place) => this.#chains.get(place),
    );
    this.#made = this.#made.filter((reader) => !released.has(reader));
    this.#plan = plan;
    this.#media = media;
    this.#entries = entries;
    this.#chains = chainsOf(plan);
  }

  /** The content of the plan's stream at `place`. */
  stream(place: number): StreamContent {
    const known = this.#readers.streams.get(place);
    if (known !== undefined) return known;
    const stream = this.#streamAt(place);
    const content = new StreamContent(stream, (source) => this.#reader(source, stream.sampleRate));
    this.#readers.streams.set(place, content);
    return content;
  }

  /**
   * What the stream at `place` makes at its own rate: its segments, or what
   * its processing makes of them (`processed-content.ts`), read from a render
   * where the reading has one to read.
   */
  output(place: number): StreamOutput {
    const known = this.#readers.outputs.get(place);
    if (known !== undefined) return known;
    const stream = this.#streamAt(place);
    const content = this.stream(place);
    const { processing } = stream;
    let output: StreamContent | ProcessedOutput;
    if (processing === undefined) {
      output = content;
    } else if (processing.kind === 'chain') {
      output = this.#processed(place, stream, processing.input, content);
    } else if (processing.kind === 'spectral') {
      output = this.#spectral(place, stream, processing.edit, content);
    } else {
      output = this.#stretched(content, stream, processing.length);
    }
    this.#readers.outputs.set(place, output);
    return output;
  }

  /**
   * Takes a parameter changed while the sound plays into the chain of the
   * stream it names, where that chain runs the processor, or refuses it where
   * the chain is heard from a render, which was made with the value it had.
   */
  setParameter(change: ParameterChange): DomainResult<boolean> {
    const place = change.stream;
    const chain = this.#chains.get(place);
    if (chain === undefined || !runs(chain, change)) return succeed(false);
    if (this.#rendered(place, chain).kind === 'rendered') {
      return fail(
        failure(
          'playback.parameter-rendered',
          FailureKind.Rejected,
          'That processor is heard from a render made with the value it had, so the render must be made again.',
        ),
      );
    }
    const changed = withChange(chain, change);
    const taken =
      this.#readers.runs.get(place)?.setParameter(changed, change) ?? succeed(undefined);
    if (!taken.ok) return taken;
    this.#chains.set(place, changed);
    return succeed(true);
  }

  release(): void {
    for (const reader of this.#made) reader.release();
  }

  #streamAt(place: number): PlanStream {
    const stream = this.#plan.streams[place];
    if (stream === undefined) throw new Error('A validated plan names only streams it has.');
    return stream;
  }

  #reader(source: PlanSource, rate: SampleRate): ReadableContent {
    if (source.kind === 'media') return this.#file(source.asset);
    if (source.kind === 'silence') return this.#silence(source.channels);
    if (source.kind === 'mix') return this.#mix(source.streams);
    return this.#streamAt(source.stream).sampleRate === rate
      ? this.output(source.stream)
      : this.#convert(source.stream, rate);
  }

  /**
   * Whether the chain at `place` is heard from a render, and why: every chain
   * a reading from the stream's start runs, where it has a cache of renders;
   * and every chain a preview cannot run as it is heard, whether or not a
   * render is kept, since running it again means every whole pass made again.
   */
  #rendered(
    place: number,
    chain: EffectChain,
  ): { readonly kind: 'run' } | { readonly kind: 'rendered'; readonly reason?: string } {
    const { start, cached, processing, quality } = this.#processing;
    if (start === ProcessedStart.Canonical) {
      return cached === undefined ? { kind: 'run' } : { kind: 'rendered' };
    }
    const stream = this.#streamAt(place);
    const listening = processing.listening({
      chain,
      input: streamChain(stream.processing)?.input ?? stream.layout,
      sampleRate: stream.sampleRate,
      quality,
    });
    // A chain that cannot run at all is run, and fails its first read with the reason.
    return listening.ok && listening.value.kind === 'rendered'
      ? { kind: 'rendered', reason: listening.value.reason }
      : { kind: 'run' };
  }

  /** The stream at `place` heard through its chain, from a render or a run of its own. */
  #processed(
    place: number,
    stream: PlanStream,
    layout: ChannelLayout,
    content: StreamContent,
  ): ProcessedOutput {
    const chain = this.#chains.get(place);
    if (chain === undefined) throw new Error('A processed stream has its chain.');
    const input = {
      layout,
      sampleRate: stream.sampleRate,
      // Read as the run goes, since a continued plan may lengthen the stream.
      get length() {
        return content.length;
      },
      read: (
        start: number,
        frames: number,
        into: readonly Float32Array[],
        signal?: CancellationSignal,
      ) => content.read(start, frames, into, signal),
    };
    // The chain as it stands when the run is made, which a parameter changed
    // while the sound played before this stream was first read has changed.
    const own = (): ProcessedContent => {
      const run = new ProcessedContent(this.#chains.get(place) ?? chain, input, stream.layout, {
        ...this.#processing,
        dsp: this.#dsp,
      });
      this.#readers.runs.set(place, run);
      return run;
    };
    const { cached, quality } = this.#processing;
    const heard = this.#rendered(place, chain);
    if (cached === undefined || heard.kind === 'run') {
      const run = own();
      this.#made.push(run);
      return run;
    }
    const rendered = new CachedContent(
      cached.open({
        plan: this.#plan,
        place,
        media: this.#media,
        quality,
        ...(heard.reason === undefined ? {} : { reason: heard.reason }),
      }),
      { channels: channelCount(stream.layout), length: content.length },
      own,
    );
    this.#made.push(rendered);
    return rendered;
  }

  #file(asset: AssetId): FileContent {
    const known = this.#readers.files.get(asset);
    if (known !== undefined) return known;
    const entry = this.#entries.get(asset);
    if (entry === undefined) throw new Error('A validated plan reads only the files it was given.');
    const file = new FileContent(entry);
    this.#readers.files.set(asset, file);
    this.#made.push(file);
    return file;
  }

  #silence(channels: number): SilentContent {
    const known = this.#silences.get(channels);
    if (known !== undefined) return known;
    const silence = new SilentContent(channels);
    this.#silences.set(channels, silence);
    return silence;
  }

  /**
   * The streams at `places` summed in their order. Validation made each one
   * of the reading stream's rate, so each is read as its own output.
   */
  #mix(places: readonly number[]): MixedContent {
    const key = places.join(',');
    const known = this.#readers.mixes.get(key);
    if (known !== undefined) return known;
    const [first, ...rest] = places.map((place) => this.output(place));
    if (first === undefined) throw new Error('A validated mix sums two or more streams.');
    const mix = new MixedContent(first, rest);
    this.#readers.mixes.set(key, mix);
    return mix;
  }

  /**
   * The stream changed by a spectral edit (`spectral-content.ts`), from a
   * render where the reading would hear it so, and through a realisation of
   * its own otherwise. A `process` edit's chain is run over the stream's
   * segments inside it, as its plan states the chain, so a parameter changed
   * while the sound plays is heard once the project's plan is read again.
   */
  #spectral(
    place: number,
    stream: PlanStream,
    edit: PlannedSpectralEdit,
    content: StreamContent,
  ): ProcessedOutput {
    const settings = { quality: this.#processing.quality, dsp: this.#dsp };
    const { operation } = edit;
    const wet =
      operation.kind === 'process'
        ? (input: WindowSource & { readonly length: number }) =>
            new ProcessedContent(
              operation.chain,
              {
                layout: operation.input,
                sampleRate: stream.sampleRate,
                length: input.length,
                read: (start, frames, into, signal) => input.read(start, frames, into, signal),
              },
              stream.layout,
              { ...this.#processing, dsp: this.#dsp },
            )
        : undefined;
    const own = (): SpectralContent =>
      new SpectralContent(content, stream, content.length, edit, settings, wet);
    const { cached, quality } = this.#processing;
    const heard = this.#spectralHeard(stream, edit);
    if (cached === undefined || heard.kind === 'run') {
      const run = own();
      this.#made.push(run);
      return run;
    }
    const rendered = new CachedContent(
      cached.open({
        plan: this.#plan,
        place,
        media: this.#media,
        quality,
        ...(heard.reason === undefined ? {} : { reason: heard.reason }),
      }),
      { channels: channelCount(stream.layout), length: content.length },
      own,
    );
    this.#made.push(rendered);
    return rendered;
  }

  /**
   * Whether a spectral stream is heard from a render, as a chain's is
   * (`#rendered`): from the stream's start wherever a cache is kept; for a
   * preview, only where its `process` chain cannot run as it is heard, since
   * every other operation is realised from any point at any time.
   */
  #spectralHeard(
    stream: PlanStream,
    edit: PlannedSpectralEdit,
  ): { readonly kind: 'run' } | { readonly kind: 'rendered'; readonly reason?: string } {
    const { start, cached, processing, quality } = this.#processing;
    if (start === ProcessedStart.Canonical) {
      return cached === undefined ? { kind: 'run' } : { kind: 'rendered' };
    }
    const { operation } = edit;
    if (operation.kind !== 'process') return { kind: 'run' };
    const listening = processing.listening({
      chain: operation.chain,
      input: operation.input,
      sampleRate: stream.sampleRate,
      quality,
    });
    return listening.ok && listening.value.kind === 'rendered'
      ? { kind: 'rendered', reason: listening.value.reason }
      : { kind: 'run' };
  }

  /** The stream's segments made `length` frames long (`stretched-content.ts`). */
  #stretched(content: StreamContent, stream: PlanStream, length: number): ProcessedOutput {
    const stretched = new StretchedContent(content, stream, length, {
      quality: this.#processing.quality,
      dsp: this.#dsp,
      start: this.#processing.start,
    });
    this.#made.push(stretched);
    return stretched;
  }

  #convert(place: number, rate: SampleRate): ConvertedContent {
    const key = conversionKey(place, rate);
    const known = this.#readers.converted.get(key);
    if (known !== undefined) return known;
    const resampled = resampledSource(
      this.#dsp,
      streamAsSource(() => this.output(place), this.#streamAt(place)),
      rate,
      resamplingQualityOf(this.#processing.quality.resampling),
    );
    if (!resampled.ok) throw new MediaReadFailure(resampled.failures[0]);
    const reader = new ConvertedContent(resampled.value);
    this.#readers.converted.set(key, reader);
    this.#made.push(reader);
    return reader;
  }
}
