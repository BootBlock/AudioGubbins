/**
 * A game preview's test bench (ADR-0104): where the listener stands, which
 * emitters play what, how each is triggered and moves, and the seed every
 * random choice is drawn under.
 *
 * Coordinates are Godot's, so an engine integration maps nothing: 3D is
 * right-handed with +y up and the listener facing −z, +x to its right; 2D has
 * +x right and +y down the screen, the listener facing up it (−y), and z is 0.
 * A scenario is a project object whose identifiers are minted by the caller,
 * never derived from a name, so renaming an emitter changes none of its draws.
 *
 * The scenario carries what a Godot project sets for every player rather than
 * each sound: the 2D pan width and the panning strength, the product of the
 * project's `2d_panning_strength` or `3d_panning_strength` (0.5 by default) and
 * the player's own (1 by default). The spatial panner reads both as they are
 * here (`spatial-panner.ts` of the processors).
 */

import {
  FailureKind,
  failure,
  isWellFormedId,
  type AssetId,
  type Branded,
  type DomainFailure,
  type RegionId,
} from '@audiogubbins/domain';
import { quoted } from '@audiogubbins/text';

import type { GameAssetGroupId } from '../groups/group-ids.js';
import type { GroupMember } from '../groups/membership.js';
import { busName, type BusName } from '../policy/bus-name.js';

/** Identifies a preview scenario. */
export type GamePreviewScenarioId = Branded<'GamePreviewScenarioId'>;

/**
 * Identifies an emitter of a scenario. Its key for the scenario's draws is a
 * hash of it (`preview-draws.ts`), so reordering emitters changes no draw.
 */
export type PreviewEmitterId = Branded<'PreviewEmitterId'>;

/** What an emitter plays: a group, whose members are its pool, or one member. */
export type PreviewSubject =
  | { readonly kind: 'group'; readonly group: GameAssetGroupId }
  | { readonly kind: 'member'; readonly member: GroupMember };

/**
 * When an emitter is triggered: only by hand, or `count` times every
 * `intervalMilliseconds`, each trigger moved by up to `jitterMilliseconds`
 * either way. Every time is a whole number of milliseconds.
 */
export type TriggerPattern =
  | { readonly kind: 'by-hand' }
  | {
      readonly kind: 'repeat';
      /** 20 to 60,000. */
      readonly intervalMilliseconds: number;
      /** 0 to half the interval. */
      readonly jitterMilliseconds: number;
      /** 1 to 10,000. */
      readonly count: number;
    };

/** A point in the scenario's space, in Godot's axes; `z` is 0 in 2D. */
export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Waypoint {
  readonly at: Position;
  /** A whole number of milliseconds from the motion's start. */
  readonly milliseconds: number;
}

/**
 * Where an emitter is: still, or moving in straight lines between timed
 * waypoints (2 to 64, the first at 0, each at least 10 ms after the one
 * before), played once and held at the last, looped (the last waypoint where
 * the first is, so the path is closed), or back and forth.
 */
export type Motion =
  | { readonly kind: 'still'; readonly at: Position }
  | {
      readonly kind: 'waypoints';
      readonly points: readonly Waypoint[];
      readonly repeat: 'once' | 'loop' | 'back-and-forth';
    };

export interface PreviewEmitter {
  readonly id: PreviewEmitterId;
  readonly name: string;
  readonly subject: PreviewSubject;
  readonly trigger: TriggerPattern;
  readonly motion: Motion;
}

/**
 * The one listener: where it stands, and which way it faces about the vertical
 * axis in turns from 0 (inclusive) to 1, as Godot's rotation: 0 faces −z in 3D
 * and −y in 2D; a quarter turn faces −x in 3D (turned left, as a positive
 * rotation about +y turns) and +x in 2D (turned clockwise, as a positive 2D
 * rotation turns with +y down).
 */
export interface Listener {
  readonly at: Position;
  readonly facingTurns: number;
}

