/**
 * A chain's parameters moved along its stream (ADR-0104): the automation a
 * plan gives a chain, as a moving emitter's position is given to its
 * spatial panner, so a motion renders the same offline as it plays.
 *
 * A lane names one numeric parameter of one processor and its value at
 * frames of the stream, linear between them and held before the first and
 * after the last. The runner gives each lane's processor the lane's value at
 * the frame of the stream the processor hears, every {@link AUTOMATION_INTERVAL}
 * frames counted from the run's start, as a running change it smooths in, so
 * the kernel designs from it at its own design interval, which is the same
 * count from the same first frame. A processor late behind others hears its
 * stream later than the chain's input does, so its lane is read that much
 * earlier, and the parameter moves with the audio it acts on.
 */

import {
  fail,
  failure,
  FailureKind,
  succeed,
  unheardLive,
  type DomainResult,
  type ParameterId,
  type ProcessorDescriptor,
  type ProcessorId,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { ChainRequest, GraphExecutor } from '@audiogubbins/audio-engine';

/**
 * Frames from one value a lane gives its processor to the next: the 32-frame
 * interval at which every processor of this build designs from its ramped
 * parameters, so each design reads the value given at its own frame.
 */
const AUTOMATION_INTERVAL = 32;

/** A parameter's value at a frame of the stream. */
export interface AutomationPoint {
  readonly frame: number;
  readonly value: number;
}

/** One numeric parameter of one processor of a chain, moved along the stream. */
export interface ParameterAutomation {
  readonly processor: ProcessorId;
  readonly parameter: ParameterId;
  /** At least one; frames whole, at or after 0, and rising. */
  readonly points: readonly AutomationPoint[];
}

/** A chain request with its plan stream's automation of the chain's parameters. */
export type AutomatedChainRequest = ChainRequest & {
  readonly automation?: readonly ParameterAutomation[];
};

/** A lane checked against its chain: the parameter's key, which a kernel is told it by. */
export interface AutomationLane {
  readonly processor: ProcessorId;
  readonly parameter: ParameterId;
  readonly key: string;
  readonly points: readonly AutomationPoint[];
}

/**
 * The value of `points` at `frame`: the first point's before it, the last's
 * after it, and between two, `v₀ + (v₁ − v₀)·(f − f₀)/(f₁ − f₀)`.
 */
function automatedValue(points: readonly AutomationPoint[], frame: number): number {
  // The first point after `frame`, found by halving: a lane may hold many.
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((points[middle]?.frame ?? 0) <= frame) low = middle + 1;
    else high = middle;
  }
  const next = points[low];
  const previous = points[low - 1];
  if (previous === undefined) return next?.value ?? 0;
  if (next === undefined) return previous.value;
  return (
    previous.value +
    ((next.value - previous.value) * (frame - previous.frame)) / (next.frame - previous.frame)
  );
}

function refused(code: string, summary: string, lane: ParameterAutomation): DomainResult<never> {
  return fail(
    failure(`effect-rack.${code}`, FailureKind.Rejected, summary, {
      details: { processor: lane.processor, parameter: lane.parameter },
    }),
  );
}

/** Why `points` cannot move a parameter from `minimum` to `maximum`, or nothing. */
function pointsProblem(
  points: readonly AutomationPoint[],
  minimum: number,
  maximum: number,
): string | undefined {
  if (points.length === 0) return 'An automation lane has at least one point.';
  let last = -1;
  for (const { frame, value } of points) {
    if (!Number.isSafeInteger(frame) || frame <= last) {
      return 'An automation lane’s points are at whole frames from 0, each after the one before.';
    }
    if (!(value >= minimum && value <= maximum)) {
      return `An automation lane’s values are from ${String(minimum)} to ${String(maximum)}, not ${String(value)}.`;
    }
    last = frame;
  }
  return undefined;
}

/**
 * `automation` checked against the chain it moves, given the node that runs
 * each applied processor and each processor's descriptor: each lane names a
 * processor the run runs, a numeric parameter of it that can be changed while
 * it runs, points in order within the parameter's range, and no parameter is
 * moved by two lanes.
 */
