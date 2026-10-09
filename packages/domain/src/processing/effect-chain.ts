/**
 * Processors and effect chains.
 *
 * REQ-ARCH-004.3 makes processing parametric: a chain records which processors
 * are present, in what order, with what settings. It never records audio.
 * ADR-0060 makes this the one model of a rack: a chain is an ordered list of
 * slots, each a processor instance or a parallel group whose branches are
 * lists of slots of their own, and every slot has its own bypass, solo and
 * wet/dry mix. A chain is held in the project's `effectChains` and named by
 * the operations and targets it processes, so sharing one is naming it twice.
 *
 * REQ-ARCH-144 requires processor latency to be explicit and compensable, so a
 * chain that does not know its own latency says so rather than giving a total.
 */

import type { EffectChainId, ProcessorGroupId, ProcessorId } from '../identity/branded-id.js';
import { sampleCount } from '../time/sample-time.js';
import { defaultParameterValue, type ParameterValue, validateParameterValue } from './parameter.js';
import type {
  ParameterValues,
  ProcessorDescriptor,
  ProcessorSettings,
} from './processor-descriptor.js';
import type { ProcessorLatency } from './processor-latency.js';
import {
  checkStateVersion,
  type ProcessorState,
  type ProcessorStateVersion,
} from './processor-version.js';
import {
  combine,
  failure,
  FailureKind,
  type DomainResult,
  fail,
  mapResult,
  succeed,
} from '../result.js';

/** What a slot's bypass, solo and mix are, whatever it holds. */
interface SlotControls {
  /** Whether the slot is applied; a bypassed slot passes its input on unchanged. */
  readonly enabled: boolean;

  /**
   * Whether the slot is heard alone among the slots of its list. Auditioning
   * one slot is a listening aid; solo wins over enabled, as in every rack.
   */
  readonly soloed: boolean;

  /**
   * The share of the slot's processed output in what it passes on, from 0
   * (its input alone) to 1 (its output alone), the rest its input aligned to
   * the output's latency, mixed linearly.
   */
  readonly mix: number;
}

/** One processor placed in a chain, with its settings and the versions that made them. */
export interface ProcessorInstance extends SlotControls {
  readonly kind: 'processor';
  readonly id: ProcessorId;
  readonly typeKey: string;
  readonly version: ProcessorStateVersion;

  /** Current value of each parameter, keyed by parameter identifier. */
  readonly values: ParameterValues;

  /** State that is not a parameter, where the processor keeps any. */
  readonly state?: ProcessorState;
}

/** How a parallel group adds its branches together. */
export const SummingLaw = {
  /** The branches' sum. */
  Sum: 'sum',
  /** The sum divided by the number of branches. */
  Mean: 'mean',
  /** The sum divided by the square root of the number of branches. */
  EqualPower: 'equal-power',
} as const;

/** How a parallel group adds its branches together. */
export type SummingLaw = (typeof SummingLaw)[keyof typeof SummingLaw];

/** A list of slots in signal order, first to last. */
export interface ChainBranch {
  readonly slots: readonly ChainSlot[];
}

/**
 * Branches that each process the same input, added by `summing`. A branch
 * with no slots is the input itself, which is how a dry path is kept.
 */
export interface ParallelGroup extends SlotControls {
  readonly kind: 'group';
  readonly id: ProcessorGroupId;
  readonly summing: SummingLaw;
  readonly branches: readonly ChainBranch[];
}

/** What a slot of a chain holds. */
export type ChainSlot = ProcessorInstance | ParallelGroup;

/**
 * An ordered list of slots.
 *
 * Order is signal order. It is significant: a filter before a compressor is a
 * different sound from a compressor before a filter, so it is stored rather
 * than derived from anything.
 */
export interface EffectChain {
  readonly id: EffectChainId;
  readonly slots: readonly ChainSlot[];
}

/**
 * The slots of one list that are applied: the soloed ones where any is, and
 * otherwise the enabled ones.
 */
