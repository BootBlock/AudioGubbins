/**
 * How a chain is heard (ADR-0061): run as it plays, started part way after
 * its lead-in on its frame grid, or from a render made ahead, where a
 * processor it runs measures its whole input first or cannot keep to the
 * audio thread's schedule.
 *
 * The rule reads only the descriptors of the processors a chain applies, so it
 * lives here, below both the threads that run chains and the page that says
 * how each is heard: the effect rack answers playback with it, and the rack
 * view shows the person the same answer, never a second reading of the
 * descriptors that could disagree with what is played.
 */

import {
  appliedSlots,
  measureSlots,
  type ChainMeasure,
  type ChainSettings,
  type ChainSlot,
  type EffectChain,
  type ProcessorInstance,
} from './effect-chain.js';
import type { ProcessorDescriptor } from './processor-descriptor.js';

/** How a run of a chain may start part way through a stream, for a preview. */
export interface PartWayStart {
  /**
   * Frames it needs to settle: the lead-ins of the processors it runs, added
   * along each path, since each settles only once what feeds it has, and the
   * longest path's (`leadInMeasure`).
   */
  readonly leadIn: number;

  /**
   * Frames a part-way start must fall a whole number of into the stream, so
   * every processor it runs frames its audio as a run from the start does:
   * the least common multiple of their frame grids.
   */
  readonly frameGrid: number;
}

/**
 * How playback hears a chain: run as it plays, started part way after its
 * lead-in, or from a render of the whole stream made ahead, where a processor
 * it runs measures its whole input first or cannot keep to the audio thread's
 * schedule (ADR-0061). Either way the chain may be started part way, which a
 * reader that has no render to read falls back to.
 */
export type ChainListening =
  | { readonly kind: 'live'; readonly partWay: PartWayStart }
  | {
      readonly kind: 'rendered';
      readonly partWay: PartWayStart;
      /** Why it cannot run as it is heard, naming the processors, worded for the person. */
      readonly reason: string;
    };

/**
 * Every processor the slots apply, depth first in signal order: those of the
 * applied slots of each list, a bypassed group's none. What a graph built
 * from the slots runs.
 */
export function* appliedProcessors(slots: readonly ChainSlot[]): Generator<ProcessorInstance> {
  for (const slot of appliedSlots(slots)) {
    if (slot.kind === 'processor') yield slot;
    else for (const branch of slot.branches) yield* appliedProcessors(branch.slots);
  }
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
 * A chain's lead-in at `settings`, walked as its latency is: each processor
 * settles over its own lead-in only once its input has, so lead-ins add along
 * a list, and a group settles with its slowest branch. A processor's latency
 * adds nothing more: a run is read from where its latency is run off, and a
 * processor's lead-in is counted in its own input's frames, which are the
 * stream's once aligned. A type `descriptors` lacks is passed over, as
 * {@link chainListening} says.
 */
function leadInMeasure(
  descriptors: ReadonlyMap<string, ProcessorDescriptor>,
  settings: ChainSettings,
): ChainMeasure<number> {
  return {
    processor: (processor) =>
      descriptors.get(processor.typeKey)?.leadIn({ ...settings, values: processor.values }) ?? 0,
    none: 0,
    series: (first, second) => first + second,
    parallel: (one, other) => Math.max(one, other),
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let [a, b] = [left, right];
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/**
 * How playback hears `chain` at `settings`: from a render where a processor
 * it applies cannot run as audio is heard, each reason said once, and run as
 * it plays otherwise; either way with the chain's lead-in and the least
 * common multiple of its processors' frame grids, for a part-way start. A
 * processor of a type `descriptors` lacks is passed over: a chain holding one
 * cannot be built, which its builder refuses first.
 */
export function chainListening(
  chain: Pick<EffectChain, 'slots'>,
  descriptors: ReadonlyMap<string, ProcessorDescriptor>,
  settings: ChainSettings,
): ChainListening {
  let frameGrid = 1;
  const reasons: string[] = [];
  for (const processor of appliedProcessors(chain.slots)) {
    const descriptor = descriptors.get(processor.typeKey);
    if (descriptor === undefined) continue;
    const own = { ...settings, values: processor.values };
    const grid = descriptor.frameGrid(own);
    frameGrid = (frameGrid / greatestCommonDivisor(frameGrid, grid)) * grid;
    const unheard = unheardLive(descriptor);
    if (unheard !== undefined && !reasons.includes(unheard)) reasons.push(unheard);
  }
  const partWay: PartWayStart = {
    leadIn: measureSlots(chain.slots, leadInMeasure(descriptors, settings)),
    frameGrid,
  };
  return reasons.length === 0
    ? { kind: 'live', partWay }
    : { kind: 'rendered', partWay, reason: reasons.join(' ') };
}
