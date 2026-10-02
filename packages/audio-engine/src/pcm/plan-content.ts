/**
 * Where an edited sound's content comes from, block by block: an asset's file
 * read through the read contract, one stream of a plan read segment by segment
 * through its stages, or a later stream heard converted to another rate
 * (ADR-0051, ADR-0052).
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
  failure,
  placeOf,
  sampleCount,
  sliceSegment,
  type AssetId,
  type DomainFailure,
  type PlanSource,
  type PlanStream,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import { throwIfCancelled, type CancellationSignal } from '../cancellation.js';
import { mediaBytes, type MediaFile } from './media-file.js';
import type { PcmSource } from './pcm-source.js';

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
export interface ContentReader {
  readonly channels: number;
  read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void>;
  release(): void;
}

/** Reads an asset's file through the read contract, opened when first needed. */
export class FileContent implements ContentReader {
  readonly channels: number;
  readonly #entry: MediaEntry;
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
    const reader = await (this.#reader ??= this.#open(signal));
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
export class StreamContent {
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
  readonly #source: PcmSource;

  constructor(source: PcmSource) {
    this.#source = source;
    this.channels = channelCount(source.layout);
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
