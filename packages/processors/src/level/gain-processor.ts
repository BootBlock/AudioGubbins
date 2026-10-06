/**
 * Gain: every channel raised or lowered by one level, in decibels.
 *
 * A rack's gain is the engine's own gain node (ADR-0060), so a level change
 * in a rack and one the engine makes elsewhere are one arithmetic: this type
 * converts the person's decibels to the linear factor that node takes, by the
 * canonical conversion, and runs the node's kernel over its input, read as
 * every processor reads it (`finiteSample`). A level moved while it plays
 * ramps in the node, so it is heard without a click.
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
} from '@audiogubbins/domain';
import { decibelsToGain, type NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { levelKernel } from './level-gain.js';

const gain: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('9a1e0001-0001'),
  key: 'gain',
  label: 'Gain',
  minimum: -96,
  maximum: 48,
  defaultValue: 0,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

/** The one level a person moves, in decibels, as the linear factor the node takes. */
const MOVING = [gain] as const;

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  return levelKernel(run, {
    label: 'gain processor',
    moving: MOVING,
    law: (values) => decibelsToGain(values[0] ?? 0),
  });
}

/** Gain, as a processor of the rack. */
export const GAIN_PROCESSOR = processorType({
  descriptor: {
    typeKey: 'gain',
    label: 'Gain',
    category: ProcessorCategory.Level,
    version: { implementation: 1, parameters: 1 },
    parameters: [gain],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn: () => 0,
    frameGrid: () => 1,
  },
  kernel,
});
