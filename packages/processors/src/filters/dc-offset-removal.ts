/**
 * DC offset removal: a first-order high-pass far below anything audible,
 * which takes a constant offset out of every channel and leaves the
 * programme as it was.
 *
 * The filter is the bilinear transform of `s/(s + ωc)`, its cutoff prewarped
 * so the digital filter's −3 dB point is the cutoff asked for: with
 * `K = tan(π·fc/fs)`, the canonical tangent of `fc/2fs` turns,
 * `b0 = 1/(1 + K)`, `b1 = −b0` and `a1 = (K − 1)/(1 + K)`. It runs as a
 * section of the shared cascade whose second-order terms are zero, so its
 * state, its safety and its ramp are every filter's here.
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
import { tangentOfTurns, type NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { BiquadCascade, designFrequency, poleDecayFrames } from './biquad.js';
import { SectionSetting } from './biquad-shape.js';
import { CascadeKernel, type CascadeDesigner } from './cascade-kernel.js';
import { numberOf } from './parameter-values.js';
import { RampedParameter } from './ramped-parameter.js';

const TYPE = 'dc-offset-removal';

const cutoff: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a1000000-0045'),
  key: 'cutoff',
  label: 'Cutoff',
  minimum: 2,
  maximum: 40,
  defaultValue: 5,
  taper: ParameterTaper.Logarithmic,
  unit: 'Hz',
  step: 0.1,
};

/**
 * Writes the first-order high-pass at `rate` and the frequency in the
 * cascade's settings into its one section, as five coefficients whose
 * second-order terms are zero.
 */
function designFirstOrderHighPass(cascade: BiquadCascade, rate: number): void {
  const frequency = cascade.settings[SectionSetting.Frequency] ?? 0;
  const k = tangentOfTurns(designFrequency(frequency, rate) / (2 * rate));
  const b0 = 1 / (1 + k);
  const into = cascade.coefficients;
  into[0] = b0;
  into[1] = -b0;
  into[2] = 0;
  into[3] = (k - 1) / (1 + k);
  into[4] = 0;
}

/** Designs the one section again whenever the cutoff moved. */
class HighPassDesigner implements CascadeDesigner {
  readonly ramps: readonly RampedParameter[];
  readonly #cutoff: RampedParameter;
  readonly #rate: number;

  constructor(run: ProcessorRun) {
    const initial = run.parameters.number(cutoff.key);
    this.#cutoff = new RampedParameter(cutoff, initial, run.sampleRate, run.blockFrames);
    this.ramps = [this.#cutoff];
    this.#rate = run.sampleRate;
  }

  design(cascade: BiquadCascade, frame: number): void {
    if (!this.#cutoff.moved(frame)) return;
    cascade.settings[SectionSetting.Frequency] = this.#cutoff.values[frame] ?? 0;
    designFirstOrderHighPass(cascade, this.#rate);
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const cascade = new BiquadCascade(run.input.roles.length, 1);
  return succeed(new CascadeKernel(TYPE, cascade, new HighPassDesigner(run)));
}

/**
 * Frames for the filter's one real pole, at the cutoff, to decay by 120 dB: a
 * pair of Q ½ is two such poles together, and decays at the same rate.
 */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  return poleDecayFrames(numberOf(values, cutoff), 0.5, sampleRate);
}

/** DC offset removal, as a processor of the rack. */
export const DC_OFFSET_REMOVAL = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'DC offset removal',
    category: ProcessorCategory.Restoration,
    version: { implementation: 1, parameters: 1 },
    parameters: [cutoff],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    // Each channel's offset is its own, so each is filtered apart and any layout is kept.
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel,
});
