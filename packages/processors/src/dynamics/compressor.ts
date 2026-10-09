/**
 * Compressor: a feed-forward compressor whose gain is a static curve of its
 * detected level (`envelope.ts`), keyed from its own input or a side-chain.
 *
 * Above the threshold the level is reduced by the ratio, through a knee of
 * the width asked for, and every channel is then raised by the make-up gain.
 * Linked, the loudest key channel sets one gain for every channel; unlinked,
 * each channel follows its own key channel, or every channel the one channel
 * of a mono side-chain. An ambisonic sound field compressed channel by
 * channel would move its sources, so it is compressed linked or not at all.
 * It looks at nothing ahead, so it adds no latency.
 */

import {
  DeterminismClass,
  FailureKind,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type ChannelLayout,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type NumericParameterDescriptor,
  type ParameterValues,
  type ProcessorSettings,
  type ToggleParameterDescriptor,
} from '@audiogubbins/domain';
import type { NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { DetectorKernel, type StaticCurve } from './detector-kernel.js';
import {
  DETECTOR_OPTIONS,
  DetectorKey,
  DetectorMode,
  LevelDetector,
  SmoothingTime,
  acceptsSideChain,
  compressionDecibels,
  detectorModeOf,
  gainsOfChanges,
  levelsInDecibels,
  type CurveFrames,
  settlingFrames,
} from './envelope.js';
import { RampedParameters, numberIn } from './ramped-parameters.js';

const threshold: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0001'),
  key: 'threshold',
  label: 'Threshold',
  minimum: -60,
  maximum: 0,
  defaultValue: -18,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

const ratio: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0002'),
  key: 'ratio',
  label: 'Ratio',
  minimum: 1,
  maximum: 20,
  defaultValue: 4,
  taper: ParameterTaper.Logarithmic,
  step: 0.1,
};

const knee: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0003'),
  key: 'knee',
  label: 'Knee',
  minimum: 0,
  maximum: 24,
  defaultValue: 6,
  taper: ParameterTaper.Linear,
  unit: 'dB',
  step: 0.1,
};

const attack: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0004'),
  key: 'attack',
  label: 'Attack',
  minimum: 0.1,
  maximum: 200,
  defaultValue: 10,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 0.1,
};

const release: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0005'),
  key: 'release',
  label: 'Release',
  minimum: 5,
  maximum: 2_000,
  defaultValue: 150,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 1,
};

const makeUp: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0006'),
  key: 'make-up',
  label: 'Make-up gain',
  minimum: 0,
  maximum: 24,
  defaultValue: 0,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

const detector: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('b1000000-0007'),
  key: 'detector',
  label: 'Detector',
  options: DETECTOR_OPTIONS,
  defaultKey: DetectorMode.Peak,
};

const link: ToggleParameterDescriptor = {
  kind: 'toggle',
  id: unsafeBrandId<'ParameterId'>('b1000000-0008'),
  key: 'link',
  label: 'Link channels',
  defaultValue: true,
};

const MOVING = [threshold, ratio, knee, attack, release, makeUp];

/** The compressor's curve, with its make-up gain, at each frame's parameter values. */
class CompressorCurve implements StaticCurve {
  readonly #frames: CurveFrames;
  readonly #makeUp: Float64Array;

  constructor(parameters: RampedParameters) {
    this.#frames = {
      threshold: parameters.frames(threshold.key),
      ratio: parameters.frames(ratio.key),
      knee: parameters.frames(knee.key),
    };
    this.#makeUp = parameters.frames(makeUp.key);
  }

  gains(levels: Float64Array, into: Float64Array, frames: number): void {
    levelsInDecibels(levels, into, frames);
    compressionDecibels(into, this.#frames, frames);
    const makeUpGain = this.#makeUp;
    for (let frame = 0; frame < frames; frame += 1) {
      into[frame] = (into[frame] ?? 0) + (makeUpGain[frame] ?? 0);
    }
    gainsOfChanges(into, frames);
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const parameters = new RampedParameters('compressor', MOVING, run.parameters, run);
  const key = new DetectorKey(run);
  return succeed(
    new DetectorKernel({
      parameters,
      curve: new CompressorCurve(parameters),
      key,
      detector: new LevelDetector(
        key.channels,
        detectorModeOf(run.parameters.choice(detector.key)),
        run.blockFrames,
      ),
      linked: run.parameters.toggle(link.key),
      attack: parameters.frames(attack.key),
      release: parameters.frames(release.key),
      attackTime: new SmoothingTime(run.sampleRate),
      releaseTime: new SmoothingTime(run.sampleRate),
      blockFrames: run.blockFrames,
    }),
  );
}

function outputLayout(input: ChannelLayout, values: ParameterValues): DomainResult<ChannelLayout> {
  if (input.ambisonic !== undefined && values.get(link.id) === false) {
    return fail(
      failure(
        'processor.layout-refused',
        FailureKind.Rejected,
        'A compressor takes an ambisonic sound field only with its channels linked: compressed one channel at a time, its sources would move.',
      ),
    );
  }
  return succeed(input);
}

function leadIn(settings: ProcessorSettings): number {
  const { values, sampleRate } = settings;
  return settlingFrames(sampleRate, numberIn(values, attack), numberIn(values, release));
}

/** Compressor, as a processor of the rack. */
export const COMPRESSOR = processorType({
  descriptor: {
    typeKey: 'compressor',
    label: 'Compressor',
    category: ProcessorCategory.Dynamics,
    version: { implementation: 1, parameters: 1 },
    parameters: [threshold, ratio, knee, attack, release, makeUp, detector, link],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout,
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  sideChain: acceptsSideChain,
  kernel,
});
