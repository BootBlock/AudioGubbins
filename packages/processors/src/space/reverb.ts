/**
 * Reverb: a room's tail from a feedback delay network of eight lines
 * (`reverb-network.ts`, which states its lengths, matrix, filters and taps),
 * on any layout, each output channel decorrelated from the others, and on a
 * full ambisonic set of any order and convention as a diffuse sound field,
 * worked in ACN with SN3D (`ambisonic-sets.ts`).
 *
 * The decay is the RT60, the seconds the tail takes to fall 60 dB at low
 * frequencies; the damping shortens it at high frequencies, to
 * `RT60 · (1 − damping)` at the Nyquist frequency. The size scales the
 * lines, and so the spacing of the echoes; it sets the lengths the kernel
 * is made with and is not changed while it runs, since a line that changed
 * length while it rang would bend the pitch of all it held. The decay, the
 * damping, the pre-delay and the width ramp as they move.
 *
 * The slot's wet and dry mix makes the effect, so the kernel gives the tail
 * alone, which starts after the pre-delay and the shortest line, and adds
 * no latency: the dry part of the mix is the input.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  ambisonicComponentOf,
  succeed,
  unsafeBrandId,
  type ChannelLayout,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import type { NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { numberOf } from '../filters/parameter-values.js';
import { RampedParameter } from '../filters/ramped-parameter.js';
import { fullAmbisonicSetOf, inSn3d, sn3dLayout } from './ambisonic-sets.js';
import { ReverbKernel, lineLengths } from './reverb-network.js';

const TYPE = 'reverb';

const size: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0011'),
  key: 'size',
  label: 'Size',
  minimum: 0.1,
  maximum: 1,
  defaultValue: 0.6,
  taper: ParameterTaper.Linear,
  step: 0.01,
};

const decay: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0012'),
  key: 'decay',
  label: 'Decay time',
  minimum: 0.1,
  maximum: 30,
  defaultValue: 2,
  taper: ParameterTaper.Logarithmic,
  unit: 's',
  step: 0.01,
};

const damping: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0013'),
  key: 'damping',
  label: 'Damping',
  minimum: 0,
  maximum: 90,
  defaultValue: 50,
  taper: ParameterTaper.Linear,
  unit: '%',
  step: 1,
};

const preDelay: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0014'),
  key: 'pre-delay',
  label: 'Pre-delay',
  minimum: 0,
  maximum: 200,
  defaultValue: 20,
  taper: ParameterTaper.Linear,
  unit: 'ms',
  step: 0.1,
};

const width: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0015'),
  key: 'width',
  label: 'Width',
  minimum: 0,
  maximum: 100,
  defaultValue: 100,
  taper: ParameterTaper.Linear,
  unit: '%',
  step: 1,
};

/**
 * Frames for the tail to fall 120 dB once the input stops:
 * `⌈2 · RT60 · rate⌉ + ⌈pre-delay · rate / 1000⌉ + m`, where `m`, the
 * longest line, is the frames the last of the input takes to come out of
 * the lines, the pre-delay those it takes to reach them, and two RT60s the
 * fall of 120 dB at low frequencies, which fall slowest.
 */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  const lengths = lineLengths(numberOf(values, size), sampleRate);
  const longest = Math.max(...lengths);
  const fall = Math.ceil(2 * numberOf(values, decay) * sampleRate);
  return fall + Math.ceil((numberOf(values, preDelay) * sampleRate) / 1_000) + longest;
}

/**
 * Any layout of channels is kept as it is; a layout that states an ambisonic
 * convention must be the full set it describes, since the tail is written by
 * component.
 */
function outputLayout(input: ChannelLayout): DomainResult<ChannelLayout> {
  if (input.ambisonic === undefined) return succeed(input);
  const set = fullAmbisonicSetOf(input, 'A reverb');
  return set.ok ? succeed(input) : set;
}

/** Each channel's diffuse-field weight against W in `layout`, a set in ACN with SN3D. */
function diffuseWeights(layout: ChannelLayout): Float64Array {
  return Float64Array.from(layout.roles, (_, channel) => {
    const degree = ambisonicComponentOf(layout, channel)?.degree ?? 0;
    return 1 / Math.sqrt(2 * degree + 1);
  });
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const ramp = (parameter: NumericParameterDescriptor) =>
    new RampedParameter(
      parameter,
      run.parameters.number(parameter.key),
      run.sampleRate,
      run.blockFrames,
    );
  const network = (diffuse?: Float64Array) =>
    new ReverbKernel({
      type: TYPE,
      channels: run.input.roles.length,
      rate: run.sampleRate,
      lengths: lineLengths(run.parameters.number(size.key), run.sampleRate),
      preDelayFrames: Math.ceil((preDelay.maximum * run.sampleRate) / 1_000) + 2,
      decay: ramp(decay),
      damping: ramp(damping),
      preDelay: ramp(preDelay),
      width: ramp(width),
      ...(diffuse === undefined ? {} : { diffuse }),
    });
  if (run.input.ambisonic === undefined) return succeed(network());
  const set = fullAmbisonicSetOf(run.input, 'A reverb');
  if (!set.ok) return set;
  const sn3d = sn3dLayout(set.value.order);
  if (!sn3d.ok) return sn3d;
  return inSn3d(run, set.value.order, network(diffuseWeights(sn3d.value)));
}

/** Reverb, as a processor of the rack. */
export const REVERB = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'Reverb',
    category: ProcessorCategory.Space,
    version: { implementation: 1, parameters: 1 },
    parameters: [size, decay, damping, preDelay, width],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout,
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn,
    frameGrid: () => 1,
  },
  kernel,
});
