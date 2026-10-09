/**
 * Gate: silences what falls below its threshold, down to its range, and lets
 * through what rises above it.
 *
 * Its key is the linked peak level of every channel (`envelope.ts`), followed
 * at once as it rises and with a release of `DETECTOR_RELEASE_MS` as it falls,
 * so the troughs of a low note do not read as silence between its peaks. It
 * opens when that level reaches the threshold, and stays open while the level
 * is above the threshold less the hysteresis, and for the hold after it last
 * was, so a level hovering at the threshold cannot chatter. Its gain moves by
 * a one-pole smoother towards 1 when open, by the attack, and towards the
 * floor when closed, by the release. One gain moves every channel, which keeps
 * an image or an ambisonic sound field whole. It adds no latency.
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
import { framesOf, settlingFrames } from './envelope.js';
import { DETECTOR_RELEASE_MS, GateKernel } from './gate-kernel.js';
import { RampedParameters, numberIn } from './ramped-parameters.js';

const threshold: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0021'),
  key: 'threshold',
  label: 'Threshold',
  minimum: -80,
  maximum: 0,
  defaultValue: -40,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

const hysteresis: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0022'),
  key: 'hysteresis',
  label: 'Hysteresis',
  minimum: 0,
  maximum: 20,
  defaultValue: 6,
  taper: ParameterTaper.Linear,
  unit: 'dB',
  step: 0.1,
};

const attack: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0023'),
  key: 'attack',
  label: 'Attack',
  minimum: 0.1,
  maximum: 200,
  defaultValue: 1,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 0.1,
};

const hold: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0024'),
  key: 'hold',
  label: 'Hold',
  minimum: 0,
  maximum: 2_000,
  defaultValue: 50,
  taper: ParameterTaper.Linear,
  unit: 'ms',
  step: 1,
};

const release: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0025'),
  key: 'release',
  label: 'Release',
  minimum: 5,
  maximum: 2_000,
  defaultValue: 100,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 1,
};

const range: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0026'),
  key: 'range',
  label: 'Range',
  minimum: 0,
  maximum: 96,
  defaultValue: 80,
  taper: ParameterTaper.Linear,
  unit: 'dB',
  step: 0.1,
};

const PARAMETERS = [threshold, hysteresis, attack, hold, release, range];

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const parameters = new RampedParameters('gate', PARAMETERS, run.parameters, run);
  return succeed(
    new GateKernel(parameters, run, {
      threshold: parameters.frames(threshold.key),
      hysteresis: parameters.frames(hysteresis.key),
      attack: parameters.frames(attack.key),
      hold: parameters.frames(hold.key),
      release: parameters.frames(release.key),
      range: parameters.frames(range.key),
    }),
  );
}

function leadIn(settings: ProcessorSettings): number {
  const { values, sampleRate } = settings;
  const holdFrames = framesOf(numberIn(values, hold), sampleRate);
  const times = [numberIn(values, attack), numberIn(values, release), DETECTOR_RELEASE_MS];
  return holdFrames + settlingFrames(sampleRate, ...times);
}

/** Gate, as a processor of the rack. */
export const GATE = processorType({
  descriptor: {
    typeKey: 'gate',
    label: 'Gate',
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
