/**
 * Writing and reading a game preview scenario (`@audiogubbins/game-audio`'s
 * `GamePreviewScenario`, ADR-0104, ADR-0106), wherever one is kept: the
 * game-audio state's `scenarios` and a game command's argument
 * (REQ-EXEC-136.12).
 *
 * ```
 * { "id", "name", "space": "2d" | "3d", "panWidth", "panningStrength",
 *   "listener": { "at": { "x", "y", "z" }, "facingTurns" },
 *   "emitters": [ { "id", "name",
 *                   "subject": { "kind": "group", "group" }
 *                            | { "kind": "member", "member" },
 *                   "trigger": { "kind": "by-hand" }
 *                            | { "kind": "repeat", "intervalMilliseconds",
 *                                "jitterMilliseconds", "count" },
 *                   "motion": { "kind": "still", "at" }
 *                           | { "kind": "waypoints",
 *                               "points": [ { "at", "milliseconds" } ],
 *                               "repeat": "once" | "loop"
 *                                       | "back-and-forth" } } ],
 *   "seed", "busLevels": [ { "bus", "decibels" } ] }
 * ```
 *
 * The writer keeps every list in the order the scenario holds it: emitters and
 * bus levels in the order a person arranged them, waypoints in time. The
 * reader holds every member to its shape and every number to being finite; a
 * scenario's ranges, its identifiers' uniqueness and what its subjects name
 * are the game-audio state's rules, run on the whole state once the project is
 * read (`game-audio-json.ts`), so they are refused alike when a command makes
 * them.
 */

import type {
  BusLevel,
  GamePreviewScenario,
  Listener,
  Motion,
  Position,
  PreviewEmitter,
  PreviewSubject,
  TriggerPattern,
  Waypoint,
} from '@audiogubbins/game-audio';

import type { JsonObject } from './canonical-json.js';
import { listConverter, objectOf, pathOf, required, type Converter } from './document-reading.js';
import { readGroupMember, writeGroupMember } from './game-member-json.js';
import { readPolicyField } from './game-policy-json.js';
import { asId, numberConverter, oneOfConverter } from './scalar-reading.js';
import { kindOf, members } from './variant-reading.js';
import { MAXIMUM_NESTED_ITEMS, asName } from './value-reading.js';

/** Any finite number: a range is the scenario's rule, refused naming the scenario. */
const asNumber = numberConverter(-Number.MAX_VALUE, Number.MAX_VALUE);

const asSpace = oneOfConverter(['2d', '3d'] as const);
const asRepeat = oneOfConverter(['once', 'loop', 'back-and-forth'] as const);
const asBus = readPolicyField('bus');

const POSITION_MEMBERS = members('x', 'y', 'z');
const LISTENER_MEMBERS = members('at', 'facingTurns');
const WAYPOINT_MEMBERS = members('at', 'milliseconds');
const EMITTER_MEMBERS = members('id', 'name', 'subject', 'trigger', 'motion');
const BUS_LEVEL_MEMBERS = members('bus', 'decibels');
const SCENARIO_MEMBERS = members(
  'id',
  'name',
  'space',
  'panWidth',
  'panningStrength',
  'listener',
  'emitters',
  'seed',
  'busLevels',
);

const asPosition: Converter<Position> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, POSITION_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const x = required(reading, object, at, 'x', asNumber);
  const y = required(reading, object, at, 'y', asNumber);
  const z = required(reading, object, at, 'z', asNumber);
  return x === undefined || y === undefined || z === undefined ? undefined : { x, y, z };
};

const asListener: Converter<Listener> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, LISTENER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const position = required(reading, object, at, 'at', asPosition);
  const facingTurns = required(reading, object, at, 'facingTurns', asNumber);
  return position === undefined || facingTurns === undefined
    ? undefined
    : { at: position, facingTurns };
};

const asSubject: Converter<PreviewSubject> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    group: members('kind', 'group'),
    member: members('kind', 'member'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  if (kind === 'group') {
    const group = required(reading, object, at, 'group', asId<'GameAssetGroupId'>);
    return group === undefined ? undefined : { kind, group };
  }
  const member = required(reading, object, at, 'member', readGroupMember);
  return member === undefined ? undefined : { kind, member };
};

const asTrigger: Converter<TriggerPattern> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    'by-hand': members('kind'),
    repeat: members('kind', 'intervalMilliseconds', 'jitterMilliseconds', 'count'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  if (kind === 'by-hand') return { kind };
  const intervalMilliseconds = required(reading, object, at, 'intervalMilliseconds', asNumber);
  const jitterMilliseconds = required(reading, object, at, 'jitterMilliseconds', asNumber);
  const count = required(reading, object, at, 'count', asNumber);
  return intervalMilliseconds === undefined ||
    jitterMilliseconds === undefined ||
    count === undefined
    ? undefined
    : { kind, intervalMilliseconds, jitterMilliseconds, count };
};

const asWaypoint: Converter<Waypoint> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, WAYPOINT_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const position = required(reading, object, at, 'at', asPosition);
  const milliseconds = required(reading, object, at, 'milliseconds', asNumber);
  return position === undefined || milliseconds === undefined
    ? undefined
    : { at: position, milliseconds };
};

