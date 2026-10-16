/**
 * Scenarios as the Game preview sets them up (ADR-0104): new ones and new
 * emitters, each with identifiers minted for it, so renaming one changes none
 * of its draws, and Godot's own defaults where Godot has one, so what is heard
 * is what a game made with Godot's settings would play; and the first reason
 * one set up cannot be kept in the project or played from it.
 */

import { crc32, type IdGenerator } from '@audiogubbins/domain';
import {
  memberKey,
  previewScenarioProblems,
  scenarioSubjectProblems,
  type GameAudioState,
  type GamePreviewScenario,
  type PreviewEmitter,
  type PreviewSubject,
} from '@audiogubbins/game-audio';

/**
 * Godot's panning strength for a player it is given none for: the project's
 * default `2d_panning_strength` and `3d_panning_strength` of 0.5 times the
 * player's own default of 1.
 */
const GODOT_PANNING_STRENGTH = 0.5;

/** How far to the side a 2D pan is full, in pixels: about half a 1080p screen's width. */
const PAN_WIDTH = 1_000;

/** Where a new emitter stands: two metres in front of the listener in 3D, as far up the screen in 2D. */
const IN_FRONT = 2;

const ENCODER = new TextEncoder();

/** A seed drawn from `text`: the CRC-32 of its UTF-8, a whole number below 2³². */
export function seedOf(text: string): number {
  return crc32(ENCODER.encode(text)) >>> 0;
}

/** What a new emitter plays: the first group of `game`, or `undefined` where it has none. */
export function firstSubject(game: GameAudioState | undefined): PreviewSubject | undefined {
  const [group] = game?.groups.keys() ?? [];
  return group === undefined ? undefined : { kind: 'group', group };
}

/** A new emitter, the `ordinal`th of its scenario, playing `subject` by hand in front of the listener. */
export function newEmitter(
  ids: IdGenerator,
  subject: PreviewSubject,
  ordinal: number,
  space: GamePreviewScenario['space'],
): PreviewEmitter {
  return {
    id: ids.next<'PreviewEmitterId'>(),
    name: `Emitter ${String(ordinal)}`,
    subject,
    trigger: { kind: 'by-hand' },
    motion: {
      kind: 'still',
      at: space === '3d' ? { x: 0, y: 0, z: -IN_FRONT } : { x: 0, y: -IN_FRONT, z: 0 },
    },
  };
}

/** A new 3D scenario, the `ordinal`th of its project, of one emitter playing `subject`. */
export function newScenario(
  ids: IdGenerator,
  subject: PreviewSubject,
  ordinal: number,
): GamePreviewScenario {
  const id = ids.next<'GamePreviewScenarioId'>();
  return {
    id,
    name: `Scenario ${String(ordinal)}`,
    space: '3d',
    panWidth: PAN_WIDTH,
    panningStrength: GODOT_PANNING_STRENGTH,
    listener: { at: { x: 0, y: 0, z: 0 }, facingTurns: 0 },
    emitters: [newEmitter(ids, subject, 1, '3d')],
    seed: seedOf(id),
    busLevels: [],
  };
}

/**
 * Why `scenario` cannot be kept in or played from a project of `game`, its
 * first reason, or `undefined` where it can: what the scenario is, and every
 * group and member it plays being the project's.
 */
export function scenarioProblem(
  game: GameAudioState | undefined,
  scenario: GamePreviewScenario,
): string | undefined {
  const [problem] = [
    ...previewScenarioProblems(scenario),
    ...scenarioSubjectProblems(
      scenario,
      (group) => game?.groups.has(group) === true,
      (member) =>
        game?.memberships.some((one) => memberKey(one.member) === memberKey(member)) === true,
    ),
  ];
  return problem?.summary;
}
