/**
 * The Game preview's commands (ADR-0104, ADR-0106, ADR-0013): those over its
 * scenario, here, setting one up, new or from the project, keeping it in the
 * project, deleting it there and drawing it with a new seed; and those that
 * run it (`preview-run-commands.ts`).
 *
 * A scenario set up is the session's (`game-preview-store.ts`) until it is
 * kept, which runs the project's scenario commands as one change the history
 * keeps; deleting a kept one runs its removal.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  unchanged,
  type Command,
  type CommandAvailability,
} from '@audiogubbins/commands';
import {
  addScenarioInvocation,
  removeScenarioInvocation,
  setScenarioInvocation,
} from '@audiogubbins/project-commands';

import { draftChanged } from '../state/game-preview-store.js';
import { firstSubject, newScenario, scenarioProblem, seedOf } from '../state/scenario-drafts.js';
import {
  NO_SCENARIO,
  PreviewCommand,
  openState,
  previewRunCommands,
} from './preview-run-commands.js';
import { idArgument, sayWhenSettled, sessionOf } from './project-access.js';
import { availableUnless, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

const NO_GROUP = 'Make an asset group first: a scenario plays groups.';

function draftAvailability(context: ShellContext): CommandAvailability {
  return context.gamePreview.store.get().draft === undefined ? unavailable(NO_SCENARIO) : AVAILABLE;
}

function newScenarioCommand(): Command<ShellContext> {
  return shellCommand(
    PreviewCommand.NewScenario,
    'New preview scenario',
    CommandCategory.Tools,
    (context) => {
      const state = openState(context);
      if (typeof state === 'string') return state;
      const subject = firstSubject(state.gameAudio);
      if (subject === undefined) return NO_GROUP;
      const ordinal = (state.gameAudio?.scenarios.size ?? 0) + 1;
      context.gamePreview.store.open(newScenario(context.ids, subject, ordinal), undefined);
      context.interaction.announce(
        'A new preview scenario is set up. Keep it to save it in the project.',
      );
      return undefined;
    },
    {
      keywords: ['game', 'preview', 'scenario', 'new', 'emitter'],
      availability: (context) => {
        const state = openState(context);
        if (typeof state === 'string') return unavailable(state);
        return availableUnless(firstSubject(state.gameAudio) === undefined ? NO_GROUP : undefined);
      },
    },
  );
}

function chooseScenarioCommand(): Command<ShellContext> {
  return shellCommand(
    PreviewCommand.ChooseScenario,
    'Set up a kept preview scenario',
    CommandCategory.Tools,
    (context, invocation) => {
      const state = openState(context);
      if (typeof state === 'string') return state;
      const named = idArgument<'GamePreviewScenarioId'>(invocation, 'scenario', 'scenario');
      if ('refused' in named) return named.refused;
      const kept = state.gameAudio?.scenarios.get(named.id);
      if (kept === undefined) return 'The project has no such scenario.';
      const { draft } = context.gamePreview.store.get();
      if (draft?.scenario === kept) {
        return unchanged(
          'preview.scenario-set-up',
          `${kept.name} is set up as the project keeps it.`,
        );
      }
      context.gamePreview.store.open(kept, kept);
      context.interaction.announce(`${kept.name} is set up.`);
      return undefined;
    },
    {
      keywords: ['game', 'preview', 'scenario', 'open', 'choose'],
      discoverable: false,
      availability: (context) => {
        const state = openState(context);
        if (typeof state === 'string') return unavailable(state);
        return (state.gameAudio?.scenarios.size ?? 0) === 0
          ? unavailable('The project keeps no preview scenario.')
          : AVAILABLE;
      },
    },
  );
}

function keepScenarioCommand(): Command<ShellContext> {
  return shellCommand(
    PreviewCommand.KeepScenario,
    'Keep the preview scenario in the project',
    CommandCategory.Tools,
    (context) => {
      const session = sessionOf(context);
      if (typeof session === 'string') return session;
      const { store } = context.gamePreview;
      const scenario = store.get().draft?.scenario;
      if (scenario === undefined) return NO_SCENARIO;
      const game = session.getSnapshot().model.state.gameAudio;
      const problem = scenarioProblem(game, scenario);
      if (problem !== undefined) return problem;
      const held = game?.scenarios.has(scenario.id) === true;
      const work = session.run(
        held ? setScenarioInvocation(scenario) : addScenarioInvocation(scenario),
      );
      sayWhenSettled(context, work, (outcome) => {
        if (outcome.kind !== 'applied') return outcome.reason;
        store.kept(scenario);
        return `${scenario.name} is kept in the project.`;
      });
      return undefined;
    },
    {
      keywords: ['game', 'preview', 'scenario', 'save', 'keep'],
      availability: (context) => {
        const session = sessionOf(context);
        if (typeof session === 'string') return unavailable(session);
        const draft = context.gamePreview.store.get().draft;
        if (draft === undefined) return unavailable(NO_SCENARIO);
        if (!draftChanged(draft)) return unavailable('The project keeps this scenario as it is.');
        const game = session.getSnapshot().model.state.gameAudio;
        return availableUnless(scenarioProblem(game, draft.scenario));
      },
    },
  );
}

function deleteScenarioCommand(): Command<ShellContext> {
  return shellCommand(
    PreviewCommand.DeleteScenario,
    'Delete the preview scenario',
    CommandCategory.Tools,
    (context) => {
      const { store, runner } = context.gamePreview;
      const draft = store.get().draft;
      if (draft === undefined) return NO_SCENARIO;
      const { scenario } = draft;
      if (draft.kept !== undefined) {
        const session = sessionOf(context);
        if (typeof session === 'string') return session;
        sayWhenSettled(context, session.run(removeScenarioInvocation(scenario.id)), (outcome) => {
          if (outcome.kind !== 'applied') return outcome.reason;
          if (store.get().draft?.scenario.id === scenario.id) store.close();
          return `${scenario.name} is deleted from the project.`;
        });
      } else {
        store.close();
        context.interaction.announce(`${scenario.name} is set aside; it was never kept.`);
      }
      if (runner.playing()?.scenario === scenario.id) runner.stop();
      return undefined;
    },
    {
      keywords: ['game', 'preview', 'scenario', 'delete', 'remove'],
      availability: (context) => {
        const draft = context.gamePreview.store.get().draft;
        if (draft === undefined) return unavailable(NO_SCENARIO);
        const session = draft.kept === undefined ? undefined : sessionOf(context);
        return typeof session === 'string' ? unavailable(session) : AVAILABLE;
      },
    },
  );
}

function newSeedCommand(): Command<ShellContext> {
  return shellCommand(
    PreviewCommand.NewSeed,
    'Draw the preview with a new seed',
    CommandCategory.Tools,
    (context) => {
      if (context.gamePreview.store.get().draft === undefined) return NO_SCENARIO;
      // A seed from a new identifier: as unforeseeable as a random one, and
      // the same scenario and seed still draw the same choices.
      const seed = seedOf(context.ids.next<'GamePreviewScenarioId'>());
      context.gamePreview.store.edit((scenario) => ({ ...scenario, seed }));
      context.interaction.announce(`The seed is now ${String(seed)}; run again to hear it.`);
      return undefined;
    },
    {
      keywords: ['game', 'preview', 'seed', 'random', 'variation'],
      availability: draftAvailability,
    },
  );
}

/** Every command of the Game preview. */
export function gamePreviewCommands(): readonly Command<ShellContext>[] {
  return [
    newScenarioCommand(),
    chooseScenarioCommand(),
    keepScenarioCommand(),
    deleteScenarioCommand(),
    newSeedCommand(),
    ...previewRunCommands(),
  ];
}
