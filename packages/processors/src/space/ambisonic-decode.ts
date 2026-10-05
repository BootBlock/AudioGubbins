/**
 * Ambisonic decoder: a sound field of order 1 to 3 played over stereo,
 * quadraphonic, 5.1 or 7.1 speakers.
 *
 * A sampling decoder with max-rE weights: speaker `s` at direction `d_s` takes,
 * from the field in ACN with SN3D, each component of degree `l` and harmonic
 * `Y` at `κ · g_l · (2l + 1) · Y(d_s)`, the orthonormal sampling decoder
 * `Y_N3D(d_s) · g_l` written for SN3D, whose two factors of `√(2l + 1)` make
 * the `2l + 1`. The weights `g_l = P_l(r_E)`, the Legendre polynomial of degree
 * `l` at the largest root `r_E` of `P_(N+1)` for a field of order `N`, maximise
 * the energy vector's length, which narrows each source to the speakers nearest
 * it (F. Zotter and M. Frank, "All-Round Ambisonic Panning and Decoding", J.
 * Audio Eng. Soc. 60 (10), 807–820 (2012), section 2.4; J. Daniel, thesis,
 * Paris 6, 2001). Each root is a closed form, so the weights are square roots
 * and products. `κ` makes the energy a source gives the speakers, averaged over
 * every direction it may come from, the energy it had:
 * `Σ_s Σ_c D[s][c]² / (2l + 1) = 1`, since an SN3D harmonic of degree `l` has
 * mean square `1 / (2l + 1)`.
 *
 * The speakers are placed by role, at the directions ITU-R BS.2051 gives
 * its systems A (stereo), B (5.1) and I (7.1), and quadraphonic at the
 * corners of a square; the low-frequency channel is not a direction, and
 * gets nothing. The matrix is worked out once when the kernel is made, and
 * run by the engine's matrix node, after the field is moved into ACN with
 * SN3D by the engine's own conversion where it is of another convention.
 */

import {
  DeterminismClass,
  ProcessorCategory,
  StandardLayouts,
  ZERO_SAMPLES,
  succeed,
  unsafeBrandId,
  type ChannelLayout,
  type ChannelRole,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type ParameterValues,
} from '@audiogubbins/domain';
import {
  allocateBlock,
  portAt,
  unknownParameter,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { choiceOf } from '../filters/parameter-values.js';
import {
  ambisonicSetOf,
  conversionKernel,
  copyFinite,
  matrixKernel,
  sn3dLayout,
} from './ambisonic-sets.js';
import { directionOf, sphericalHarmonics } from './spherical-harmonics.js';

const TYPE = 'ambisonic decoder';

/** A speaker layout a field is decoded to, and the azimuth of each of its roles that has one. */
interface SpeakerLayout {
  readonly layout: ChannelLayout;
  readonly azimuths: Readonly<Partial<Record<ChannelRole, number>>>;
}

const STEREO: SpeakerLayout = {
  layout: StandardLayouts.stereo,
  azimuths: { left: 30, right: -30 },
};

const SPEAKERS: Readonly<Record<string, SpeakerLayout>> = {
  stereo: STEREO,
  quadraphonic: {
    layout: StandardLayouts.quadraphonic,
    azimuths: { left: 45, right: -45, 'rear-left': 135, 'rear-right': -135 },
  },
  'surround-5-1': {
    layout: StandardLayouts.surround5_1,
    azimuths: { left: 30, right: -30, centre: 0, 'surround-left': 110, 'surround-right': -110 },
  },
  'surround-7-1': {
    layout: StandardLayouts.surround7_1,
    azimuths: {
      left: 30,
      right: -30,
      centre: 0,
      'surround-left': 90,
      'surround-right': -90,
      'rear-left': 135,
      'rear-right': -135,
    },
  },
};

const speakers: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('c1000000-0031'),
  key: 'speakers',
  label: 'Speakers',
  options: [
    { key: 'stereo', label: 'Stereo' },
    { key: 'quadraphonic', label: 'Quadraphonic' },
    { key: 'surround-5-1', label: '5.1' },
    { key: 'surround-7-1', label: '7.1' },
  ],
  defaultKey: 'stereo',
};

function speakersOf(key: string): SpeakerLayout {
  return SPEAKERS[key] ?? STEREO;
}

/**
 * The largest root of `P_(N+1)` for each order `N` from 1: `1/√3`, `√(3/5)`
 * and `√((3 + 2√(6/5)) / 7)`.
 */
const ENERGY_RADII: readonly number[] = [
  Math.sqrt(1 / 3),
  Math.sqrt(3 / 5),
  Math.sqrt((3 + 2 * Math.sqrt(6 / 5)) / 7),
];

