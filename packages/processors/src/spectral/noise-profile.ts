/**
 * A learned noise profile: the state a noise reduction holds, a
 * `ProcessorState` of kind `noise-profile`, its reading, and the learning that
 * makes one from a stretch of audio a person marks as noise.
 *
 * Its values are laid out as:
 *
 * - `[0]`, `N`, the samples of the frames it was learned with;
 * - `[1]`, the rate it was learned at, in hertz;
 * - `[2]`, `P`, the sets it holds, one for each channel it was learned on;
 * - then `P` sets of `N/2 + 1` values, set `p` from `3 + p · (N/2 + 1)`, its
 *   value at bin `k` the mean magnitude of bin `k` over the frames learned, by
 *   the window and the unscaled transform the reduction's own spectra have
 *   (`frame-analysis.ts`), so the two are compared as they are.
 *
 * A profile is learned per channel. One of a single set is shared by every
 * channel of the input it reduces, one of as many sets as the input has
 * channels gives each channel its own, and any other is refused, as is one
 * learned with frames of another size or at another rate, whose bins would
 * not be the reduction's.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type ProcessorState,
} from '@audiogubbins/domain';

import type { FrameAnalysis } from './frame-analysis.js';

/** The kind of state a noise reduction holds. */
export const NOISE_PROFILE_KIND = 'noise-profile';

/** The values before the first set: the frame size, the rate and the count of sets. */
export const PROFILE_HEADER = 3;

/** What a profile must have been learned with to reduce a node's input. */
export interface ProfileExpectation {
  readonly size: number;
  readonly rate: number;
  readonly channels: number;
}

function refused(summary: string): DomainResult<never> {
  return fail(failure('processor.state-refused', FailureKind.Rejected, summary));
}

/** Why `values` do not hold a profile laid out for `size`, if they do not. */
function layoutProblem(values: readonly number[], size: number): string | undefined {
  const [learnedSize = 0, , sets = 0] = values;
  if (!Number.isInteger(learnedSize) || !Number.isInteger(sets) || sets < 1) {
    return 'The noise profile does not say the frames and channels it was learned with.';
  }
  if (learnedSize !== size) {
    return `The noise profile was learned with frames of ${String(learnedSize)} samples, and this noise reduction uses ${String(size)}: set its resolution to match, or learn the profile again.`;
  }
  if (values.length !== PROFILE_HEADER + sets * (size / 2 + 1)) {
    return 'The noise profile does not hold a value for every bin of every channel it names.';
  }
  return values.some(
    (value, index) => index >= PROFILE_HEADER && !(Number.isFinite(value) && value >= 0),
  )
    ? 'The noise profile holds a magnitude that is not a finite number of zero or more.'
    : undefined;
}

/**
 * The profile set of each channel of the input `expected` describes, the one
 * set shared or each channel its own, or why `state` is not a profile it can
 * reduce by.
 */
export function readNoiseProfile(
  state: ProcessorState,
  expected: ProfileExpectation,
): DomainResult<readonly Float64Array[]> {
  if (state.kind !== NOISE_PROFILE_KIND) {
    return refused(`A noise reduction holds a noise profile, and this state is a "${state.kind}".`);
  }
  const { values } = state;
  const problem = layoutProblem(values, expected.size);
  if (problem !== undefined) return refused(problem);
  const [, rate = 0, sets = 0] = values;
  if (rate !== expected.rate) {
    return refused(
      `The noise profile was learned at ${String(rate)} Hz, and this audio runs at ${String(expected.rate)} Hz: learn it again at this rate.`,
    );
  }
  if (sets !== 1 && sets !== expected.channels) {
    return refused(
      `The noise profile was learned on ${String(sets)} channels, and this input has ${String(expected.channels)}: learn it on this input, or on one channel to share it.`,
    );
  }
  const bins = expected.size / 2 + 1;
  const set = (index: number) =>
    Float64Array.from(
      values.slice(PROFILE_HEADER + index * bins, PROFILE_HEADER + (index + 1) * bins),
    );
  const shared = sets === 1 ? set(0) : undefined;
  return succeed(Array.from({ length: expected.channels }, (_, channel) => shared ?? set(channel)));
}

/**
 * The mean magnitude of every bin of every channel over the frames of a
 * stretch of audio, a frame every `hop` samples counted once the history holds
 * `N` samples of the stretch, so the silence before it is never learned as
 * noise. The sums are in f64, frame by frame in order; the mean is each sum
 * divided by the count of frames, or zero where the stretch was shorter than a
 * frame, a profile that removes nothing.
 */
export class NoiseProfileLearner {
  readonly #analysis: FrameAnalysis;
  readonly #rate: number;
  readonly #sums: readonly Float64Array[];
  #frames = 0;

  constructor(analysis: FrameAnalysis, rate: number) {
    this.#analysis = analysis;
    this.#rate = rate;
    this.#sums = Array.from({ length: analysis.channels }, () => new Float64Array(analysis.bins));
  }

  /** Learns from the first `frames` frames of `input`, one array per channel. */
  add(input: readonly Float32Array[], frames: number): void {
    const analysis = this.#analysis;
    if (input.length !== analysis.channels) {
      throw new Error('A noise profile was given audio of another channel count than it learns.');
    }
    for (let frame = 0; frame < frames; frame += 1) {
      if (analysis.push(input, frame) && analysis.full) {
        analysis.analyse();
        this.#accumulate();
      }
    }
  }

  /** Adds the magnitudes of the analysis's latest frame to the sums. */
  #accumulate(): void {
    const analysis = this.#analysis;
    for (let channel = 0; channel < analysis.channels; channel += 1) {
      const sums = this.#sums[channel];
      const real = analysis.real[channel];
      const imaginary = analysis.imaginary[channel];
      if (sums === undefined || real === undefined || imaginary === undefined) continue;
      for (let bin = 0; bin < analysis.bins; bin += 1) {
        const re = real[bin] ?? 0;
        const im = imaginary[bin] ?? 0;
        sums[bin] = (sums[bin] ?? 0) + Math.sqrt(re * re + im * im);
      }
    }
    this.#frames += 1;
  }

  /** The profile learned so far, laid out as this module states. */
  result(): ProcessorState {
    const { size, channels } = this.#analysis;
    const values = [size, this.#rate, channels];
    for (const sums of this.#sums) {
      for (const sum of sums) values.push(this.#frames === 0 ? 0 : sum / this.#frames);
    }
    return { kind: NOISE_PROFILE_KIND, values };
  }

  release(): void {
    this.#analysis.release();
  }
}
