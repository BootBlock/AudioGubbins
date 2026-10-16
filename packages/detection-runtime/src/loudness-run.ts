/**
 * One loudness measurement: a range of a source read once, in order, through
 * the canonical loudness and peak meters (ADR-0061), the integrated loudness
 * and loudness range of EBU R 128 and the true peak answered. They are the
 * meters loudness normalisation measures its input with, so a sound measured
 * after it is normalised reads the level it was normalised to, never another
 * measurement's opinion of it. Nothing here changes the audio or the project.
 *
 * Audio that is not finite is refused, not measured as silence: a meter's
 * reading of it would be a number that says nothing about what is heard. Both
 * meters are released on every path, and progress is reported in frames read.
 */

import {
  allocateBlock,
  type CanonicalDsp,
  type CanonicalLoudnessMeter,
  type CanonicalPeakMeter,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import {
  FailureKind,
  fail,
  failure,
  mapResult,
  succeed,
  type CancellationSignal,
  type DomainResult,
  type EditRange,
} from '@audiogubbins/domain';

import { CHUNK_FRAMES, rangeProblem, readRange } from './range-reading.js';

/** What a loudness measurement answers. */
export interface LoudnessMeasurement {
  /** The frames measured, from the start of the range read. */
  readonly frames: number;
  /**
   * Integrated loudness in LUFS, gated per ITU-R BS.1770-4; `undefined` where
   * no 400 ms block passes the absolute gate, as near-silence does not.
   */
  readonly integratedLufs: number | undefined;
  /** Loudness range in LU, per EBU Tech 3342; 0 where no short-term value passes. */
  readonly rangeLu: number;
  /** The true peak in dBTP, the largest of any channel; `undefined` for silence. */
  readonly truePeakDbtp: number | undefined;
}

/** What a loudness measurement runs with, apart from the audio. */
export interface LoudnessTools {
  readonly dsp: CanonicalDsp;
  readonly signal: CancellationSignal;
  /** Resolves once the scope has read the messages that arrived meanwhile. */
  readonly yieldToHost: () => Promise<void>;
  readonly onProgress: (framesRead: number, framesTotal: number) => void;
}

/** Where a peak meter's reading holds a channel's true peak in dBTP, of its four values. */
const TRUE_PEAK_DBTP = 3;
const READING_WIDTH = 4;

/**
 * The momentary and short-term pairs drained from the loudness meter at a
 * time: the meter keeps every pair until it is pulled, and none is needed
 * here, so drained it holds nothing that grows with the range's length.
 */
const SERIES_PAIRS = 64;

/** Why a measurement stopped at audio that is not finite. */
class NonFiniteAudio extends Error {
  readonly frame: number;
  readonly channel: number;

  constructor(frame: number, channel: number) {
    super('The audio holds a sample that is not a finite number.');
    this.frame = frame;
    this.channel = channel;
  }
}

/** The first of `frames` frames of `channels` that is not finite, thrown with its frame from `first`. */
function throwIfNotFinite(channels: readonly Float32Array[], frames: number, first: number): void {
  for (let channel = 0; channel < channels.length; channel += 1) {
    const samples = channels[channel];
    if (samples === undefined) continue;
    for (let frame = 0; frame < frames; frame += 1) {
      if (!Number.isFinite(samples[frame] ?? 0)) throw new NonFiniteAudio(first + frame, channel);
    }
  }
}

/** The largest true peak of any channel in a peak meter's `reading`, or `undefined` for silence. */
function truePeakOf(reading: Float64Array): number | undefined {
  let largest = Number.NEGATIVE_INFINITY;
  for (let at = TRUE_PEAK_DBTP; at < reading.length; at += READING_WIDTH) {
    largest = Math.max(largest, reading[at] ?? Number.NEGATIVE_INFINITY);
  }
  return Number.isFinite(largest) ? largest : undefined;
}

/** The loudness and peak meters a measurement hears its audio through, made and freed together. */
class Meters {
  readonly #loudness: CanonicalLoudnessMeter;
  readonly #peaks: CanonicalPeakMeter;
  readonly #series = new Float64Array(2 * SERIES_PAIRS);

  private constructor(loudness: CanonicalLoudnessMeter, peaks: CanonicalPeakMeter) {
    this.#loudness = loudness;
    this.#peaks = peaks;
  }

  /** Both meters for `source`'s rate and layout, or why one cannot be made. */
  static open(dsp: CanonicalDsp, source: PcmSource): DomainResult<Meters> {
    const { sampleRate, layout } = source;
    const loudness = dsp.createLoudnessMeter({ sampleRate, layout });
    if (!loudness.ok) return loudness;
    const peaks = dsp.createPeakMeter({ channels: layout.roles.length, sampleRate });
    if (!peaks.ok) loudness.value.release();
    return mapResult(peaks, (peakMeter) => new Meters(loudness.value, peakMeter));
  }

  /** Hears a chunk, every array of one length. */
  push(channels: readonly Float32Array[]): void {
    this.#loudness.push(channels);
    this.#peaks.push(channels);
    let pulled = this.#loudness.pullSeries(this.#series);
    while (pulled > 0) pulled = this.#loudness.pullSeries(this.#series);
  }

  /** What they measured of the `frames` frames heard. */
  measurement(frames: number): LoudnessMeasurement {
    const { integrated, range } = this.#loudness.read();
    const peaks = new Float64Array(READING_WIDTH * this.#peaks.channels);
    this.#peaks.read(peaks);
    return {
      frames,
      integratedLufs: Number.isFinite(integrated) ? integrated : undefined,
      rangeLu: range,
      truePeakDbtp: truePeakOf(peaks),
    };
  }

  release(): void {
    this.#loudness.release();
    this.#peaks.release();
  }
}

/**
 * The loudness and true peak of `range` of `source`, or why they cannot be
 * measured: a range the audio does not hold, a layout the meters cannot take,
 * or audio that is not finite. A cancellation is thrown, as the signal's
 * reason.
 */
export async function measureLoudness(
  source: PcmSource,
  range: EditRange,
  tools: LoudnessTools,
): Promise<DomainResult<LoudnessMeasurement>> {
  const problem = rangeProblem(source, range);
  if (problem !== undefined) return problem;
  const opened = Meters.open(tools.dsp, source);
  if (!opened.ok) return opened;
  const meters = opened.value;
  const total = range.end - range.start;
  try {
    const block = allocateBlock(source.layout, source.sampleRate, Math.min(CHUNK_FRAMES, total));
    let heard = 0;
    const frames = await readRange(source, range, block, tools, (chunk, read) => {
      const channels =
        read === chunk.frames
          ? chunk.channels
          : chunk.channels.map((channel) => channel.subarray(0, read));
      throwIfNotFinite(channels, read, range.start + heard);
      meters.push(channels);
      heard += read;
      tools.onProgress(heard, total);
      return Promise.resolve();
    });
    return succeed(meters.measurement(frames));
  } catch (error) {
    // Audio that is not finite ends the measurement as a refusal; anything
    // else, a cancellation or a read that failed, leaves as it came.
    if (!(error instanceof NonFiniteAudio)) throw error;
    return fail(
      failure('loudness.non-finite-audio', FailureKind.Rejected, error.message, {
        details: { frame: error.frame, channel: error.channel },
      }),
    );
  } finally {
    meters.release();
  }
}
