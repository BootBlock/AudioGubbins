/**
 * The readers one edited source makes of its plan (ADR-0051, ADR-0052): each
 * stream's content, an asset's file, a later stream converted to another
 * rate, and a stream's processing, each made once, on the first read that
 * needs it, and released with the source.
 *
 * A processed stream is read from its render where the reading has a cache
 * of renders and the stream is one it would otherwise run from its start, or
 * one a preview cannot run as it is heard (`cached-streams.ts`), and through
 * a run of its own otherwise (`processed-content.ts`). The chains are kept
 * as they stand, so a numeric parameter changed while the sound plays
 * reaches the run of each chain that holds the processor, and every run made
 * after it (`running-parameters.ts`).
 */

import {
  FailureKind,
  channelCount,
  failure,
  fail,
  findSlot,
  processorsOf,
  sampleCount,
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
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { resamplingQualityOf } from '../dsp/resampling-grade.js';
import { CachedContent } from './cached-content.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';
import {
  ConvertedContent,
  FileContent,
  MediaReadFailure,
  StreamContent,
  type ContentReader,
  type MediaEntry,
  type ReadableContent,
} from './plan-content.js';
import { ProcessedContent, ProcessedStart, type PlanProcessing } from './processed-content.js';
import { resampledSource } from './resampled-source.js';
import type { ParameterChange, ParameterTarget } from './running-parameters.js';
import { StretchedContent } from './stretched-content.js';

/** What a stream of the plan makes, at its own rate and in its own layout. */
export interface StreamOutput extends ReadableContent {
  readonly length: number;
}

/** A stream of the plan as a source at its own rate and layout. */
function streamSource(content: StreamOutput, stream: PlanStream): PcmSource {
  const length = sampleCount(content.length);
  return {
    layout: stream.layout,
    sampleRate: stream.sampleRate,
    length: length.ok ? length.value : undefined,
    read: async (start, into, signal) => {
      assertReadableInto({ layout: stream.layout, sampleRate: stream.sampleRate }, into);
      const count = framesAvailable(length.ok ? length.value : undefined, start, into.frames);
      await content.read(start, count, into.channels, signal);
      return count;
    },
    release: () => undefined,
  };
}

/** The chain that processes `stream`, where it has one. */
function chainOf(stream: PlanStream): EffectChain | undefined {
  return stream.processing?.kind === 'chain' ? stream.processing.chain : undefined;
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
 * needs it and released with the source: a stream's content, an asset's file
 * and a converted stream, by where the plan names them.
 */
export class PlanReaders implements ParameterTarget {
  readonly #plan: EditPlan;
  readonly #media: readonly MediaEntry[];
  readonly #entries: ReadonlyMap<AssetId, MediaEntry>;
  readonly #dsp: CanonicalDsp;
  readonly #processing: PlanProcessing;
  readonly #streams = new Map<number, StreamContent>();
  readonly #outputs = new Map<number, StreamOutput>();
  /** The chain each processed stream runs, with the parameters changed while it plays. */
  readonly #chains = new Map<number, EffectChain>();
  /** The runs of the processed streams this reading runs itself, by place. */
  readonly #runs = new Map<number, ProcessedContent>();
  readonly #files = new Map<AssetId, FileContent>();
  readonly #converted = new Map<number, ConvertedContent>();
  readonly #made: ContentReader[] = [];

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
    plan.streams.forEach((stream, place) => {
      const chain = chainOf(stream);
      if (chain !== undefined) this.#chains.set(place, chain);
    });
  }

  /** The content of the plan's stream at `place`. */
  stream(place: number): StreamContent {
    const known = this.#streams.get(place);
    if (known !== undefined) return known;
    const stream = this.#streamAt(place);
    const content = new StreamContent(stream, (source) => this.#reader(source, stream.sampleRate));
    this.#streams.set(place, content);
    return content;
  }

  /**
   * What the stream at `place` makes at its own rate: its segments, or what
   * its processing makes of them (`processed-content.ts`), read from a render
   * where the reading has one to read.
   */
  output(place: number): StreamOutput {
    const known = this.#outputs.get(place);
    if (known !== undefined) return known;
    const stream = this.#streamAt(place);
    const content = this.stream(place);
    const { processing } = stream;
    let output: StreamOutput;
    if (processing === undefined) {
      output = content;
    } else if (processing.kind === 'chain') {
      output = this.#processed(place, stream, processing.input, content);
    } else {
      output = this.#stretched(content, stream, processing.length);
    }
    this.#outputs.set(place, output);
    return output;
  }

  /**
   * Takes a parameter changed while the sound plays into every chain that
   * runs the processor, or refuses it where a chain is heard from a render,
   * which was made with the value it had.
   */
  setParameter(change: ParameterChange): DomainResult<boolean> {
    let held = false;
    for (const [place, chain] of this.#chains) {
      if (!runs(chain, change)) continue;
      held = true;
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
      const taken = this.#runs.get(place)?.setParameter(changed, change) ?? succeed(undefined);
      if (!taken.ok) return taken;
      this.#chains.set(place, changed);
    }
    return succeed(held);
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
      input: stream.processing?.kind === 'chain' ? stream.processing.input : stream.layout,
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
  ): StreamOutput {
    const chain = this.#chains.get(place);
    if (chain === undefined) throw new Error('A processed stream has its chain.');
    const input = {
      layout,
      sampleRate: stream.sampleRate,
      length: content.length,
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
      this.#runs.set(place, run);
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
    const known = this.#files.get(asset);
    if (known !== undefined) return known;
    const entry = this.#entries.get(asset);
    if (entry === undefined) throw new Error('A validated plan reads only the files it was given.');
    const file = new FileContent(entry);
    this.#files.set(asset, file);
    this.#made.push(file);
    return file;
  }

  /** The stream's segments made `length` frames long (`stretched-content.ts`). */
  #stretched(content: StreamContent, stream: PlanStream, length: number): StreamOutput {
    const stretched = new StretchedContent(content, stream, length, {
      quality: this.#processing.quality,
      dsp: this.#dsp,
      start: this.#processing.start,
    });
    this.#made.push(stretched);
    return stretched;
  }

  #convert(place: number, rate: SampleRate): ConvertedContent {
    const known = this.#converted.get(place);
    if (known !== undefined) return known;
    const resampled = resampledSource(
      this.#dsp,
      streamSource(this.output(place), this.#streamAt(place)),
      rate,
      resamplingQualityOf(this.#processing.quality.resampling),
    );
    if (!resampled.ok) throw new MediaReadFailure(resampled.failures[0]);
    const reader = new ConvertedContent(resampled.value);
    this.#converted.set(place, reader);
    this.#made.push(reader);
    return reader;
  }
}