/** A bus's level as the preview plays it, in decibels, −80 to 24. */
export interface BusLevel {
  readonly bus: BusName;
  readonly decibels: number;
}

export interface GamePreviewScenario {
  readonly id: GamePreviewScenarioId;
  readonly name: string;
  readonly space: '2d' | '3d';
  /** 2D: how far to the side a full-strength pan is full, 1 to 1,000,000 pixels. */
  readonly panWidth: number;
  /** How far the pan moves to the side, 0 (centred) to 1 (full): Godot's project and player strengths multiplied. */
  readonly panningStrength: number;
  readonly listener: Listener;
  /** 1 to 16, each identifier once. */
  readonly emitters: readonly PreviewEmitter[];
  /** A whole number below 2³². */
  readonly seed: number;
  /** Each bus at most once; a bus not listed plays at 0 dB. */
  readonly busLevels: readonly BusLevel[];
}

interface Range {
  readonly lowest: number;
  readonly highest: number;
}

/**
 * The farthest a position may be along an axis. The spatial panner takes an
 * emitter at most 1,000,000 along an axis of the listener's frame; two points
 * this far out and turned keep within it (2 · 250,000 · √2 < 1,000,000).
 */
const POSITION: Range = { lowest: -250_000, highest: 250_000 };
const PAN_WIDTH: Range = { lowest: 1, highest: 1_000_000 };
const PANNING_STRENGTH: Range = { lowest: 0, highest: 1 };
const EMITTERS: Range = { lowest: 1, highest: 16 };
const INTERVAL_MILLISECONDS: Range = { lowest: 20, highest: 60_000 };
const COUNT: Range = { lowest: 1, highest: 10_000 };
const WAYPOINTS: Range = { lowest: 2, highest: 64 };
/** The least time between waypoints: finer than a game moves a node, and it bounds a motion's points. */
const LEAST_WAYPOINT_STEP_MILLISECONDS = 10;
/** The latest a waypoint may be: an hour. */
const LATEST_WAYPOINT_MILLISECONDS = 3_600_000;
const BUS_DECIBELS: Range = { lowest: -80, highest: 24 };
const SEEDS = 2 ** 32;
const LONGEST_NAME = 128;
const CONTROL_CHARACTER = /\p{Cc}/u;

function within(value: number, range: Range): boolean {
  return Number.isFinite(value) && value >= range.lowest && value <= range.highest;
}

function wholeWithin(value: number, range: Range): boolean {
  return Number.isInteger(value) && within(value, range);
}

function words(range: Range): string {
  return `${String(range.lowest)} to ${String(range.highest)}`;
}

/** What is wrong with `name` as a scenario's or an emitter's name, or `undefined`. */
function nameProblem(name: string): string | undefined {
  if (name.length === 0 || name.length > LONGEST_NAME) {
    return `is 1 to ${String(LONGEST_NAME)} characters long.`;
  }
  if (CONTROL_CHARACTER.test(name)) return 'holds no control character.';
  if (name.trim() !== name) return 'has no space at either end.';
  if (name.normalize('NFC') !== name) return "is written in Unicode's NFC form.";
  return undefined;
}

/** The refusals of one scenario, each naming it and the part at fault. */
class Problems {
  readonly list: DomainFailure[] = [];
  readonly #scenario: GamePreviewScenarioId;

  constructor(scenario: GamePreviewScenarioId) {
    this.#scenario = scenario;
  }

