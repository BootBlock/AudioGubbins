/**
 * Adding, changing and removing a game preview scenario (ADR-0104, ADR-0106,
 * REQ-GAME-122): the test benches a project keeps beside the groups they play.
 *
 * A scenario is given whole, as the project document writes it, with every
 * identifier minted by the caller, and changed whole, as the preview panel
 * keeps what a person arranged. Each result is held to
 * `validateGameAudioState`, so a scenario whose emitter plays a group or a
 * member the state lacks is refused naming it. A scenario changes no rack, so
 * the state is held as it is (`heldValid`).
 */

import {
  refusal,
  unchanged,
  type CommandInvocation,
  type CommandOutcome,
} from '@audiogubbins/commands';
import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import type {
  GameAudioState,
  GamePreviewScenario,
  GamePreviewScenarioId,
} from '@audiogubbins/game-audio';
import {
  canonicalJson,
  readPreviewScenario,
  writePreviewScenario,
  type ProjectState,
} from '@audiogubbins/project-format';
import { quoted } from '@audiogubbins/text';

import { idArgument } from '../editing/editing-arguments.js';
import { jsonArgument, readNested, refusedBy } from '../invocation-arguments.js';
import { ProjectCommandId, applied, editCommand, type ProjectCommand } from '../project-command.js';
import {
  addScenarioInvocation,
  removeScenarioInvocation,
  setScenarioInvocation,
} from './game-invocations.js';
import { gameOf, heldValid } from './game-state.js';

/** The scenario the argument `scenario` gives whole. */
function scenarioArgument(invocation: CommandInvocation): DomainResult<GamePreviewScenario> {
  const value = jsonArgument(invocation, 'scenario');
  return value.ok ? readNested(readPreviewScenario, value.value, 'scenario') : value;
}

/** The scenario of `game` the identifier `id` names. */
function heldScenario(
  game: GameAudioState,
  id: GamePreviewScenarioId,
): DomainResult<GamePreviewScenario> {
  const scenario = game.scenarios.get(id);
  return scenario === undefined
    ? fail(
        failure(
          'game.scenario-unknown',
          FailureKind.Rejected,
          'The project has no preview scenario with that identifier.',
        ),
      )
    : succeed(scenario);
}

/** `game` with `scenario` held under its identifier, in its place where it replaces one. */
function withScenario(game: GameAudioState, scenario: GamePreviewScenario): GameAudioState {
  return { ...game, scenarios: new Map(game.scenarios).set(scenario.id, scenario) };
}

function words(scenario: GamePreviewScenario): string {
  return `the preview scenario ${quoted(scenario.name)}`;
}

function addScenario(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const read = scenarioArgument(invocation);
  if (!read.ok) return refusedBy(read);
  const scenario = read.value;
  const game = gameOf(state);
  const held = game.scenarios.get(scenario.id);
  if (held !== undefined) {
    return refusal(
      'game.scenario-duplicate-id',
      `The project already has ${words(held)} with that identifier.`,
    );
  }
  const next = heldValid(state, withScenario(game, scenario));
  if (!next.ok) return refusedBy(next);
  return applied(next.value, removeScenarioInvocation(scenario.id), `Add ${words(scenario)}`);
}

function setScenario(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const read = scenarioArgument(invocation);
  if (!read.ok) return refusedBy(read);
  const scenario = read.value;
  const game = gameOf(state);
  const old = heldScenario(game, scenario.id);
  if (!old.ok) return refusedBy(old);
  const written = (one: GamePreviewScenario) => canonicalJson(writePreviewScenario(one));
  if (written(old.value) === written(scenario)) {
    return unchanged('game.scenario-unchanged', `${quoted(scenario.name)} is already so.`);
  }
  const next = heldValid(state, withScenario(game, scenario));
  if (!next.ok) return refusedBy(next);
  return applied(
    next.value,
    setScenarioInvocation(old.value),
    old.value.name === scenario.name
      ? `Change ${words(scenario)}`
      : `Change ${words(old.value)}, now called ${quoted(scenario.name)}`,
  );
}

function removeScenario(
  state: ProjectState,
  invocation: CommandInvocation,
): CommandOutcome<ProjectState> {
  const id = idArgument<'GamePreviewScenarioId'>(invocation, 'scenario');
  if (!id.ok) return refusedBy(id);
  const game = gameOf(state);
  const old = heldScenario(game, id.value);
  if (!old.ok) return refusedBy(old);
  const scenarios = new Map(game.scenarios);
  scenarios.delete(id.value);
  const next = heldValid(state, { ...game, scenarios });
  if (!next.ok) return refusedBy(next);
  return applied(next.value, addScenarioInvocation(old.value), `Remove ${words(old.value)}`);
}

/** The commands that add, change and remove the game preview's scenarios. */
export function scenarioCommands(): readonly ProjectCommand[] {
  return [
    editCommand(
      ProjectCommandId.AddScenario,
      'Add a preview scenario',
      'Adds a game preview scenario: its listener, its emitters and what each plays, and its seed.',
      addScenario,
    ),
    editCommand(
      ProjectCommandId.SetScenario,
      'Change a preview scenario',
      'Replaces a game preview scenario with the one given under its identifier.',
      setScenario,
    ),
    editCommand(
      ProjectCommandId.RemoveScenario,
      'Remove a preview scenario',
      'Removes a game preview scenario.',
      removeScenario,
    ),
  ];
}
