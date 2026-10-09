/**
 * The ambisonic sets the encoder, the rotation and the decoder take, and the
 * move of a set between its own convention and ACN with SN3D, the one
 * convention they compute in.
 *
 * The weights of each normalisation against another, and the place of each
 * component in each ordering, are the engine's (`ambisonic-conversion.ts`),
 * reached through its matrix node by the name it gives them, so no table of
 * them is written twice. A set already in ACN with SN3D needs no move.
 */

import {
  AmbisonicNormalisation,
  AmbisonicOrdering,
  FailureKind,
  ZERO_SAMPLES,
  ambisonicLayout,
  fail,
  failure,
  layoutsMatch,
  succeed,
  type AmbisonicConvention,
  type ChannelLayout,
  type DomainResult,
} from '@audiogubbins/domain';
import { nodeId, type SettingValue } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  BuiltInNodeType,
  allocateBlock,
  channelAt,
  portAt,
  type AudioFrameBlock,
  type NodeKernel,
} from '@audiogubbins/audio-engine';

import type { ProcessorRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';
import { HIGHEST_ORDER } from './spherical-harmonics.js';

/** The name the engine's matrix node gives a change of ambisonic convention. */
const CONVERSION = 'ambisonic-conversion';

/** The ACN, SN3D layout of an order the harmonics here reach. */
export function sn3dLayout(order: number): DomainResult<ChannelLayout> {
  return ambisonicLayout({
    order,
    ordering: AmbisonicOrdering.Acn,
    normalisation: AmbisonicNormalisation.Sn3d,
  });
}

function refused(summary: string): DomainResult<never> {
  return fail(failure('processor.layout-refused', FailureKind.Rejected, summary));
}

/**
 * The convention of `input` where it is a full ambisonic set of any order
 * that the domain builds, or why `processor` refuses it.
 */
export function fullAmbisonicSetOf(
  input: ChannelLayout,
  processor: string,
): DomainResult<AmbisonicConvention> {
  const convention = input.ambisonic;
  if (convention === undefined) {
    return refused(`${processor} takes an ambisonic set, and this input is not one.`);
  }
  const built = ambisonicLayout(convention);
  if (!built.ok || !layoutsMatch(built.value, input)) {
    return refused(
      `${processor} takes a full ambisonic set, and this input does not have the channels its convention describes.`,
    );
  }
  return succeed(convention);
}

/**
 * The convention of `input` where it is a full ambisonic set of order 1 to
 * 3 that the domain builds, or why `processor` refuses it.
 */
export function ambisonicSetOf(
  input: ChannelLayout,
  processor: string,
): DomainResult<AmbisonicConvention> {
  const full = fullAmbisonicSetOf(input, processor);
  if (!full.ok) return full;
  const convention = full.value;
  if (convention.order < 1 || convention.order > HIGHEST_ORDER) {
    return refused(
      `${processor} takes an ambisonic set of order 1 to ${String(HIGHEST_ORDER)}, and this input is of order ${String(convention.order)}.`,
    );
  }
  return succeed(convention);
}

/**
 * The kernel of the engine's matrix node from `from` to `to`, its weights
 * given or named by `weights`.
 */
export function matrixKernel(
  from: ChannelLayout,
  to: ChannelLayout,
  weights: Readonly<Record<string, SettingValue>>,
  run: ProcessorRun,
): DomainResult<NodeKernel> {
  const node = BUILT_IN_NODES.get(BuiltInNodeType.Matrix);
  if (node === undefined) throw new Error('The engine has a matrix node.');
  const id = nodeId('space-matrix');
  if (!id.ok) return id;
  return node.createKernel(
    {
      node: id.value,
      type: BuiltInNodeType.Matrix,
      settings: weights,
      inputs: [{ port: 'in', layout: from, slot: 0, delay: ZERO_SAMPLES }],
      outputs: [{ port: 'out', layout: to, slot: 1 }],
      // The inner node hears the kernel's own input, so nothing comes before it.
      inputArrival: { kind: 'known', frames: ZERO_SAMPLES },
    },
    {
      sampleRate: run.sampleRate,
      blockFrames: run.blockFrames,
      dsp: run.dsp,
      feedFor: () => undefined,
      sinkFor: () => undefined,
      meterFor: () => undefined,
    },
  );
}

/**
 * The kernel moving a set from `from` to `to`, two conventions of one order,
 * or `undefined` where they are the same and nothing need be done.
 */
export function conversionKernel(
  from: ChannelLayout,
  to: ChannelLayout,
  run: ProcessorRun,
): DomainResult<NodeKernel | undefined> {
  return layoutsMatch(from, to)
    ? succeed(undefined)
    : matrixKernel(from, to, { named: CONVERSION }, run);
}

/** What a kernel run in ACN with SN3D over a set of another convention holds. */
interface Sn3dParts {
  /** The kernel that works on the set in ACN with SN3D. */
  readonly inner: NodeKernel;
  /** The input read through `finiteSample`, as a one-port list made once. */
  readonly finite: readonly AudioFrameBlock[];
  /** The set moved into ACN with SN3D, the inner kernel's input. */
  readonly moved: readonly AudioFrameBlock[];
  /** The inner kernel's output, still in ACN with SN3D. */
  readonly worked: readonly AudioFrameBlock[];
  readonly into: NodeKernel;
  readonly out: NodeKernel;
}

/**
 * Runs a kernel that works in ACN with SN3D over a set of another convention:
 * the input is read through `finiteSample`, since the engine's matrix node
 * does not, moved into ACN with SN3D, worked, and moved back.
 */
class Sn3dKernel implements NodeKernel {
  readonly #parts: Sn3dParts;

  constructor(parts: Sn3dParts) {
    this.#parts = parts;
  }

  process(
    inputs: readonly AudioFrameBlock[],
    outputs: readonly AudioFrameBlock[],
    frames: number,
  ): void {
    const { inner, finite, moved, worked, into, out } = this.#parts;
    copyFinite(portAt(inputs, 0), portAt(finite, 0), frames);
    into.process(finite, moved, frames);
    inner.process(moved, worked, frames);
    out.process(worked, outputs, frames);
  }

  setParameter(name: string, value: number): DomainResult<void> {
    return this.#parts.inner.setParameter(name, value);
  }

  release(): void {
    this.#parts.inner.release();
    this.#parts.into.release();
    this.#parts.out.release();
  }
}

/**
 * `inner`, a kernel that works on a set of `order` in ACN with SN3D, run over
 * the run's input set of that order, whatever its convention: as it is over a
 * set already in ACN with SN3D, and otherwise between the engine's own
 * conversions in and back out.
 */
export function inSn3d(
  run: ProcessorRun,
  order: number,
  inner: NodeKernel,
): DomainResult<NodeKernel> {
  const sn3d = sn3dLayout(order);
  if (!sn3d.ok) return sn3d;
  const into = conversionKernel(run.input, sn3d.value, run);
  if (!into.ok) return into;
  const out = conversionKernel(sn3d.value, run.input, run);
  if (!out.ok) return out;
  if (into.value === undefined || out.value === undefined) return succeed(inner);
  const block = (layout: ChannelLayout) => [allocateBlock(layout, run.sampleRate, run.blockFrames)];
  return succeed(
    new Sn3dKernel({
      inner,
      finite: block(run.input),
      moved: block(sn3d.value),
      worked: block(sn3d.value),
      into: into.value,
      out: out.value,
    }),
  );
}

/** Copies the first `frames` frames of `input` into `into`, each sample read by `finiteSample`. */
export function copyFinite(input: AudioFrameBlock, into: AudioFrameBlock, frames: number): void {
  for (let channel = 0; channel < input.channels.length; channel += 1) {
    const from = channelAt(input, channel);
    const to = channelAt(into, channel);
    for (let frame = 0; frame < frames; frame += 1) to[frame] = finiteSample(from[frame] ?? 0);
  }
}