  add(part: string, sentence: string): void {
    this.list.push(
      failure('game.scenario-invalid', FailureKind.Rejected, sentence, {
        details: { scenario: this.#scenario, part },
      }),
    );
  }
}

function positionProblems(
  problems: Problems,
  part: string,
  at: Position,
  space: GamePreviewScenario['space'],
): void {
  if (![at.x, at.y, at.z].every((axis) => within(axis, POSITION))) {
    problems.add(part, `A position is ${words(POSITION)} along each axis.`);
  }
  if (space === '2d' && at.z !== 0) problems.add(part, 'A position in 2D has no z.');
}

function triggerProblems(problems: Problems, part: string, trigger: TriggerPattern): void {
  if (trigger.kind === 'by-hand') return;
  const { intervalMilliseconds: interval, jitterMilliseconds: jitter, count } = trigger;
  if (!wholeWithin(interval, INTERVAL_MILLISECONDS)) {
    problems.add(
      `${part}.intervalMilliseconds`,
      `A repeat's interval is a whole ${words(INTERVAL_MILLISECONDS)} ms.`,
    );
  }
  if (!wholeWithin(jitter, { lowest: 0, highest: interval / 2 })) {
    problems.add(
      `${part}.jitterMilliseconds`,
      "A repeat's jitter is a whole number of milliseconds, at most half its interval.",
    );
  }
  if (!wholeWithin(count, COUNT)) {
    problems.add(`${part}.count`, `A repeat triggers ${words(COUNT)} times.`);
  }
}

function samePosition(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function motionProblems(
  problems: Problems,
  part: string,
  motion: Motion,
  space: GamePreviewScenario['space'],
): void {
  if (motion.kind === 'still') {
    positionProblems(problems, `${part}.at`, motion.at, space);
    return;
  }
  const { points } = motion;
  if (!wholeWithin(points.length, WAYPOINTS)) {
    problems.add(`${part}.points`, `A motion has ${words(WAYPOINTS)} waypoints.`);
  }
  let last = -LEAST_WAYPOINT_STEP_MILLISECONDS;
  for (const [index, point] of points.entries()) {
    positionProblems(problems, `${part}.points.${String(index)}`, point.at, space);
    const at = point.milliseconds;
    const timely =
      wholeWithin(at, { lowest: 0, highest: LATEST_WAYPOINT_MILLISECONDS }) &&
      (index === 0 ? at === 0 : at - last >= LEAST_WAYPOINT_STEP_MILLISECONDS);
    if (!timely) {
      problems.add(
        `${part}.points.${String(index)}.milliseconds`,
        `Waypoints are at whole milliseconds, the first at 0 and each at least ${String(LEAST_WAYPOINT_STEP_MILLISECONDS)} ms after the one before.`,
      );
    }
    last = at;
  }
  const first = points[0];
  const final = points.at(-1);
  if (motion.repeat === 'loop' && first !== undefined && final !== undefined) {
    if (!samePosition(first.at, final.at)) {
      problems.add(
        `${part}.repeat`,
        "A looped motion's last waypoint is where its first is, so its path is closed.",
      );
    }
  }
}

function subjectProblems(problems: Problems, part: string, subject: PreviewSubject): void {
  const id: GameAssetGroupId | RegionId | AssetId =
    subject.kind === 'group'
      ? subject.group
      : subject.member.kind === 'region'
        ? subject.member.region
        : subject.member.asset;
  if (!isWellFormedId(id)) problems.add(part, "An emitter's subject names no identifier.");
}

function emitterProblems(
  problems: Problems,
  index: number,
  emitter: PreviewEmitter,
  space: GamePreviewScenario['space'],
): void {
  const part = `emitters.${String(index)}`;
  if (!isWellFormedId(emitter.id))
    problems.add(`${part}.id`, "An emitter's identifier is malformed.");
  const named = nameProblem(emitter.name);
  if (named !== undefined) problems.add(`${part}.name`, `An emitter's name ${named}`);
  subjectProblems(problems, `${part}.subject`, emitter.subject);
  triggerProblems(problems, `${part}.trigger`, emitter.trigger);
  motionProblems(problems, `${part}.motion`, emitter.motion, space);
}

function busLevelProblems(problems: Problems, levels: readonly BusLevel[]): void {
  const seen = new Set<string>();
  for (const [index, level] of levels.entries()) {
    const part = `busLevels.${String(index)}`;
    if (!busName(level.bus).ok) problems.add(`${part}.bus`, "A bus level names no bus's name.");
    if (seen.has(level.bus)) problems.add(`${part}.bus`, 'A bus has one level.');
    seen.add(level.bus);
    if (!within(level.decibels, BUS_DECIBELS)) {
      problems.add(`${part}.decibels`, `A bus's level is ${words(BUS_DECIBELS)} dB.`);
    }
  }
}

/**
 * Every reason `scenario` is not one a project can hold, each failure coded
 * `game.scenario-invalid` with the scenario and the part at fault in its
 * details; empty where it is whole. What its subjects name is checked against
 * the project by {@link scenarioSubjectProblems}.
 */
export function previewScenarioProblems(scenario: GamePreviewScenario): readonly DomainFailure[] {
  const problems = new Problems(scenario.id);
  const { space } = scenario;
  if (!isWellFormedId(scenario.id)) problems.add('id', "A scenario's identifier is malformed.");
  const named = nameProblem(scenario.name);
  if (named !== undefined) problems.add('name', `A scenario's name ${named}`);
  if (!within(scenario.panWidth, PAN_WIDTH)) {
    problems.add('panWidth', `A scenario's pan width is ${words(PAN_WIDTH)}.`);
  }
  if (!within(scenario.panningStrength, PANNING_STRENGTH)) {
    problems.add('panningStrength', `A panning strength is ${words(PANNING_STRENGTH)}.`);
  }
  positionProblems(problems, 'listener.at', scenario.listener.at, space);
  if (
    !within(scenario.listener.facingTurns, { lowest: 0, highest: 1 }) ||
    scenario.listener.facingTurns === 1
  ) {
    problems.add('listener.facingTurns', "A listener's facing is from 0 turns to less than 1.");
  }
  if (!wholeWithin(scenario.emitters.length, EMITTERS)) {
    problems.add('emitters', `A scenario has ${words(EMITTERS)} emitters.`);
  }
  const ids = new Set<string>();
  for (const [index, emitter] of scenario.emitters.entries()) {
    if (ids.has(emitter.id))
      problems.add(`emitters.${String(index)}.id`, 'An emitter is in its scenario once.');
    ids.add(emitter.id);
    emitterProblems(problems, index, emitter, space);
  }
  if (!wholeWithin(scenario.seed, { lowest: 0, highest: SEEDS - 1 })) {
    problems.add('seed', "A scenario's seed is a whole number below 2³².");
  }
  busLevelProblems(problems, scenario.busLevels);
  return problems.list;
}

/**
 * Every subject of `scenario` that plays nothing: a group `hasGroup` does not
 * know, or a sound `hasMember` does not know as a member of a group, whose
 * group's rules a member subject plays by. Each is coded
 * `game.scenario-subject-unknown` and names the scenario and the emitter, so a
 * change that would leave an emitter playing nothing is refused saying which
 * scenario plays it.
 */
export function scenarioSubjectProblems(
  scenario: GamePreviewScenario,
  hasGroup: (group: GameAssetGroupId) => boolean,
  hasMember: (member: GroupMember) => boolean,
): readonly DomainFailure[] {
  const problems: DomainFailure[] = [];
  for (const [index, { subject, name }] of scenario.emitters.entries()) {
    const known = subject.kind === 'group' ? hasGroup(subject.group) : hasMember(subject.member);
    if (known) continue;
    const plays =
      subject.kind === 'group'
        ? 'a group the project does not have'
        : `${subject.member.kind === 'region' ? 'a region' : 'an asset'} that is in no group`;
    problems.push(
      failure(
        'game.scenario-subject-unknown',
        FailureKind.Rejected,
        `The emitter ${quoted(name)} of the preview scenario ${quoted(scenario.name)} plays ${plays}.`,
        { details: { scenario: scenario.id, part: `emitters.${String(index)}.subject` } },
      ),
    );
  }
  return problems;
}