const asWaypoints = listConverter(MAXIMUM_NESTED_ITEMS, asWaypoint);

const asMotion: Converter<Motion> = (reading, value, parent, key) => {
  const read = kindOf(reading, value, parent, key, 'kind', {
    still: members('kind', 'at'),
    waypoints: members('kind', 'points', 'repeat'),
  });
  if (read === undefined) return undefined;
  const { object, at, kind } = read;
  if (kind === 'still') {
    const position = required(reading, object, at, 'at', asPosition);
    return position === undefined ? undefined : { kind, at: position };
  }
  const points = required(reading, object, at, 'points', asWaypoints);
  const repeat = required(reading, object, at, 'repeat', asRepeat);
  return points === undefined || repeat === undefined ? undefined : { kind, points, repeat };
};

const asEmitter: Converter<PreviewEmitter> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, EMITTER_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asId<'PreviewEmitterId'>);
  const name = required(reading, object, at, 'name', asName);
  const subject = required(reading, object, at, 'subject', asSubject);
  const trigger = required(reading, object, at, 'trigger', asTrigger);
  const motion = required(reading, object, at, 'motion', asMotion);
  return id === undefined ||
    name === undefined ||
    subject === undefined ||
    trigger === undefined ||
    motion === undefined
    ? undefined
    : { id, name, subject, trigger, motion };
};

const asBusLevel: Converter<BusLevel> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, BUS_LEVEL_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const bus = required(reading, object, at, 'bus', asBus);
  const decibels = required(reading, object, at, 'decibels', asNumber);
  return bus === undefined || decibels === undefined ? undefined : { bus, decibels };
};

const asEmitters = listConverter(MAXIMUM_NESTED_ITEMS, asEmitter);
const asBusLevels = listConverter(MAXIMUM_NESTED_ITEMS, asBusLevel);

/** Reads a preview scenario. */
export const readPreviewScenario: Converter<GamePreviewScenario> = (
  reading,
  value,
  parent,
  key,
) => {
  const object = objectOf(reading, value, parent, key, SCENARIO_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const id = required(reading, object, at, 'id', asId<'GamePreviewScenarioId'>);
  const name = required(reading, object, at, 'name', asName);
  const space = required(reading, object, at, 'space', asSpace);
  const panWidth = required(reading, object, at, 'panWidth', asNumber);
  const panningStrength = required(reading, object, at, 'panningStrength', asNumber);
  const listener = required(reading, object, at, 'listener', asListener);
  const emitters = required(reading, object, at, 'emitters', asEmitters);
  const seed = required(reading, object, at, 'seed', asNumber);
  const busLevels = required(reading, object, at, 'busLevels', asBusLevels);
  return id === undefined ||
    name === undefined ||
    space === undefined ||
    panWidth === undefined ||
    panningStrength === undefined ||
    listener === undefined ||
    emitters === undefined ||
    seed === undefined ||
    busLevels === undefined
    ? undefined
    : { id, name, space, panWidth, panningStrength, listener, emitters, seed, busLevels };
};

function writePosition({ x, y, z }: Position): JsonObject {
  return { x, y, z };
}

function writeSubject(subject: PreviewSubject): JsonObject {
  return subject.kind === 'group'
    ? { kind: subject.kind, group: subject.group }
    : { kind: subject.kind, member: writeGroupMember(subject.member) };
}

function writeTrigger(trigger: TriggerPattern): JsonObject {
  return trigger.kind === 'by-hand'
    ? { kind: trigger.kind }
    : {
        kind: trigger.kind,
        intervalMilliseconds: trigger.intervalMilliseconds,
        jitterMilliseconds: trigger.jitterMilliseconds,
        count: trigger.count,
      };
}

function writeMotion(motion: Motion): JsonObject {
  return motion.kind === 'still'
    ? { kind: motion.kind, at: writePosition(motion.at) }
    : {
        kind: motion.kind,
        points: motion.points.map((point) => ({
          at: writePosition(point.at),
          milliseconds: point.milliseconds,
        })),
        repeat: motion.repeat,
      };
}

function writeEmitter(emitter: PreviewEmitter): JsonObject {
  return {
    id: emitter.id,
    name: emitter.name,
    subject: writeSubject(emitter.subject),
    trigger: writeTrigger(emitter.trigger),
    motion: writeMotion(emitter.motion),
  };
}

/** Writes a preview scenario. */
export function writePreviewScenario(scenario: GamePreviewScenario): JsonObject {
  return {
    id: scenario.id,
    name: scenario.name,
    space: scenario.space,
    panWidth: scenario.panWidth,
    panningStrength: scenario.panningStrength,
    listener: {
      at: writePosition(scenario.listener.at),
      facingTurns: scenario.listener.facingTurns,
    },
    emitters: scenario.emitters.map(writeEmitter),
    seed: scenario.seed,
    busLevels: scenario.busLevels.map(({ bus, decibels }) => ({ bus, decibels })),
  };
}
