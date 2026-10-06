/**
 * An edited sound as a source: its edit plan read on demand from the files of
 * the assets it names (ADR-0051, ADR-0052).
 *
 * Each read asks only for the frames it needs: every segment it covers reads
 * its range of content, from an asset's file through the read contract or
 * from a later stream of the plan through the canonical resampler, turns it
 * round where the segment is reversed, and passes it through the segment's
 * stages by the domain's own arithmetic (`applyStages`), so the feeder, the
 * render worker and the peak worker hear and draw one sound, bit for bit. No
 * file is held whole, and no rate changes except where a stream says so. The
 * reader of each kind of content is in `plan-content.ts`.
 *
 * Those readers keep state between reads, a processed stream's run among
 * them, and are reached only through the source made here, so its reads take
 * turns (`read-turns.ts`): two readers of one source, as the peak worker's
 * build and a view's request are, each hear what a reader alone would.
 */

import {
  FailureKind,
  channelCount,
  discreteLayout,
  failure,
  fail,
  sampleCount,
  streamLength,
  succeed,
  validatePlan,
  type AssetId,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type EditPlan,
  type MediaShape,
  type PlanSource,
  type PlanStream,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { resamplingQualityOf } from '../dsp/resampling-grade.js';
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
import { ProcessedContent, type PlanProcessing } from './processed-content.js';
import { ReadTurns } from './read-turns.js';
import { resampledSource } from './resampled-source.js';
import { StretchedContent } from './stretched-content.js';

/** What a stream of the plan makes, at its own rate and in its own layout. */
interface StreamOutput extends ReadableContent {
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

/**
 * The readers one edited source makes, each made once on the first read that
 * needs it and released with the source: a stream's content, an asset's file
 * and a converted stream, by where the plan names them.
 */
class PlanReaders {
  readonly #plan: EditPlan;
  readonly #entries: ReadonlyMap<AssetId, MediaEntry>;
  readonly #dsp: CanonicalDsp;
  readonly #processing: PlanProcessing;
  readonly #streams = new Map<number, StreamContent>();
  readonly #outputs = new Map<number, StreamOutput>();
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
    this.#entries = new Map(media.map((entry) => [entry.asset, entry]));
    this.#dsp = dsp;
    this.#processing = processing;
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
      ? this.#output(source.stream)
      : this.#convert(source.stream, rate);
  }

  /**
   * What the stream at `place` makes at its own rate: its segments, or what
   * its processing makes of them (`processed-content.ts`).
   */
  #output(place: number): StreamOutput {
    const known = this.#outputs.get(place);
    if (known !== undefined) return known;
    const stream = this.#streamAt(place);
    const content = this.stream(place);
    const { processing } = stream;
    let output: StreamOutput;
    if (processing === undefined) {
      output = content;
    } else if (processing.kind === 'chain') {
      const input = {
        layout: processing.input,
        sampleRate: stream.sampleRate,
        length: content.length,
        read: (
          start: number,
          frames: number,
          into: readonly Float32Array[],
          signal?: CancellationSignal,
        ) => content.read(start, frames, into, signal),
      };
      const processed = new ProcessedContent(processing.chain, input, stream.layout, {
        ...this.#processing,
        dsp: this.#dsp,
      });
      this.#made.push(processed);
      output = processed;
    } else {
      output = this.#stretched(content, stream, processing.length);
    }
    this.#outputs.set(place, output);
    return output;
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
      streamSource(this.#output(place), this.#streamAt(place)),
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

/** What a plan may read of each file, as its asset recorded it. */
function mediaShapes(media: readonly MediaEntry[]): DomainResult<ReadonlyMap<AssetId, MediaShape>> {
  const shapes = new Map<AssetId, MediaShape>();
  for (const entry of media) {
    const layout = discreteLayout(entry.channels);
    if (!layout.ok) return layout;
    shapes.set(entry.asset, {
      sampleRate: entry.sampleRate,
      channelLayout: layout.value,
      length: entry.length,
    });
  }
  return succeed(shapes);
}

/**
 * The plan's sound as a source read in `layout`, which must have its first
 * stream's channels, from the files `media` names, converting with `dsp`.
 */
export function editedSource(
  plan: EditPlan,
  media: readonly MediaEntry[],
  layout: ChannelLayout,
  dsp: CanonicalDsp,
  processing: PlanProcessing,
): DomainResult<PcmSource> {
  const shapes = mediaShapes(media);
  if (!shapes.ok) return shapes;
  const valid = validatePlan(plan, shapes.value);
  if (!valid.ok) return valid;
  const [first] = plan.streams;
  if (channelCount(layout) !== channelCount(first.layout)) {
    return fail(
      failure(
        'pcm.edited-layout-mismatch',
        FailureKind.Rejected,
        'An edited sound is read in a layout of its own channels.',
      ),
    );
  }
  const length = sampleCount(streamLength(first));
  if (!length.ok) return length;
  const readers = new PlanReaders(plan, media, dsp, processing);
  const sound = readers.stream(0);
  // Every reader the plan makes keeps state between reads (`read-turns.ts`).
  const turns = new ReadTurns();
  return succeed({
    layout,
    sampleRate: first.sampleRate,
    length: length.value,
    read: (start, into, signal) =>
      turns.take(async () => {
        assertReadableInto({ layout, sampleRate: first.sampleRate }, into);
        const count = framesAvailable(length.value, start, into.frames);
        await sound.read(start, count, into.channels, signal);
        return count;
      }, signal),
    release: () => {
      readers.release();
    },
  });
}
