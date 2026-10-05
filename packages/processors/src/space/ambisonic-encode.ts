/**
 * Ambisonic encoder: a mono source placed at an azimuth and an elevation in
 * an ambisonic set of order 1 to 3.
 *
 * Each component is the source times its SN3D harmonic at the direction
 * (`spherical-harmonics.ts`), in ACN order, and a set of another convention is
 * that set moved by the engine's own conversion (`ambisonic-sets.ts`). The
 * set's ordering follows its normalisation, since the domain pairs the
 * Furse-Malham scaling with the Furse-Malham order and no other: SN3D and N3D
 * are ACN-ordered, FuMa FuMa-ordered. A direction moved while it plays ramps a
 * frame at a time, and the harmonics are worked out again from the ramped
 * angles every 32 frames (`DESIGN_INTERVAL`) counted from the kernel's first
 * frame, so the output is the same however the stream is cut.
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  DeterminismClass,
  FailureKind,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  ambisonicLayout,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type AmbisonicConvention,
  type ChannelLayout,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type NumericParameterDescriptor,
  type ParameterValues,
} from '@audiogubbins/domain';
import {
  allocateBlock,
  channelAt,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';
import { DesignClock } from '../filters/cascade-kernel.js';
import { choiceOf } from '../filters/parameter-values.js';
import { RampedParameter } from '../filters/ramped-parameter.js';
import { conversionKernel, sn3dLayout } from './ambisonic-sets.js';
import { directionOf, sphericalHarmonics } from './spherical-harmonics.js';

const TYPE = 'ambisonic encoder';

const azimuth: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0021'),
  key: 'azimuth',
  label: 'Azimuth',
  minimum: -180,
  maximum: 180,
  defaultValue: 0,
  taper: ParameterTaper.Linear,
  unit: '°',
  step: 0.1,
};

const elevation: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('c1000000-0022'),
  key: 'elevation',
  label: 'Elevation',
  minimum: -90,
  maximum: 90,
  defaultValue: 0,
  taper: ParameterTaper.Linear,
  unit: '°',
  step: 0.1,
};

const order: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('c1000000-0023'),
  key: 'order',
  label: 'Order',
  options: [
    { key: 'first', label: 'First order (4 channels)' },
    { key: 'second', label: 'Second order (9 channels)' },
    { key: 'third', label: 'Third order (16 channels)' },
  ],
  defaultKey: 'first',
};

const normalisation: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('c1000000-0024'),
  key: 'normalisation',
  label: 'Normalisation',
  options: [
    { key: 'sn3d', label: 'SN3D (AmbiX)' },
    { key: 'n3d', label: 'N3D' },
    { key: 'fuma', label: 'Furse-Malham (FuMa)' },
  ],
  defaultKey: 'sn3d',
};

const ORDERS: Readonly<Record<string, number>> = { first: 1, second: 2, third: 3 };

const CONVENTIONS: Readonly<Record<string, Omit<AmbisonicConvention, 'order'>>> = {
  sn3d: { ordering: AmbisonicOrdering.Acn, normalisation: AmbisonicNormalisation.Sn3d },
  n3d: { ordering: AmbisonicOrdering.Acn, normalisation: AmbisonicNormalisation.N3d },
  fuma: { ordering: AmbisonicOrdering.FuMa, normalisation: AmbisonicNormalisation.FuMa },
};

/** The convention the order and normalisation chosen make. */
function conventionOf(orderKey: string, normalisationKey: string): AmbisonicConvention {
  const { ordering, normalisation: scaling } = CONVENTIONS[normalisationKey] ?? {
    ordering: AmbisonicOrdering.Acn,
    normalisation: AmbisonicNormalisation.Sn3d,
  };
  return { order: ORDERS[orderKey] ?? 1, ordering, normalisation: scaling };
}

function outputLayout(input: ChannelLayout, values: ParameterValues): DomainResult<ChannelLayout> {
  if (input.roles.length !== 1 || input.ambisonic !== undefined) {
    return fail(
      failure(
        'processor.layout-refused',
        FailureKind.Rejected,
        'An ambisonic encoder places one mono source; give it a single channel, or encode each channel of this input by its own encoder.',
      ),
    );
  }
  return ambisonicLayout(conventionOf(choiceOf(values, order), choiceOf(values, normalisation)));
}

