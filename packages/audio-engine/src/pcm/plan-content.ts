/**
 * Where an edited sound's content comes from, block by block: an asset's file
 * read through the read contract, generated silence, one stream of a plan read
 * segment by segment through its stages, or a later stream heard converted to
 * another rate (ADR-0051, ADR-0052).
 *
 * A file opens on the first read that needs it, and is refused there if it no
 * longer has the rate, channels or length its asset recorded, since that is a
 * different file and its frames would land in the wrong place. It opens for
 * the reader's life rather than that one read's, so a read cancelled while the
 * file opens leaves it opening for the next; an opening that failed is tried
 * again by the next read, since what failed may have passed.
 */

import { openAudio, type AudioReader } from '@audiogubbins/codecs';
import {
  FailureKind,
  applyStages,
  channelCount,
  createCancellationSource,
  failure,
  placeOf,
  sampleCount,
  sliceSegment,
  throwIfCancelled,
  type AssetId,
  type CancellationSignal,
  type DomainFailure,
  type PlanSource,
  type PlanStream,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { mediaBytes, type MediaFile } from './media-file.js';
import { assertReadableInto, framesAvailable, type PcmSource } from './pcm-source.js';
import type { ResampledSource } from './resampled-source.js';

/** An asset a plan reads, as recorded in the project, and the file behind it. */
export interface MediaEntry {
  readonly asset: AssetId;
  /**
   * What the file's content is known by, as the project records where it is
   * kept: two entries of one identity hold the same audio, which is how a
   * cached render of a sound is found again (`cached-stream-key.ts`).
   */
  readonly identity: string;
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

/** Content a stream's segment reads: a file, another stream, or either converted or processed. */
export interface ReadableContent {
  readonly channels: number;
  read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void>;
}

/** Content that holds what it opened until it is released: a file, a conversion, a run. */
export interface ContentReader extends ReadableContent {
  release(): void;
}

/** What a stream of a plan makes, at its own rate and in its own layout. */
export interface StreamOutput extends ReadableContent {
  readonly length: number;
}

/** What a processed stream makes: a reader of its own, which holds state until released. */
export type ProcessedOutput = StreamOutput & ContentReader;

/** Frames as a count, which every position and length of a validated plan is. */
export function framesOf(frames: number): SampleCount {
  const count = sampleCount(frames);
  if (!count.ok) throw new Error(count.failures[0].summary);
  return count.value;
}

/**
 * What `stream` makes, `output`, as a source at its rate and in its layout,
 * found at each read, so the output a continued plan has for it is the one
 * read.
 */
export function streamAsSource(output: () => StreamOutput, stream: PlanStream): PcmSource {
  return {
    layout: stream.layout,
    sampleRate: stream.sampleRate,
    get length() {
      return framesOf(output().length);
    },
    read: async (start, into, signal) => {
      assertReadableInto({ layout: stream.layout, sampleRate: stream.sampleRate }, into);
      const content = output();
      const count = framesAvailable(framesOf(content.length), start, into.frames);
      await content.read(start, count, into.channels, signal);
      return count;
    },
    release: () => undefined,
  };
}

/** Reads an asset's file through the read contract, opened when first needed. */
export class FileContent implements ContentReader {
  readonly channels: number;
  readonly #entry: MediaEntry;
  readonly #lifetime = createCancellationSource();
  #reader: Promise<AudioReader> | undefined;

  constructor(entry: MediaEntry) {
    this.#entry = entry;
    this.channels = entry.channels;
  }

  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    const reader = await this.#opened();
    throwIfCancelled(signal);
    const position = sampleCount(start);
    if (!position.ok) throw new MediaReadFailure(position.failures[0]);
    const read = await reader.read(position.value, frames, into, signal);
    if (!read.ok) throw new MediaReadFailure(read.failures[0]);
    if (read.value < frames) {
      throw new MediaReadFailure(
        failure(
          'media.shorter',
          FailureKind.Unrecoverable,
          'The file holds less audio than its asset recorded.',
        ),
      );
    }
  }

  /** The file opened, or opening, for the reader's life (see the module comment). */
  #opened(): Promise<AudioReader> {
    if (this.#reader !== undefined) return this.#reader;
    const opening = this.#open(this.#lifetime.signal);
    this.#reader = opening;
    opening.then(undefined, () => {
      if (this.#reader === opening) this.#reader = undefined;
    });
    return opening;
  }

  async #open(signal: CancellationSignal): Promise<AudioReader> {
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
    this.#lifetime.cancel();
    this.#reader = undefined;
  }
}

/** Generated silence: digital zero on every channel, at whatever frame is read. */
export class SilentContent implements ReadableContent {
  readonly channels: number;

  constructor(channels: number) {
    this.channels = channels;
  }

  read(
    _start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    throwIfCancelled(signal);
    // The arrays are a stream's scratch, which holds the last segment read.
    for (const channel of into) channel.fill(0, 0, frames);
    return Promise.resolve();
  }
}

/**
 * One stream of a plan, read segment by segment. It keeps nothing between reads
 * but scratch, so a plan continued with new segments for the stream
 * (`reader-continuation.ts`) gives them to it in place, and whatever reads it
 * reads them from then on.
 */
export class StreamContent {
  readonly channels: number;
  #stream: PlanStream;
  #starts: readonly number[] = [];
  #length = 0;
  readonly #sources: (source: PlanSource) => ReadableContent;
  readonly #scratch = new Map<number, Float32Array[]>();

  constructor(stream: PlanStream, sources: (source: PlanSource) => ReadableContent) {
    this.#stream = stream;
    this.#sources = sources;
    this.channels = channelCount(stream.layout);
    this.redefine(stream);
  }

  get length(): number {
    return this.#length;
  }

  /** Reads `stream`'s segments from now on: the stream as a continued plan states it, of the same channels. */
  redefine(stream: PlanStream): void {
    let position = 0;
    this.#starts = stream.segments.map((segment) => {
      const start = position;
      position += segment.length;
      return start;
    });
    this.#stream = stream;
    this.#length = position;
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

  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    let written = 0;
    for (
      let index = this.#segmentAt(start);
      written < frames && index < this.#starts.length;
      index += 1
    ) {
      throwIfCancelled(signal);
      const segment = this.#stream.segments[index];
      const segmentStart = this.#starts[index];
      if (segment === undefined || segmentStart === undefined) break;
      const offset = start + written - segmentStart;
      const count = Math.min(segment.length - offset, frames - written);
      const part = sliceSegment(segment, offset, count);
      const source = this.#sources(part.source);
      const content = this.#scratchFor(source.channels, count);
      await source.read(part.start, count, content, signal);
      if (part.reversed) for (const channel of content) channel.reverse();
      const result = applyStages(part.stages, placeOf(part), content);
      result.forEach((channel, which) => into[which]?.set(channel, written));
      written += count;
    }
  }
}

/** A stream heard at another rate: a later stream of the plan, converted. */
export class ConvertedContent implements ContentReader {
  readonly channels: number;
  readonly #source: ResampledSource;

  constructor(source: ResampledSource) {
    this.#source = source;
    this.channels = channelCount(source.layout);
  }

  /** Frames of the stream the resampler needs past an output frame's position. */
  get lookahead(): number {
    return this.#source.lookahead;
  }

  /** How far into the stream the resampler's state reaches (`resampled-source.ts`). */
  get consumedTo(): number | undefined {
    return this.#source.consumedTo;
  }

  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    const position = sampleCount(start);
    if (!position.ok) throw new MediaReadFailure(position.failures[0]);
    const block = {
      layout: this.#source.layout,
      sampleRate: this.#source.sampleRate,
      frames,
      channels: into,
    };
    const read = await this.#source.read(position.value, block, signal);
    if (read < frames) {
      throw new MediaReadFailure(
        failure(
          'media.stream-short',
          FailureKind.Unrecoverable,
          'A converted stream ended before its segment.',
        ),
      );
    }
  }

  release(): void {
    this.#source.release();
  }
}