/** The max-rE weight of each degree to `order`, by Bonnet's recursion of the Legendre polynomials. */
export function maxReWeights(order: number): Float64Array {
  const radius = ENERGY_RADII[order - 1] ?? 0;
  const weights = new Float64Array(order + 1);
  weights[0] = 1;
  weights[1] = radius;
  for (let l = 1; l < order; l += 1) {
    weights[l + 1] =
      ((2 * l + 1) * radius * (weights[l] ?? 0) - l * (weights[l - 1] ?? 0)) / (l + 1);
  }
  return weights;
}

/**
 * The decoding matrix from an ACN, SN3D field of `order` to `speakers`,
 * row-major by speaker, normalised as the file's comment states.
 */
function decodingMatrix(order: number, speakers: SpeakerLayout): number[] {
  const components = (order + 1) * (order + 1);
  const weights = maxReWeights(order);
  const direction = new Float64Array(3);
  const harmonics = new Float64Array(components);
  const matrix = new Array<number>(speakers.layout.roles.length * components).fill(0);
  let energy = 0;
  for (const [row, role] of speakers.layout.roles.entries()) {
    const azimuth = speakers.azimuths[role];
    if (azimuth === undefined) continue;
    direction[0] = azimuth;
    direction[1] = 0;
    directionOf(direction);
    sphericalHarmonics(direction, order, harmonics);
    for (let acn = 0; acn < components; acn += 1) {
      const breadth = 2 * Math.floor(Math.sqrt(acn)) + 1;
      const weight = weights[(breadth - 1) / 2] ?? 0;
      const entry = weight * breadth * (harmonics[acn] ?? 0);
      matrix[row * components + acn] = entry;
      energy += (entry * entry) / breadth;
    }
  }
  const scale = 1 / Math.sqrt(energy);
  return matrix.map((entry) => entry * scale);
}

function outputLayout(input: ChannelLayout, values: ParameterValues): DomainResult<ChannelLayout> {
  const set = ambisonicSetOf(input, 'An ambisonic decoder');
  return set.ok ? succeed(speakersOf(choiceOf(values, speakers)).layout) : set;
}

class DecoderKernel implements NodeKernel {
  readonly #decode: NodeKernel;
  /** The field read through `finiteSample`, and, of another convention, moved to ACN with SN3D. */
  readonly #finite: AudioFrameBlock;
  readonly #conversion?: { readonly kernel: NodeKernel; readonly sn3d: AudioFrameBlock };
  /**
   * The blocks each engine kernel is given, as the one-port lists it takes,
   * made once: a list made per call would be an allocation every quantum.
   */
  readonly #finiteBlocks: readonly AudioFrameBlock[];
  readonly #decodedFrom: readonly AudioFrameBlock[];

  constructor(
    decode: NodeKernel,
    finite: AudioFrameBlock,
    conversion?: { readonly kernel: NodeKernel; readonly sn3d: AudioFrameBlock },
  ) {
    this.#decode = decode;
    this.#finite = finite;
    this.#finiteBlocks = [finite];
    this.#decodedFrom = [conversion?.sn3d ?? finite];
    if (conversion !== undefined) this.#conversion = conversion;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    copyFinite(portAt(inputs, 0), this.#finite, frames);
    const conversion = this.#conversion;
    conversion?.kernel.process(this.#finiteBlocks, this.#decodedFrom, frames);
    this.#decode.process(this.#decodedFrom, outputs, frames);
  }

  setParameter(name: string): DomainResult<void> {
    return unknownParameter(TYPE, name);
  }

  release(): void {
    this.#decode.release();
    this.#conversion?.kernel.release();
  }
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const set = ambisonicSetOf(run.input, 'An ambisonic decoder');
  if (!set.ok) return set;
  const sn3d = sn3dLayout(set.value.order);
  if (!sn3d.ok) return sn3d;
  const conversion = conversionKernel(run.input, sn3d.value, run);
  if (!conversion.ok) return conversion;
  const layout = speakersOf(run.parameters.choice(speakers.key));
  const coefficients = decodingMatrix(set.value.order, layout);
  const decode = matrixKernel(sn3d.value, run.output, { coefficients }, run);
  if (!decode.ok) return decode;
  const finite = allocateBlock(run.input, run.sampleRate, run.blockFrames);
  return succeed(
    new DecoderKernel(
      decode.value,
      finite,
      conversion.value === undefined
        ? undefined
        : {
            kernel: conversion.value,
            sn3d: allocateBlock(sn3d.value, run.sampleRate, run.blockFrames),
          },
    ),
  );
}

/** Ambisonic decoder, as a processor of the rack. */
export const AMBISONIC_DECODER = processorType({
  descriptor: {
    typeKey: 'ambisonic-decode',
    label: 'Ambisonic decoder',
    category: ProcessorCategory.Space,
    version: { implementation: 1, parameters: 1 },
    parameters: [speakers],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout,
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    // A matrix, with no memory of earlier frames.
    leadIn: () => 0,
  },
  kernel,
});
