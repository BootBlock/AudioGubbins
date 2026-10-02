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
 * file is held whole, and no rate changes except where a stream says so.
 *
 * A file opens on the first read that needs it, and is refused there if it no
 * longer has the rate, channels or length its asset recorded, since that is a
 * different file and its frames would land in the wrong place.
 */

import { openAudio, type AudioReader } from '@audiogubbins/codecs';
import {
  FailureKind,
  applyStages,
  channelCount,
  discreteLayout,
  failure,
  fail,
  sampleCount,
  streamLength,
  succeed,
  validatePlan,
  type AssetId,
  type ChannelLayout,
  type DomainFailure,
  type DomainResult,
  type EditPlan,
  type MediaShape,
  type PlanSource,
  type PlanStream,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { throwIfCancelled, type CancellationSignal } from '../cancellation.js';
import { ResamplingQuality, type CanonicalDsp } from '../dsp/canonical-dsp.js';
import { mediaBytes, type MediaFile } from './media-file.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';
import { resampledSource } from './resampled-source.js';

/** An asset a plan reads, as recorded in the project, and the file behind it. */
export interface MediaEntry {
  readonly asset: AssetId;
  readonly sampleRate: SampleRate;
  readonly channels: number;
  readonly length: SampleCount;
  readonly file: MediaFile;
}

/**
 * Why an edited source could not read a file: a failure of the read contract,
 * or a file that is no longer the one its asset recorded.
 */
export class MediaReadFailure extends Error {
  readonly failure: DomainFailure;

  constructor(problem: DomainFailure) {
    super(problem.summary);
    this.name = 'MediaReadFailure';
    this.failure = problem;
  }
}

/** Where a block of content comes from: an asset's file, or a converted stream. */
interface ContentReader {
  readonly channels: number;
  read(start: number, frames: number, into: readonly Float32Array[], signal?: CancellationSignal): Promise<void>;
  release(): void;
}

/** Reads an asset's file through the read contract, opened when first needed. */
class FileContent implements ContentReader {
  readonly channels: number;
  readonly #entry: MediaEntry;
  #reader: Promise<AudioReader> | undefined;

  constructor(entry: MediaEntry) {
    this.#entry = entry;
    this.channels = entry.channels;
  }

  async read(start: number, frames: number, into: readonly Float32Array[], signal?: CancellationSignal): Promise<void> {
    const reader = await (this.#reader ??= this.#open(signal));
    const position = sampleCount(start);
    if (!position.ok) throw new MediaReadFailure(position.failures[0]);
    const read = await reader.read(position.value, frames, into, signal);
    if (!read.ok) throw new MediaReadFailure(read.failures[0]);
    if (read.value < frames) {
      throw new MediaReadFailure(
        failure('media.shorter', FailureKind.Unrecoverable, 'The file holds less audio than its asset recorded.'),
      );
    }
  }

  async #open(signal?: CancellationSignal): Promise<AudioReader> {
    const opened = await openAudio(mediaBytes(this.#entry.file), signal);
    if (!opened.ok) throw new MediaReadFailure(opened.failures[0]);
    const { format } = opened.value;
    if (
      format.sampleRate !== this.#entry.sampleRate ||
      format.channelCount !== this.channels ||
      format.frames < this.#entry.length
    ) {
      throw new MediaReadFailure(
        failure(
          'media.not-recorded-file',
          FailureKind.Unrecoverable,
          'The file no longer has the rate, channels or length its asset recorded.',
        ),
      );
    }
    return opened.value;
  }

  release(): void {
    this.#reader = undefined;
  }
}

/** One stream of a plan, read segment by segment. */
class StreamContent {
  readonly channels: number;
  readonly length: number;
  readonly #stream: PlanStream;
  readonly #starts: readonly number[];
  readonly #sources: (source: PlanSource) => ContentReader;
  readonly #scratch = new Map<number, Float32Array[]>();

  constructor(stream: PlanStream, sources: (source: PlanSource) => ContentReader) {
    this.#stream = stream;
    this.#sources = sources;
    this.channels = channelCount(stream.layout);
    let position = 0;
    this.#starts = stream.segments.map((segment) => {
      const start = position;
      position += segment.length;
      return start;
    });
    this.length = position;
  }

  /** The index of the segment holding frame `position`. */
  #segmentAt(position: number): number {
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((this.#starts[middle] ?? 0) <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  /** Arrays of `count` channels for content of up to `frames`, kept between reads. */
  #scratchFor(count: number, frames: number): readonly Float32Array[] {
    let arrays = this.#scratch.get(count);
    if (arrays === undefined || (arrays[0]?.length ?? 0) < frames) {
      arrays = Array.from({ length: count }, () => new Float32Array(frames));
      this.#scratch.set(count, arrays);
    }
    return arrays.map((array) => array.subarray(0, frames));
  }

  async read(start: number, frames: number, into: readonly Float32Array[], signal?: CancellationSignal): Promise<void> {
    let written = 0;
    for (let index = this.#segmentAt(start); written < frames && index < this.#starts.length; index += 1) {
      throwIfCancelled(signal);
      const segment = this.#stream.segments[index];
      const segmentStart = this.#starts[index];
      if (segment === undefined || segmentStart === undefined) break;
      const offset = start + written - segmentStart;
      const count = Math.min(segment.length - offset, frames - written);
      const contentStart = segment.reversed ? segment.start + segment.length - offset - count : segment.start + offset;
      const source = this.#sources(segment.source);
      const content = this.#scratchFor(source.channels, count);
      await source.read(contentStart, count, content, signal);
      if (segment.reversed) for (const channel of content) channel.reverse();
      const result = applyStages(
        segment.stages,
        {
          first: segment.reversed ? contentStart + count - 1 : contentStart,
          step: segment.reversed ? -1 : 1,
          frames: count,
        },
        content,
      );
      result.forEach((channel, which) => into[which]?.set(channel, written));
      written += count;
    }
  }
}

/** A stream heard at another rate: a later stream of the plan, converted. */
class ConvertedContent implements ContentReader {
  readonly channels: number;
  readonly #source: PcmSource;

  constructor(source: PcmSource) {
    this.#source = source;
    this.channels = channelCount(source.layout);
  }

  async read(start: number, frames: number, into: readonly Float32Array[], signal?: CancellationSignal): Promise<void> {
    const position = sampleCount(start);
    if (!position.ok) throw new MediaReadFailure(position.failures[0]);
    const block = { layout: this.#source.layout, sampleRate: this.#source.sampleRate, frames, channels: into };
    const read = await this.#source.read(position.value, block, signal);
    if (read < frames) {
      throw new MediaReadFailure(
        failure('media.stream-short', FailureKind.Unrecoverable, 'A converted stream ended before its segment.'),
      );
    }
  }

  release(): void {
    this.#source.release();
  }
}

/** A stream of the plan as a source at its own rate and layout. */
function streamSource(content: StreamContent, stream: PlanStream): PcmSource {
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
 * The plan's sound as a source read in `layout`, which must have its first
 * stream's channels, from the files `media` names, converting with `dsp`.
 */
export function editedSource(
  plan: EditPlan,
  media: readonly MediaEntry[],
  layout: ChannelLayout,
  dsp: CanonicalDsp,
): DomainResult<PcmSource> {
  const entries = new Map(media.map((entry) => [entry.asset, entry]));
  const shapes = new Map<AssetId, MediaShape>();
  for (const entry of media) {
    const layout = discreteLayout(entry.channels);
    if (!layout.ok) return layout;
    shapes.set(entry.asset, { sampleRate: entry.sampleRate, channelLayout: layout.value, length: entry.length });
  }
  const valid = validatePlan(plan, shapes);
  if (!valid.ok) return valid;
  const [first] = plan.streams;
  if (channelCount(layout) !== channelCount(first.layout)) {
    return fail(
      failure('pcm.edited-layout-mismatch', FailureKind.Rejected, 'An edited sound is read in a layout of its own channels.'),
    );
  }
  const made: ContentReader[] = [];
  const streams = new Map<number, StreamContent>();
  const files = new Map<AssetId, FileContent>();
  const contentOf = (place: number): StreamContent => {
    const known = streams.get(place);
    if (known !== undefined) return known;
    const stream = plan.streams[place] ?? first;
    const content = new StreamContent(stream, (source) => readerOf(source, stream.sampleRate));
    streams.set(place, content);
    return content;
  };
  const converted = new Map<number, ConvertedContent>();
  const readerOf = (source: PlanSource, rate: SampleRate): ContentReader => {
    if (source.kind === 'media') {
      let file = files.get(source.asset);
      const entry = entries.get(source.asset);
      if (file === undefined && entry !== undefined) {
        file = new FileContent(entry);
        files.set(source.asset, file);
        made.push(file);
      }
      if (file === undefined) throw new Error('A validated plan reads only the files it was given.');
      return file;
    }
    const known = converted.get(source.stream);
    if (known !== undefined) return known;
    const stream = plan.streams[source.stream] ?? first;
    const resampled = resampledSource(dsp, streamSource(contentOf(source.stream), stream), rate, ResamplingQuality.Maximum);
    if (!resampled.ok) throw new MediaReadFailure(resampled.failures[0]);
    const reader = new ConvertedContent(resampled.value);
    converted.set(source.stream, reader);
    made.push(reader);
    return reader;
  };
  const sound = contentOf(0);
  const length = sampleCount(streamLength(first));
  if (!length.ok) return length;
  return succeed({
    layout,
    sampleRate: first.sampleRate,
    length: length.value,
    read: async (start, into, signal) => {
      assertReadableInto({ layout, sampleRate: first.sampleRate }, into);
      const count = framesAvailable(length.value, start, into.frames);
      await sound.read(start, count, into.channels, signal);
      return count;
    },
    release: () => {
      for (const reader of made) reader.release();
    },
  });
}
