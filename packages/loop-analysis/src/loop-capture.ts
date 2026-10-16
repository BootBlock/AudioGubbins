/**
 * The one streamed pass over a loop (the plan's candidate search, step 2):
 * everything measuring the loop, or any pair of boundaries within the search's
 * radius R of it, needs, read once in chunks so no pair reads audio again.
 *
 * It keeps three things. The samples within R and a measuring margin M of each
 * boundary, where every seam window, DC span and fade a pair reads lies. The
 * running sum of each channel at every frame within R of a boundary, so a
 * pair's net DC is a difference of two sums. And the 10 ms dB envelope on a
 * grid from S − R: each step within R and the drift's reach q of a boundary
 * kept, either side, and every step between, which lies inside every pair,
 * counted in a histogram (`envelope-histogram.ts`). Memory is bounded by R, M
 * and q, never by the loop's length.
 *
 * The measurement of the loop as it is takes R = 0.
 */

import type { AudioFrameBlock, PcmSource } from '@audiogubbins/audio-engine';
import { channelCount, type SampleRate } from '@audiogubbins/domain';

import { EnvelopeGrid, type CapturedEnvelope, type GridPlace } from './envelope-grid.js';
import { CHUNK_FRAMES, streamFrames, type ReadingTools } from './source-reading.js';

/** What the pass keeps around a loop. */
export interface CaptureRequest {
  readonly start: number;
  readonly end: number;
  readonly regionLength: number;
  /** How far either boundary may move: 0 to measure the loop as it is. */
  readonly radius: number;
  /** The samples kept either side of the furthest each boundary may move. */
  readonly margin: number;
  /** The frames of one envelope step. */
  readonly envelopeCell: number;
  /**
   * How far beyond the radius either side of each boundary the envelope's steps
   * are kept one by one: into the loop, where its first and last parts lie, and
   * out of it, where the audio before S and after E lies that the drift
   * compares them with.
   */
  readonly driftReach: number;
  /**
   * How much further than S + R a start may be measured, its samples and
   * running sums kept, so a start moved forward to make room for a crossfade is
   * measured like any other.
   */
  readonly startReach: number;
}

/** A run of frames kept, one array per channel. */
interface KeptSpan {
  readonly from: number;
  readonly to: number;
  readonly samples: readonly Float32Array[];
}

/** Running sums recorded at each frame of `[from, to]`, one array per channel. */
interface KeptSums {
  readonly from: number;
  readonly to: number;
  readonly sums: readonly Float64Array[];
}

/** What one pass over a loop kept. */
export class LoopCapture {
  readonly channels: number;
  readonly sampleRate: SampleRate;
  readonly regionLength: number;
  readonly envelope: CapturedEnvelope;
  readonly #spans: readonly KeptSpan[];
  readonly #sums: readonly KeptSums[];

  constructor(
    source: Pick<PcmSource, 'layout' | 'sampleRate'>,
    regionLength: number,
    spans: readonly KeptSpan[],
    sums: readonly KeptSums[],
    envelope: CapturedEnvelope,
  ) {
    this.channels = channelCount(source.layout);
    this.sampleRate = source.sampleRate;
    this.regionLength = regionLength;
    this.#spans = spans;
    this.#sums = sums;
    this.envelope = envelope;
  }

  /** Frames `[from, to)` of `channel`, as a view of what was kept. */
  samples(channel: number, from: number, to: number): Float32Array {
    for (const span of this.#spans) {
      if (from >= span.from && to <= span.to) {
        const samples = span.samples[channel];
        if (samples !== undefined) return samples.subarray(from - span.from, to - span.from);
      }
    }
    throw new RangeError(
      `Frames ${String(from)} to ${String(to)} of channel ${String(channel)} were not kept.`,
    );
  }

  /** The sum of `channel` over every frame the pass read before `frame`. */
  sumBefore(channel: number, frame: number): number {
    for (const kept of this.#sums) {
      if (frame >= kept.from && frame <= kept.to) {
        const sum = kept.sums[channel]?.[frame - kept.from];
        if (sum !== undefined) return sum;
      }
    }
    throw new RangeError(`No running sum was kept at frame ${String(frame)}.`);
  }
}

/** The frames the envelope's steps are measured over: within the radius and the drift's reach of the loop. */
function envelopeRange(request: CaptureRequest): readonly [number, number] {
  const { start, end, radius, driftReach, regionLength } = request;
  return [
    Math.max(0, start - radius - driftReach),
    Math.min(regionLength, end + radius + driftReach),
  ];
}

/** The spans `[lo, hi)` kept around each boundary, merged where they meet. */
function keptRanges(request: CaptureRequest): readonly (readonly [number, number])[] {
  const { start, end, radius, margin, regionLength, startReach } = request;
  const around = (frame: number, reach: number): readonly [number, number] => [
    Math.max(0, frame - radius - margin),
    Math.min(regionLength, frame + radius + reach + margin),
  ];
  const first = around(start, startReach);
  const second = around(end, 0);
  return second[0] <= first[1] ? [[first[0], Math.max(first[1], second[1])]] : [first, second];
}

