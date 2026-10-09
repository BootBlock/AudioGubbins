/**
 * Noise reduction: a steady noise learned from a stretch of audio a person
 * marks as noise (`noise-profile.ts`) taken out of every frame of a
 * short-time Fourier transform by spectral subtraction
 * (`spectral-subtraction.ts`), or the noise taken out written alone.
 *
 * The frames are the resolution's `N` samples, `N / overlap` apart for the
 * quality's spectral overlap, and the latency is `N − 1` (`overlap-add.ts`).
 * The type's learner, {@link noiseProfileLearner}, learns the profile over the
 * marked stretch, and it is the instance's state, learned per channel and
 * shared from one channel, and refused when the kernel is made if it was
 * learned with frames of another size, at another rate or on another channel
 * count. Without a profile the kernel writes its input delayed by the latency,
 * unchanged, since there is nothing to subtract. The reduction, sensitivity and
 * smoothing ramp as they move; the resolution and the output change what the
 * kernel is.
 */

import {
  derivedSampleCount,
  DeterminismClass,
  fail,
  failure,
  FailureKind,
  mapResult,
  MAXIMUM_STATE_VALUES,
  ParameterTaper,
  ProcessorCategory,
  succeed,
  unsafeBrandId,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorLatency,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import type { NodeKernel } from '@audiogubbins/audio-engine';

import {
  processorType,
  type LearningSettings,
  type ProcessorRun,
  type StateLearner,
} from '../framework/processor-type.js';
import { RampedParameters } from '../dynamics/ramped-parameters.js';
import { choiceOf, numberOf } from '../filters/parameter-values.js';
import { FrameAnalysis } from './frame-analysis.js';
import {
  NOISE_PROFILE_KIND,
  NoiseProfileLearner,
  PROFILE_HEADER,
  readNoiseProfile,
} from './noise-profile.js';
import { SpectralDelayKernel, SpectralKernel } from './spectral-kernel.js';
import { FALL_SECONDS, SpectralSubtraction } from './spectral-subtraction.js';

const TYPE = 'noise reduction';

const reduction: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d2000000-0001'),
  key: 'reduction',
  label: 'Reduction',
  minimum: 0,
  maximum: 60,
  defaultValue: 12,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

const sensitivity: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d2000000-0002'),
  key: 'sensitivity',
  label: 'Sensitivity',
  minimum: 0,
  maximum: 18,
  defaultValue: 3,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

const smoothing: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d2000000-0003'),
  key: 'smoothing',
  label: 'Smoothing',
  minimum: 0,
  maximum: 100,
  defaultValue: 50,
  taper: ParameterTaper.Linear,
  unit: '%',
  step: 1,
};

const mode: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('d2000000-0004'),
  key: 'mode',
  label: 'Output',
  options: [
    { key: 'reduce', label: 'Reduced audio' },
    { key: 'noise', label: 'Removed noise only' },
  ],
  defaultKey: 'reduce',
};

/** The frame sizes a person may choose, each its own option. */
const SIZES = [1_024, 2_048, 4_096, 8_192] as const;

const resolution: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('d2000000-0005'),
  key: 'resolution',
  label: 'Resolution',
  options: [
    { key: '1024', label: '1024 samples' },
    { key: '2048', label: '2048 samples' },
    { key: '4096', label: '4096 samples' },
    { key: '8192', label: '8192 samples' },
  ],
  defaultKey: '2048',
};

const RAMPED = [reduction, sensitivity, smoothing];

/** The frame size an option of the resolution names. */
function sizeOf(option: string): number {
  return SIZES.find((size) => String(size) === option) ?? 2_048;
}

function latency({ values }: ProcessorSettings): ProcessorLatency {
  return { kind: 'known', frames: derivedSampleCount(sizeOf(choiceOf(values, resolution)) - 1) };
}

/**
 * The latency, then seven time constants of the gain's fall at the smoothing,
 * in whole hops, after which a gain is within 0.1 % of where a run from the
 * stream's start, on the same grid of hops, would have it.
 */