export function appliedSlots(slots: readonly ChainSlot[]): readonly ChainSlot[] {
  const soloed = slots.filter((slot) => slot.soloed);
  return soloed.length > 0 ? soloed : slots.filter((slot) => slot.enabled);
}

/** Every processor of the slots, depth first in signal order, applied or not. */
export function* processorsOf(slots: readonly ChainSlot[]): Generator<ProcessorInstance> {
  for (const slot of slots) {
    if (slot.kind === 'processor') yield slot;
    else for (const branch of slot.branches) yield* processorsOf(branch.slots);
  }
}

/** The factor a group's sum of `count` branches is multiplied by. */
export function summingFactor(law: SummingLaw, count: number): number {
  switch (law) {
    case SummingLaw.Sum:
      return 1;
    case SummingLaw.Mean:
      return 1 / count;
    case SummingLaw.EqualPower:
      return 1 / Math.sqrt(count);
  }
}

/** What the running of a chain is answered for: its rate and quality, each processor's values its own. */
export type ChainSettings = Omit<ProcessorSettings, 'values'>;

/**
 * How a measure of a chain is made from its processors': each applied
 * processor's own, added along a list, and across a group's branches the
 * largest, since the graph delays the shorter branches to meet the longest.
 * A bypassed slot adds nothing, and nor does mixing in a slot's dry input,
 * which is delayed to its output.
 */
export interface ChainMeasure<T> {
  /** The measure of one applied processor. */
  readonly processor: (processor: ProcessorInstance) => T;
  /** The measure of a list with nothing applied in it. */
  readonly none: T;
  /** Two measures one after the other. */
  readonly series: (first: T, second: T) => T;
  /** Two measures side by side, as branches of a group. */
  readonly parallel: (one: T, other: T) => T;
}

/**
 * The measure of a list of slots in series (see {@link ChainMeasure}): the
 * one walk a chain's latency and its lead-in are both found by, so the two
 * cannot disagree about which processors a path runs.
 */
export function measureSlots<T>(slots: readonly ChainSlot[], measure: ChainMeasure<T>): T {
  let total = measure.none;
  for (const slot of appliedSlots(slots)) total = measure.series(total, measureSlot(slot, measure));
  return total;
}

/** The measure of one applied slot: its processor's, or its group's branches' together. */
function measureSlot<T>(slot: ChainSlot, measure: ChainMeasure<T>): T {
  if (slot.kind === 'processor') return measure.processor(slot);
  let widest: T | undefined;
  for (const branch of slot.branches) {
    const own = measureSlots(branch.slots, measure);
    widest = widest === undefined ? own : measure.parallel(widest, own);
  }
  return widest ?? measure.none;
}

/** Latencies added up, or every reason one is not known. */
interface LatencyTally {
  readonly frames: number;
  readonly unknown: readonly string[];
}

function unknownType(processor: ProcessorInstance): DomainResult<never> {
  return fail(
    failure(
      'effect-chain.unknown-processor-type',
      FailureKind.IntegrityViolation,
      `The chain holds a processor of unknown type "${processor.typeKey}".`,
      { details: { typeKey: processor.typeKey, processorId: processor.id } },
    ),
  );
}

/** Two tallies as `join` joins them, or the first refusal of either. */
function joined(
  one: DomainResult<LatencyTally>,
  other: DomainResult<LatencyTally>,
  join: (one: number, other: number) => number,
): DomainResult<LatencyTally> {
  if (!one.ok) return one;
  if (!other.ok) return other;
  return succeed({
    frames: join(one.value.frames, other.value.frames),
    unknown: [...one.value.unknown, ...other.value.unknown],
  });
}

/**
 * A chain's latency at `settings`, as {@link measureSlots} finds it, or why
 * it cannot be told: a processor of a type `descriptors` lacks.
 */