export function checkedAutomation(
  automation: readonly ParameterAutomation[],
  running: ReadonlyMap<ProcessorId, NodeId>,
  descriptors: ReadonlyMap<ProcessorId, ProcessorDescriptor>,
): DomainResult<readonly AutomationLane[]> {
  const lanes: AutomationLane[] = [];
  const moved = new Set<string>();
  for (const lane of automation) {
    const descriptor = descriptors.get(lane.processor);
    if (!running.has(lane.processor) || descriptor === undefined) {
      return refused(
        'automation-processor-not-running',
        'An automation lane moves a processor that is bypassed or not in the chain.',
        lane,
      );
    }
    const unheard = unheardLive(descriptor);
    if (unheard !== undefined) return refused('automation-not-live', unheard, lane);
    const parameter = descriptor.parameters.find((one) => one.id === lane.parameter);
    if (parameter?.kind !== 'numeric') {
      return refused(
        'automation-parameter-not-numeric',
        `${descriptor.label} has no numeric parameter that lane names.`,
        lane,
      );
    }
    const problem = pointsProblem(lane.points, parameter.minimum, parameter.maximum);
    if (problem !== undefined) return refused('automation-points-invalid', problem, lane);
    const name = `${lane.processor} ${lane.parameter}`;
    if (moved.has(name)) {
      return refused(
        'automation-lane-twice',
        `Two automation lanes move the ${parameter.label.toLowerCase()} of one ${descriptor.label.toLowerCase()}.`,
        lane,
      );
    }
    moved.add(name);
    lanes.push({ ...lane, key: parameter.key });
  }
  return succeed(lanes);
}

/**
 * The value each lane's processor starts a run at: its lane's at the frame of
 * the stream it first hears, `start` less how late its input `arrives`.
 */
export function startingValues(
  lanes: readonly AutomationLane[],
  start: number,
  arrives: (processor: ProcessorId) => number,
): ReadonlyMap<ProcessorId, ReadonlyMap<ParameterId, number>> {
  const values = new Map<ProcessorId, Map<ParameterId, number>>();
  for (const lane of lanes) {
    const held = values.get(lane.processor) ?? new Map<ParameterId, number>();
    held.set(lane.parameter, automatedValue(lane.points, start - arrives(lane.processor)));
    values.set(lane.processor, held);
  }
  return values;
}

/** A lane as a run drives it: its node, the frames its processor's input is late, the value last given. */
interface DrivenLane {
  readonly lane: AutomationLane;
  readonly node: NodeId;
  readonly arrival: number;
  given: number;
}

/**
 * A run's lanes, giving each processor its lane's value at the start of every
 * {@link AUTOMATION_INTERVAL} frames of the run. A value the processor already
 * has is not given again, since a running change starts a new ramp from where
 * the last one is.
 */
export class AutomationDriver {
  readonly #lanes: readonly DrivenLane[];
  readonly #start: number;
  /** Frames of the run processed. */
  #elapsed = 0;

  /**
   * The lanes of a run from frame `start` of the stream, each processor run by
   * the node `nodes` names and started at the value `startingValues` gave it.
   */
  constructor(
    lanes: readonly AutomationLane[],
    start: number,
    nodes: ReadonlyMap<ProcessorId, NodeId>,
    arrives: (processor: ProcessorId) => number,
  ) {
    this.#start = start;
    this.#lanes = lanes.flatMap((lane) => {
      const node = nodes.get(lane.processor);
      if (node === undefined) return [];
      const arrival = arrives(lane.processor);
      return [{ lane, node, arrival, given: automatedValue(lane.points, start - arrival) }];
    });
  }

  /** Whether `processor`'s `parameter` follows a lane, so no running change may move it. */
  moves(processor: ProcessorId, parameter: ParameterId): boolean {
    return this.#lanes.some(
      ({ lane }) => lane.processor === processor && lane.parameter === parameter,
    );
  }

  /**
   * Gives each processor the value it starts at, which it already has, so a
   * processor that cannot take its parameter while it runs refuses the lane
   * before the run is used rather than as it plays.
   */
  check(executor: GraphExecutor): DomainResult<void> {
    for (const { node, lane, given } of this.#lanes) {
      const set = executor.setParameter(node, lane.key, given);
      if (!set.ok) return set;
    }
    return succeed(undefined);
  }

  /** Frames, of `remaining`, that may run before the next values are due. */
  span(remaining: number): number {
    return Math.min(remaining, AUTOMATION_INTERVAL - (this.#elapsed % AUTOMATION_INTERVAL));
  }

  /**
   * Gives each processor its lane's value where values are due at the frame
   * the run has reached. Every lane was checked when the run was made, so a
   * refusal now is a fault in the processor, not in the lane.
   */
  give(executor: GraphExecutor): void {
    if (this.#elapsed % AUTOMATION_INTERVAL !== 0) return;
    for (const driven of this.#lanes) {
      const heard = this.#start + this.#elapsed - driven.arrival;
      const value = automatedValue(driven.lane.points, heard);
      if (value === driven.given) continue;
      const set = executor.setParameter(driven.node, driven.lane.key, value);
      if (!set.ok)
        throw new Error(`An automated parameter was refused: ${set.failures[0].summary}`);
      driven.given = value;
    }
  }

  /** Counts `frames` more of the run as processed. */
  advance(frames: number): void {
    this.#elapsed += frames;
  }
}

/** The automation of `request`'s chain, none where it has none. */
export function automationOf(request: ChainRequest): readonly ParameterAutomation[] {
  const automated: AutomatedChainRequest = request;
  return automated.automation ?? [];
}
