/**
 * How a chain is heard (ADR-0061): run as it plays, started part way after
 * its lead-in on its frame grid, or from a render made ahead, where a
 * processor it runs measures its whole input first or cannot keep to the
 * audio thread's schedule; and which running parameter changes a processor
 * can take. One reading of each processor's descriptor answers both, so
 * playback never runs live what it would refuse to change running.
 */

import { processorsOf, type ProcessorDescriptor, type ProcessorId } from '@audiogubbins/domain';
import type {
  ChainListening,
  ChainRequest,
  ListeningRequest,
  PartWayStart,
} from '@audiogubbins/audio-engine';
import type { ProcessorType } from '@audiogubbins/processors';

import type { ChainGraph } from './chain-graph.js';

function greatestCommonDivisor(left: number, right: number): number {
  let [a, b] = [left, right];
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/** The descriptor of each processor of the request's chain, by instance. */
export function descriptorsOf(
  request: Pick<ChainRequest, 'chain'>,
  types: ReadonlyMap<string, ProcessorType>,
): ReadonlyMap<ProcessorId, ProcessorDescriptor> {
  const descriptors = new Map<ProcessorId, ProcessorDescriptor>();
  for (const processor of processorsOf(request.chain.slots)) {
    const descriptor = types.get(processor.typeKey)?.descriptor;
    if (descriptor !== undefined) descriptors.set(processor.id, descriptor);
  }
  return descriptors;
}

/**
 * Why a processor of `descriptor` is not run as audio is heard, worded for
 * the person, or nothing where it is: one that measures its whole input
 * first, and one whose kernel cannot keep to the audio thread's schedule, as
 * a model's cannot.
 */
export function unheardLive(descriptor: ProcessorDescriptor): string | undefined {
  if (descriptor.wholePass) {
    return `${descriptor.label} measures the whole of its input before it plays anything.`;
  }
  if (!descriptor.realTime) return `${descriptor.label} cannot keep up with the audio as it plays.`;
  return undefined;
}

/**
 * How playback hears the chain: from a render where a processor it runs
 * cannot run as audio is heard, each named, and run as it plays otherwise;
 * either way with the longest lead-in of the processors it runs and the
 * least common multiple of their frame grids, for a part-way start.
 */
export function listening(
  request: ListeningRequest,
  types: ReadonlyMap<string, ProcessorType>,
  built: ChainGraph,
): ChainListening {
  let leadIn = 0;
  let frameGrid = 1;
  const reasons: string[] = [];
  for (const processor of processorsOf(request.chain.slots)) {
    const descriptor = types.get(processor.typeKey)?.descriptor;
    if (descriptor === undefined || !built.processors.has(processor.id)) continue;
    const settings = {
      values: processor.values,
      sampleRate: request.sampleRate,
      quality: request.quality,
    };
    leadIn = Math.max(leadIn, descriptor.leadIn(settings));
    const grid = descriptor.frameGrid(settings);
    frameGrid = (frameGrid / greatestCommonDivisor(frameGrid, grid)) * grid;
    const unheard = unheardLive(descriptor);
    if (unheard !== undefined && !reasons.includes(unheard)) reasons.push(unheard);
  }
  const partWay: PartWayStart = { leadIn, frameGrid };
  return reasons.length === 0
    ? { kind: 'live', partWay }
    : { kind: 'rendered', partWay, reason: reasons.join(' ') };
}
