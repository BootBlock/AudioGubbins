/**
 * Signals the detectors' tests are run over, each with a fault of a known size
 * at known frames, and a detection's run over them in chunks of any size, on a
 * DSP that counts the feature extractors it has made and not freed.
 */

import {
  StandardLayouts,
  mapResult,
  type ChannelLayout,
  type DetectorFinding,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  REFERENCE_DSP,
  decibelsToGain,
  sineOfTurns,
  type CanonicalDsp,
} from '@audiogubbins/audio-engine';
import { noise } from '@audiogubbins/test-fixtures';

import type { AudioDetector } from '../detection/audio-detector.js';
import { TEST_RATE } from './processor-run.js';

/** The layout of `channels` channels the tests use: mono, stereo or 5.1. */
function layoutOf(channels: number): ChannelLayout {
  if (channels === 1) return StandardLayouts.mono;
  if (channels === 2) return StandardLayouts.stereo;
  return StandardLayouts.surround5_1;
}

/** The reference DSP, counting the feature extractors it has made and not yet freed. */
export function countingDsp(): { readonly dsp: CanonicalDsp; readonly live: () => number } {
  let live = 0;
  const dsp: CanonicalDsp = {
    ...REFERENCE_DSP,
    createDetectorFeatures: (settings) =>
      mapResult(REFERENCE_DSP.createDetectorFeatures(settings), (features) => {
        live += 1;
        return {
          kind: features.kind,
          channels: features.channels,
          recordWidth: features.recordWidth,
          push: (chunk) => {
            features.push(chunk);
          },
          pull: (into) => features.pull(into),
          release: () => {
            live -= 1;
            features.release();
          },
        };
      }),
  };
  return { dsp, live: () => live };
}

/**
 * The findings of `detector` over `channels`, all of one length, given in
 * chunks of `chunk` frames at the test rate.
 */
export async function detect(
  detector: AudioDetector,
  channels: readonly Float32Array[],
  chunk = 4_096,
  dsp: CanonicalDsp = REFERENCE_DSP,
): Promise<readonly DetectorFinding[]> {
  const detection = expectSuccess(
    detector.open({ input: layoutOf(channels.length), sampleRate: TEST_RATE, dsp }),
  );
  const length = channels[0]?.length ?? 0;
  for (let start = 0; start < length; start += chunk) {
    const frames = Math.min(chunk, length - start);
    await detection.add(
      channels.map((channel) => channel.subarray(start, start + frames)),
      frames,
    );
  }
  const found = expectSuccess(await detection.result());
  detection.release();
  return found;
}

/** `length` frames of a sine of `hertz` at a peak of `level` dBFS, from `phase` turns. */
export function tone(length: number, hertz: number, level: number, phase = 0): Float32Array {
  const gain = decibelsToGain(level);
  return Float32Array.from(
    { length },
    (_, frame) => gain * sineOfTurns(phase + (hertz * frame) / TEST_RATE),
  );
}

/** The sum of `signals`, frame by frame, each as long as the first. */
export function mixed(...signals: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(signals[0]?.length ?? 0);
  for (const signal of signals) {
    for (let frame = 0; frame < out.length; frame += 1) {
      out[frame] = (out[frame] ?? 0) + (signal[frame] ?? 0);
    }
  }
  return out;
}

/** `length` frames of white noise at an RMS level of `level` dBFS, seeded by `seed`. */
export function hiss(length: number, level: number, seed = 11): Float32Array {
  // Uniform noise in [−a, a) has an RMS of a/√3.
  const amplitude = decibelsToGain(level) * Math.sqrt(3);
  return noise(seed, { length, amplitude }).channels[0] ?? new Float32Array(length);
}

/** `signal` with the frames from `start` to `end` made `gain` times as loud. */
export function scaled(
  signal: Float32Array,
  start: number,
  end: number,
  gain: number,
): Float32Array {
  const out = signal.slice();
  for (let frame = start; frame < end; frame += 1) out[frame] = gain * (signal[frame] ?? 0);
  return out;
}

/** `signal` held to `ceiling` either way, as a stage out of headroom holds it. */
export function clipped(signal: Float32Array, ceiling: number): Float32Array {
  return signal.map((sample) => Math.min(ceiling, Math.max(-ceiling, sample)));
}

/**
 * `signal` with a burst at each of `onsets`: noise at `amplitude` that falls
 * to a thousandth over 50 ms, an attack every frame of a spectrum sees rise.
 */
export function withOnsets(
  signal: Float32Array,
  onsets: readonly number[],
  amplitude: number,
): Float32Array {
  const out = signal.slice();
  const fall = Math.floor(0.05 * TEST_RATE);
  for (const [index, at] of onsets.entries()) {
    const burst = noise(97 + index, { length: fall, amplitude }).channels[0] ?? new Float32Array(0);
    for (let offset = 0; offset < fall && at + offset < out.length; offset += 1) {
      const envelope = decibelsToGain((-60 * offset) / fall);
      out[at + offset] = (out[at + offset] ?? 0) + envelope * (burst[offset] ?? 0);
    }
  }
  return out;
}

/** `signal` with a NaN, an infinity and a negative infinity at `at` and the two frames after. */
export function withNonFinite(signal: Float32Array, at: number): Float32Array {
  const out = signal.slice();
  out[at] = Number.NaN;
  out[at + 1] = Number.POSITIVE_INFINITY;
  out[at + 2] = Number.NEGATIVE_INFINITY;
  return out;
}