function leadIn({ values, sampleRate, quality }: ProcessorSettings): number {
  const size = sizeOf(choiceOf(values, resolution));
  const hop = size / quality.spectralOverlap;
  const fall = 7 * (numberOf(values, smoothing) / 100) * FALL_SECONDS * sampleRate;
  return size - 1 + Math.ceil(fall / hop) * hop;
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const size = sizeOf(run.parameters.choice(resolution.key));
  const channels = run.input.roles.length;
  const ramps = new RampedParameters(TYPE, RAMPED, run.parameters, run);
  if (run.state === undefined) return succeed(new SpectralDelayKernel(run, size - 1, ramps));
  const profile = readNoiseProfile(run.state, { size, rate: run.sampleRate, channels });
  if (!profile.ok) return profile;
  const fft = run.dsp.createFft(size);
  if (!fft.ok) return fft;
  const analysis = new FrameAnalysis(fft.value, channels, size / run.quality.spectralOverlap);
  const subtraction = new SpectralSubtraction({
    analysis,
    profile: profile.value,
    linked: run.input.ambisonic !== undefined,
    noiseOnly: run.parameters.choice(mode.key) === 'noise',
    rate: run.sampleRate,
    reduction: ramps.frames(reduction.key),
    sensitivity: ramps.frames(sensitivity.key),
    smoothing: ramps.frames(smoothing.key),
  });
  return succeed(new SpectralKernel(analysis, subtraction, ramps));
}

/** Noise reduction from a learned profile, as a processor of the rack. */
export const NOISE_REDUCTION = processorType({
  descriptor: {
    typeKey: 'noise-reduction',
    label: 'Noise reduction',
    category: ProcessorCategory.Restoration,
    version: { implementation: 1, parameters: 1 },
    parameters: [reduction, sensitivity, smoothing, mode, resolution],
    qualitySettings: ['spectralOverlap'],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    // The kernel reads the profile by the same check, so a profile planning
    // accepts is one the kernel can reduce by.
    state: {
      kind: NOISE_PROFILE_KIND,
      missing:
        'This noise reduction has no noise profile. Learn one from a stretch of the noise alone, and it takes that noise away.',
      check: (state, input, rate, values) =>
        mapResult(
          readNoiseProfile(state, {
            size: sizeOf(choiceOf(values, resolution)),
            rate,
            channels: input.roles.length,
          }),
          () => undefined,
        ),
    },
    // Each channel is reduced by its own gains, or an ambisonic set by gains
    // it shares, so any layout is kept as it is.
    outputLayout: (input) => succeed(input),
    latency,
    leadIn,
    // A frame every hop from the kernel's first: the size over the quality's overlap.
    frameGrid: ({ values, quality }) =>
      sizeOf(choiceOf(values, resolution)) / quality.spectralOverlap,
  },
  kernel,
  learn: noiseProfileLearner,
});

/**
 * The learner of a noise profile for a noise reduction of `settings`, which
 * the application gives a stretch of audio the person marks as noise, in any
 * chunks, and whose result is the instance's state; or why it cannot learn one
 * that fits a processor's state. Its frames are `N / 4` apart, whatever the
 * quality, since the mean magnitude of a steady noise does not depend on the
 * hop of the frames it is taken over.
 */
function noiseProfileLearner(settings: LearningSettings): DomainResult<StateLearner> {
  const size = sizeOf(choiceOf(settings.values, resolution));
  const channels = settings.input.roles.length;
  if (PROFILE_HEADER + channels * (size / 2 + 1) > MAXIMUM_STATE_VALUES) {
    return fail(
      failure(
        'processor.state-refused',
        FailureKind.Rejected,
        `A noise profile of ${String(channels)} channels at a resolution of ${String(size)} samples holds more values than a processor keeps: choose a lower resolution.`,
      ),
    );
  }
  const fft = settings.dsp.createFft(size);
  if (!fft.ok) return fft;
  const analysis = new FrameAnalysis(fft.value, channels, size / 4);
  return succeed(new NoiseProfileLearner(analysis, settings.sampleRate));
}
