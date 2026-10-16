/**
 * Random valid preview scenarios over a game-audio state's subjects, for the
 * properties of the state, the project format's round trip and the random
 * command walk (ADR-0104, ADR-0106).
 *
 * Every part of a scenario is drawn somewhere: both spaces, a listener turned
 * any way, triggers by hand and repeating, still emitters and every kind of
 * moving one, group and member subjects, and bus levels. Positions are any
 * double in range, so a round trip that rounds one is caught. Every scenario is
 * one `previewScenarioProblems` passes, which is asserted.
 */

import type { IdGenerator } from '@audiogubbins/domain';

import { busName } from '../policy/bus-name.js';
import {
  previewScenarioProblems,
  type BusLevel,
  type GamePreviewScenario,
  type Motion,
  type Position,
  type PreviewEmitter,
  type PreviewSubject,
  type TriggerPattern,
  type Waypoint,
} from '../preview/preview-scenario.js';
import type { Random } from './seeded-random.js';

const NAMES = ['Footsteps', 'Door slam', 'Ωμέγα', '中文 room', 'Café', 'Rain on tin'];
const BUSES = ['SFX', 'UI', 'Music', 'Ambience', 'Voice'];

/** How far out a position is drawn: well within the scenario's ±250,000. */
const REACH = 1_000;

function randomPosition(random: Random, space: GamePreviewScenario['space']): Position {
  return {
    x: random.between(-REACH, REACH),
    y: random.between(-REACH, REACH),
    z: space === '2d' ? 0 : random.between(-REACH, REACH),
  };
}

function randomTrigger(random: Random): TriggerPattern {
  if (random.chance(0.3)) return { kind: 'by-hand' };
  const intervalMilliseconds = random.whole(20, 2_000);
  return {
    kind: 'repeat',
    intervalMilliseconds,
    jitterMilliseconds: random.whole(0, Math.floor(intervalMilliseconds / 2)),
    count: random.whole(1, 10_000),
  };
}

function randomMotion(random: Random, space: GamePreviewScenario['space']): Motion {
  if (random.chance(0.4)) return { kind: 'still', at: randomPosition(random, space) };
  const repeat = random.pick(['once', 'loop', 'back-and-forth'] as const);
  const points: Waypoint[] = [];
  let milliseconds = 0;
  for (let index = random.whole(2, 6); index > 0; index -= 1) {
    points.push({ at: randomPosition(random, space), milliseconds });
    milliseconds += random.whole(10, 5_000);
  }
  const [first] = points;
  // A looped path is closed: its last waypoint is where its first is.
  if (repeat === 'loop' && first !== undefined) {
    points.push({ at: first.at, milliseconds });
  }
  return { kind: 'waypoints', points, repeat };
}

function randomBusLevels(random: Random): readonly BusLevel[] {
  return BUSES.filter(() => random.chance(0.3)).map((name) => {
    const bus = busName(name);
    if (!bus.ok) throw new Error(`"${name}" is a bus's name.`);
    return { bus: bus.value, decibels: random.between(-80, 24) };
  });
}

/**
 * A random scenario of one to four emitters, now and then sixteen, each
 * playing one of `subjects`, which holds at least one.
 */
export function randomScenario(
  random: Random,
  ids: IdGenerator,
  subjects: readonly PreviewSubject[],
): GamePreviewScenario {
  const space = random.pick(['2d', '3d'] as const);
  const count = random.chance(0.05) ? 16 : random.whole(1, 4);
  const emitters = Array.from({ length: count }, (_, index): PreviewEmitter => ({
    id: ids.next<'PreviewEmitterId'>(),
    name: `${random.pick(NAMES)} ${String(index + 1)}`,
    subject: random.pick(subjects),
    trigger: randomTrigger(random),
    motion: randomMotion(random, space),
  }));
  const scenario: GamePreviewScenario = {
    id: ids.next<'GamePreviewScenarioId'>(),
    name: random.pick(NAMES),
    space,
    panWidth: random.between(1, 4_000),
    panningStrength: random.next(),
    listener: { at: randomPosition(random, space), facingTurns: random.next() },
    emitters,
    seed: random.whole(0, 2 ** 32 - 1),
    busLevels: randomBusLevels(random),
  };
  const [problem] = previewScenarioProblems(scenario);
  if (problem !== undefined) throw new Error(`A random scenario is whole: ${problem.summary}`);
  return scenario;
}