/** What the kernel is made of. */
interface EncoderParts {
  readonly order: number;
  readonly azimuth: RampedParameter;
  readonly elevation: RampedParameter;
  /**
   * Where the output is of another convention than ACN with SN3D, the set in
   * that convention and the kernel that moves it to the output's.
   */
  readonly conversion?: {
    readonly sn3d: AudioFrameBlock;
    /** `sn3d` as the one-port list the kernel takes, made once rather than every quantum. */
    readonly from: readonly AudioFrameBlock[];
    readonly kernel: NodeKernel;
  };
}

class EncoderKernel implements NodeKernel {
  readonly #parts: EncoderParts;
  readonly #clock = new DesignClock();
  readonly #direction = new Float64Array(3);
  readonly #gains: Float64Array;

  constructor(parts: EncoderParts) {
    this.#parts = parts;
    this.#gains = new Float64Array((parts.order + 1) * (parts.order + 1));
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const { azimuth: turn, elevation: rise, conversion } = this.#parts;
    const source = channelAt(portAt(inputs, 0), 0);
    const output = portAt(outputs, 0);
    const target = conversion?.sn3d ?? output;
    turn.fill(frames);
    rise.fill(frames);
    for (let frame = 0; frame < frames;) {
      if (this.#clock.due) this.#design(frame);
      const count = this.#clock.span(frames - frame);
      for (let acn = 0; acn < this.#gains.length; acn += 1) {
        const gain = this.#gains[acn] ?? 0;
        const to = channelAt(target, acn);
        for (let at = frame; at < frame + count; at += 1) {
          to[at] = gain * finiteSample(source[at] ?? 0);
        }
      }
      this.#clock.advance(count);
      frame += count;
    }
    conversion?.kernel.process(conversion.from, outputs, frames);
  }

  setParameter(name: string, value: number): DomainResult<void> {
    if (name === azimuth.key) return this.#parts.azimuth.set(TYPE, value);
    if (name === elevation.key) return this.#parts.elevation.set(TYPE, value);
    return unknownParameter(TYPE, name);
  }

  release(): void {
    this.#parts.conversion?.kernel.release();
  }

  /** The harmonics at the direction the ramps reach at `frame`, where it moved. */
  #design(frame: number): void {
    const { azimuth: turn, elevation: rise, order: of } = this.#parts;
    const moved = turn.moved(frame);
    if (!rise.moved(frame) && !moved) return;
    const direction = this.#direction;
    direction[0] = turn.values[frame] ?? 0;
    direction[1] = rise.values[frame] ?? 0;
    directionOf(direction);
    sphericalHarmonics(direction, of, this.#gains);
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const ramp = (parameter: NumericParameterDescriptor) =>
    new RampedParameter(
      parameter,
      run.parameters.number(parameter.key),
      run.sampleRate,
      run.blockFrames,
    );
  const of = ORDERS[run.parameters.choice(order.key)] ?? 1;
  const sn3d = sn3dLayout(of);
  if (!sn3d.ok) return sn3d;
  const conversion = conversionKernel(sn3d.value, run.output, run);
  if (!conversion.ok) return conversion;
  const parts = { order: of, azimuth: ramp(azimuth), elevation: ramp(elevation) };
  if (conversion.value === undefined) return succeed(new EncoderKernel(parts));
  const block = allocateBlock(sn3d.value, run.sampleRate, run.blockFrames);
  return succeed(
    new EncoderKernel({
      ...parts,
      conversion: { sn3d: block, from: [block], kernel: conversion.value },
    }),
  );
}

/** Ambisonic encoder, as a processor of the rack. */
export const AMBISONIC_ENCODER = processorType({
  descriptor: {
    typeKey: 'ambisonic-encode',
    label: 'Ambisonic encoder',
    category: ProcessorCategory.Space,
    version: { implementation: 1, parameters: 1 },
    parameters: [azimuth, elevation, order, normalisation],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout,
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    // Each frame is its source times gains, with no memory of earlier frames.
    leadIn: () => 0,
  },
  kernel,
});
