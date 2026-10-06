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
  channelAt,
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
 * The convention of `input` where it is a full ambisonic set of order 1 to
 * 3 that the domain builds, or why `processor` refuses it.
 */
export function ambisonicSetOf(
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

/** Copies the first `frames` frames of `input` into `into`, each sample read by `finiteSample`. */
export function copyFinite(input: AudioFrameBlock, into: AudioFrameBlock, frames: number): void {
  for (let channel = 0; channel < input.channels.length; channel += 1) {
    const from = channelAt(input, channel);
    const to = channelAt(into, channel);
    for (let frame = 0; frame < frames; frame += 1) to[frame] = finiteSample(from[frame] ?? 0);
  }
}
