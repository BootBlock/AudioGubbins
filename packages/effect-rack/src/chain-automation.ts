/**
 * A chain's parameters moved along its stream (ADR-0104): the automation a plan
 * gives a chain, as a moving emitter's position is given to its spatial panner,
 * so a motion renders the same offline as it plays.
 *
 * A lane (the domain's `ParameterAutomation`) names one numeric parameter of
 * one processor and its value at frames of the stream, by the plan's one rule
 * (`automationValueAt`). The runner gives each lane's processor the lane's
 * value at the frame of the stream the processor hears, every `DESIGN_INTERVAL`
 * frames counted from the run's start, as a running change it smooths in, so
 * the kernel designs from it at its own design interval, which is the same
 * count from the same first frame. A processor late behind others hears its
 * stream later than the chain's input does, so its lane is read that much
 * earlier, and the parameter moves with the audio it acts on.
 *
 * A run kept into a plan that continues its own takes the new plan's lanes,
 * which are the same as far as it has run, for the same parameters.
 */

import {
  automationValueAt,
  fail,
  failure,
  FailureKind,
  succeed,
  unheardLive,
  type AutomationPoint,
  type DomainResult,
  type ParameterAutomation,
  type ParameterId,
  type ProcessorDescriptor,
  type ProcessorId,
} from '@audiogubbins/domain';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { GraphExecutor } from '@audiogubbins/audio-engine';
import { DESIGN_INTERVAL } from '@audiogubbins/processors';

/** A lane checked against its chain: the parameter's key, which a kernel is told it by. */
export interface AutomationLane {
  readonly processor: ProcessorId;
  readonly parameter: ParameterId;
  readonly key: string;
  readonly points: readonly AutomationPoint[];
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
    held.set(lane.parameter, automationValueAt(lane.points, start - arrives(lane.processor)));
    values.set(lane.processor, held);
  }
  return values;
}

/** A lane as a run drives it: its node, the frames its processor's input is late, the value last given. */
interface DrivenLane {
  lane: AutomationLane;
  readonly node: NodeId;
  readonly arrival: number;
  given: number;
}

/**
 * A run's lanes, giving each processor its lane's value at the start of every
 * `DESIGN_INTERVAL` frames of the run. A value the processor already has is
 * not given again, since a running change starts a new ramp from where the
 * last one is.
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
      return [{ lane, node, arrival, given: automationValueAt(lane.points, start - arrival) }];
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

  /**
   * Takes `lanes`, checked against the run's chain, in place of its own from
   * the next values due: lanes for the parameters its own move, in their
   * order, as a plan that continues the run's states them; or says why not.
   */
  replace(lanes: readonly AutomationLane[]): DomainResult<void> {
    const named = (lane: AutomationLane): string => `${lane.processor} ${lane.parameter}`;
    const byParameter = new Map(lanes.map((lane) => [named(lane), lane] as const));
    const same =
      lanes.length === this.#lanes.length &&
      this.#lanes.every(({ lane }) => byParameter.has(named(lane)));
    if (!same) {
      return fail(
        failure(
          'effect-rack.automation-lanes-changed',
          FailureKind.Rejected,
          'A running chain takes new points for the parameters it moves, not lanes for others; a run made afresh takes those.',
        ),
      );
    }
    for (const driven of this.#lanes)
      driven.lane = byParameter.get(named(driven.lane)) ?? driven.lane;
    return succeed(undefined);
  }

  /** Frames, of `remaining`, that may run before the next values are due. */
  span(remaining: number): number {
    return Math.min(remaining, DESIGN_INTERVAL - (this.#elapsed % DESIGN_INTERVAL));
  }

  /**
   * Gives each processor its lane's value where values are due at the frame
   * the run has reached. Every lane was checked when the run was made, so a
   * refusal now is a fault in the processor, not in the lane.
   */
  give(executor: GraphExecutor): void {
    if (this.#elapsed % DESIGN_INTERVAL !== 0) return;
    for (const driven of this.#lanes) {
      const heard = this.#start + this.#elapsed - driven.arrival;
      const value = automationValueAt(driven.lane.points, heard);
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