/** The frames whose running sums are kept: within the radius of each boundary, and past the start's. */
function sumRanges(request: CaptureRequest): readonly (readonly [number, number])[] {
  const { start, end, radius, regionLength, startReach } = request;
  return [
    [Math.max(0, start - radius), Math.min(regionLength, start + radius + startReach)],
    [Math.max(0, end - radius), Math.min(regionLength, end + radius)],
  ];
}

/** The running sum of each channel, recorded at the frames a pair's net DC is read at. */
class RunningSums {
  readonly #kept: readonly KeptSums[];
  readonly #running: Float64Array;

  constructor(request: CaptureRequest, channels: number) {
    this.#kept = sumRanges(request).map(([from, to]) => ({
      from,
      to,
      sums: Array.from({ length: channels }, () => new Float64Array(to - from + 1)),
    }));
    this.#running = new Float64Array(channels);
  }

  hear(chunk: AudioFrameBlock, firstFrame: number): void {
    for (let index = 0; index < chunk.frames; index += 1) {
      this.record(firstFrame + index);
      chunk.channels.forEach((samples, channel) => {
        this.#running[channel] = (this.#running[channel] ?? 0) + (samples[index] ?? 0);
      });
    }
  }

  /** Records the sums before `frame` where they are kept. */
  record(frame: number): void {
    for (const kept of this.#kept) {
      if (frame < kept.from || frame > kept.to) continue;
      kept.sums.forEach((sums, channel) => {
        sums[frame - kept.from] = this.#running[channel] ?? 0;
      });
    }
  }

  get kept(): readonly KeptSums[] {
    return this.#kept;
  }
}

/** The spans of samples kept around each boundary, filled as the pass reads them. */
function keptSpans(request: CaptureRequest, channels: number): readonly KeptSpan[] {
  return keptRanges(request).map(([from, to]) => ({
    from,
    to,
    samples: Array.from({ length: channels }, () => new Float32Array(to - from)),
  }));
}

/** Copies the frames of `chunk` that `spans` keep into them. */
function keepFrames(spans: readonly KeptSpan[], chunk: AudioFrameBlock, firstFrame: number): void {
  for (const span of spans) {
    const from = Math.max(span.from, firstFrame);
    const to = Math.min(span.to, firstFrame + chunk.frames);
    if (from >= to) continue;
    span.samples.forEach((samples, channel) => {
      samples.set(
        chunk.channels[channel]?.subarray(from - firstFrame, to - firstFrame) ?? [],
        from - span.from,
      );
    });
  }
}

/** Where `request`'s envelope grid lies and which steps it keeps one by one. */
function gridOf(request: CaptureRequest, channels: number): GridPlace {
  const { start, end, radius, driftReach, envelopeCell } = request;
  return {
    channels,
    origin: start - radius,
    cell: envelopeCell,
    measured: envelopeRange(request),
    keptNear: [
      [start - radius - driftReach, start + radius + driftReach],
      [end - radius - driftReach, end + radius + driftReach],
    ],
  };
}

/**
 * Reads `request`'s frames of `source` once, in chunks of `chunkFrames`, and
 * keeps what measuring any pair of boundaries within its radius needs.
 */
export async function captureLoop(
  source: PcmSource,
  request: CaptureRequest,
  tools: ReadingTools,
  onFrames: (frames: number) => void,
  chunkFrames = CHUNK_FRAMES,
): Promise<LoopCapture> {
  const channels = channelCount(source.layout);
  const spans = keptSpans(request, channels);
  const sums = new RunningSums(request, channels);
  const grid = new EnvelopeGrid(gridOf(request, channels));
  const [from, to] = streamedRange(request);
  const hear = (chunk: AudioFrameBlock, firstFrame: number): void => {
    keepFrames(spans, chunk, firstFrame);
    sums.hear(chunk, firstFrame);
    grid.hear(chunk, firstFrame);
    onFrames(chunk.frames);
  };
  await streamFrames(source, from, to, tools, hear, chunkFrames);
  sums.record(to);
  return new LoopCapture(source, request.regionLength, spans, sums.kept, grid.envelope());
}

/** The frames `[from, to)` a pass over `request` reads: every span it keeps and its envelope's range. */
function streamedRange(request: CaptureRequest): readonly [number, number] {
  const ranges = keptRanges(request);
  const [envelopeFrom, envelopeTo] = envelopeRange(request);
  return [
    Math.min(ranges[0]?.[0] ?? envelopeFrom, envelopeFrom),
    Math.max(ranges[ranges.length - 1]?.[1] ?? envelopeTo, envelopeTo),
  ];
}

/** How many frames a pass over `request` reads. */
export function capturedFrames(request: CaptureRequest): number {
  const [from, to] = streamedRange(request);
  return to - from;
}