function latencyMeasure(
  descriptors: ReadonlyMap<string, ProcessorDescriptor>,
  settings: ChainSettings,
): ChainMeasure<DomainResult<LatencyTally>> {
  return {
    processor: (processor) => {
      const descriptor = descriptors.get(processor.typeKey);
      if (descriptor === undefined) return unknownType(processor);
      const latency = descriptor.latency({ ...settings, values: processor.values });
      return succeed(
        latency.kind === 'known'
          ? { frames: latency.frames, unknown: [] }
          : {
              frames: 0,
              unknown: [
                `the latency of processor ${processor.id} (${processor.typeKey}) is not known: ${latency.reason}`,
              ],
            },
      );
    },
    none: succeed({ frames: 0, unknown: [] }),
    series: (first, second) => joined(first, second, (one, other) => one + other),
    parallel: (one, other) => joined(one, other, Math.max),
  };
}

/**
 * Total latency the chain introduces at `settings`, as the latency of one
 * processor.
 *
 * Only applied slots contribute, because a bypassed processor delays nothing.
 * Where an applied processor cannot say its latency the chain cannot either:
 * it is unknown, with the reason of every processor that makes it so.
 */
export function chainLatency(
  chain: Pick<EffectChain, 'slots'>,
  descriptors: ReadonlyMap<string, ProcessorDescriptor>,
  settings: ChainSettings,
): DomainResult<ProcessorLatency> {
  const tally = measureSlots(chain.slots, latencyMeasure(descriptors, settings));
  if (!tally.ok) return tally;
  if (tally.value.unknown.length > 0) {
    return succeed({ kind: 'unknown', reason: tally.value.unknown.join('; ') });
  }
  // Checked like any other count: a sum of latencies can leave the range where
  // every integer is exact, and a total asserted into the type could not say
  // so.
  return mapResult(sampleCount(tally.value.frames), (frames): ProcessorLatency => ({
    kind: 'known',
    frames,
  }));
}

/** Builds a processor instance with every parameter at its default, applied fully. */
export function instantiateProcessor(
  id: ProcessorId,
  descriptor: ProcessorDescriptor,
): ProcessorInstance {
  return {
    kind: 'processor',
    id,
    typeKey: descriptor.typeKey,
    enabled: true,
    soloed: false,
    mix: 1,
    version: descriptor.version,
    values: new Map(
      descriptor.parameters.map((parameter) => [parameter.id, defaultParameterValue(parameter)]),
    ),
  };
}

/**
 * Checks that a processor instance matches its descriptor: its type, its
 * versions and every parameter value.
 *
 * Reports every problem rather than the first, so a project opened after a
 * processor gained a parameter tells the person everything that has changed.
 */
export function validateProcessorInstance(
  processor: ProcessorInstance,
  descriptor: ProcessorDescriptor,
): DomainResult<readonly ParameterValue[]> {
  if (processor.typeKey !== descriptor.typeKey) {
    return fail(
      failure(
        'effect-chain.descriptor-mismatch',
        FailureKind.IntegrityViolation,
        'The processor was checked against a descriptor for a different type.',
        { details: { processorType: processor.typeKey, descriptorType: descriptor.typeKey } },
      ),
    );
  }
  const version = checkStateVersion(processor.typeKey, processor.version, descriptor.version);
  if (!version.ok) return version;

  const checks = descriptor.parameters.map((parameter) => {
    const value = processor.values.get(parameter.id);
    if (value === undefined) {
      return fail(
        failure(
          'effect-chain.missing-parameter-value',
          FailureKind.IntegrityViolation,
          `Processor "${descriptor.typeKey}" has no value for parameter "${parameter.key}".`,
          { details: { typeKey: descriptor.typeKey, parameter: parameter.key } },
        ),
      );
    }
    return validateParameterValue(parameter, value);
  });

  const known = new Set(descriptor.parameters.map((parameter) => parameter.id));
  const unexpected = [...processor.values.keys()].filter((id) => !known.has(id));
  if (unexpected.length > 0) {
    checks.push(
      fail(
        failure(
          'effect-chain.unexpected-parameter-value',
          FailureKind.IntegrityViolation,
          `Processor "${descriptor.typeKey}" holds values for parameters it does not declare.`,
          { details: { typeKey: descriptor.typeKey, unexpected: unexpected.join(', ') } },
        ),
      ),
    );
  }

  return combine(checks);
}
