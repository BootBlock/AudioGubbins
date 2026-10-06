/**
 * Expander: a downward expander, which lowers what falls below its threshold
 * by its ratio, through a knee, and never by more than its range.
 *
 * Its gain is a static curve of a peak detector's level (`envelope.ts`):
 * attack is how fast it opens as the level rises, release how fast it closes
 * as it falls. Its channels are always linked, so one gain moves the whole
 * image, which is what keeps an ambisonic sound field whole. It looks at
 * nothing ahead, so it adds no latency.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import type { NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { DetectorKernel, type StaticCurve } from './detector-kernel.js';
import {
  DetectorKey,
  DetectorMode,
  LevelDetector,
  SmoothingTime,
  expansionDecibels,
  gainsOfChanges,
  levelsInDecibels,
  settlingFrames,
  type CurveFrames,
} from './envelope.js';
import { RampedParameters, numberIn } from './ramped-parameters.js';

const threshold: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0031'),
  key: 'threshold',
  label: 'Threshold',
  minimum: -80,
  maximum: 0,
  defaultValue: -40,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

const ratio: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0032'),
  key: 'ratio',
  label: 'Ratio',
  minimum: 1,
  maximum: 10,
  defaultValue: 2,
  taper: ParameterTaper.Logarithmic,
  step: 0.1,
};

const range: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0033'),
  key: 'range',
  label: 'Range',
  minimum: 0,
  maximum: 80,
  defaultValue: 24,
  taper: ParameterTaper.Linear,
  unit: 'dB',
  step: 0.1,
};

const attack: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0034'),
  key: 'attack',
  label: 'Attack',
  minimum: 0.1,
  maximum: 200,
  defaultValue: 1,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 0.1,
};

const release: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0035'),
  key: 'release',
  label: 'Release',
  minimum: 5,
  maximum: 2_000,
  defaultValue: 100,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 1,
};

const knee: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0036'),
  key: 'knee',
  label: 'Knee',
  minimum: 0,
  maximum: 24,
  defaultValue: 6,
  taper: ParameterTaper.Linear,
  unit: 'dB',
  step: 0.1,
};

const PARAMETERS = [threshold, ratio, range, attack, release, knee];

/** The expander's curve at each frame's parameter values. */
class ExpanderCurve implements StaticCurve {
  readonly #frames: CurveFrames & { readonly range: Float64Array };

  constructor(parameters: RampedParameters) {
    this.#frames = {
      threshold: parameters.frames(threshold.key),
      ratio: parameters.frames(ratio.key),
      knee: parameters.frames(knee.key),
      range: parameters.frames(range.key),
    };
  }

  gains(levels: Float64Array, into: Float64Array, frames: number): void {
    levelsInDecibels(levels, into, frames);
    expansionDecibels(into, this.#frames, frames);
    gainsOfChanges(into, frames);
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const parameters = new RampedParameters('expander', PARAMETERS, run.parameters, run);
  const key = new DetectorKey(run);
  return succeed(
    new DetectorKernel({
      parameters,
      curve: new ExpanderCurve(parameters),
      key,
      detector: new LevelDetector(key.channels, DetectorMode.Peak, run.blockFrames),
      linked: true,
      attack: parameters.frames(attack.key),
      release: parameters.frames(release.key),
      attackTime: new SmoothingTime(run.sampleRate),
      releaseTime: new SmoothingTime(run.sampleRate),
      blockFrames: run.blockFrames,
    }),
  );
}

function leadIn(settings: ProcessorSettings): number {
  const { values, sampleRate } = settings;
  return settlingFrames(sampleRate, numberIn(values, attack), numberIn(values, release));
}

/** Expander, as a processor of the rack. */
export const EXPANDER = processorType({
  descriptor: {
    typeKey: 'expander',
    label: 'Expander',
    category: ProcessorCategory.Dynamics,
    version: { implementation: 1, parameters: 1 },
    parameters: PARAMETERS,
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel,
});
