/**
 * The Game preview's commands that run it (ADR-0104, ADR-0013): running the
 * scenario set up, stopping it, and triggering and stopping an emitter by
 * hand; the scenario's own are `game-preview-commands.ts`, which gathers both.
 *
 * A scenario set up is the session's (`game-preview-store.ts`) until it is
 * kept, which runs the project's scenario commands as one change the history
 * keeps; deleting a kept one runs its removal. A run reads the project as it
 * stands and changes none of it: it is audio runtime state, played through the
 * one transport at the person's preview quality, and none of its commands is
 * undoable or reaches the project's history.
 */

import {
  AVAILABLE,
  CommandCategory,
  unavailable,
  type Command,
  type CommandAvailability,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { GamePreviewScenario, PreviewEmitterId } from '@audiogubbins/game-audio';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';
import type { ProjectState } from '@audiogubbins/project-format';

import { previewSetup } from '../audio/preview-setup.js';
import { previewQualityOf } from '../state/audio-settings-store.js';
import { reasonsOf } from '../state/reasons.js';
import { scenarioProblem } from '../state/scenario-drafts.js';
import { shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The Game preview's command identifiers. */
export const PreviewCommand = {
  NewScenario: 'preview.new-scenario',
  ChooseScenario: 'preview.choose-scenario',
  KeepScenario: 'preview.keep-scenario',
  DeleteScenario: 'preview.delete-scenario',
  NewSeed: 'preview.new-seed',
  Run: 'preview.run',
  Stop: 'preview.stop',
  Trigger: 'preview.trigger',
  StopVoices: 'preview.stop-voices',
} as const;

export const NO_SCENARIO = 'No preview scenario is set up.';
const NOT_RUNNING = 'No preview is running.';

/** The preview's commands as the menu offers them: the scenario's, then the run's. */
export const PREVIEW_MENU_IDS: readonly string[] = [
  PreviewCommand.NewScenario,
  PreviewCommand.KeepScenario,
  PreviewCommand.DeleteScenario,
  PreviewCommand.NewSeed,
  PreviewCommand.Run,
  PreviewCommand.Trigger,
  PreviewCommand.Stop,
];

/** The project open in this tab, read or changed here, or why there is none. */
export function openState(context: ShellContext): ProjectState | string {
  const open = context.projects?.project.get();
  return open?.kind === 'open' ? open.snapshot.model.state : 'No project is open.';
}

/** The project and the scenario set up, which can be played as they stand, or why not. */
function playable(
  context: ShellContext,
): { readonly state: ProjectState; readonly scenario: GamePreviewScenario } | string {
  const state = openState(context);
  if (typeof state === 'string') return state;
  const scenario = context.gamePreview.store.get().draft?.scenario;
  if (scenario === undefined) return NO_SCENARIO;
  return scenarioProblem(state.gameAudio, scenario) ?? { state, scenario };
}

/**
 * The emitter an invocation names, or the first of the scenario playing, or
 * why there is none. An identifier is text, so it is answered inside an
 * object, apart from the refusal's text.
 */
function emitterOf(
  context: ShellContext,
  invocation: CommandInvocation,
): { readonly emitter: PreviewEmitterId } | string {
  const run = context.gamePreview.runner.playing();
  if (run === undefined) return NOT_RUNNING;
  const named = textArgument(invocation, 'emitter');
  const emitter = named === undefined ? run.emitters[0] : run.emitters.find((one) => one === named);
  return emitter === undefined ? 'The preview playing has no such emitter.' : { emitter };
}

function runningAvailability(context: ShellContext): CommandAvailability {
  return context.gamePreview.runner.playing() === undefined ? unavailable(NOT_RUNNING) : AVAILABLE;
}

function runCommand(): Command<ShellContext> {
  return shellCommand(
    PreviewCommand.Run,
    'Run the game preview',
    CommandCategory.Transport,
    (context) => {
      const ready = playable(context);
      if (typeof ready === 'string') return ready;
      const made = previewSetup(ready.scenario, {
        state: ready.state,
        assets: context.assets,
        grade: previewQualityOf(context.audioSettings.get()).settings.resampling,
        catalogue: PROCESSOR_CATALOGUE,
      });
      if (!made.ok) return made.reasons;
      const started = context.gamePreview.runner.start(made.setup);
      return started.ok ? undefined : reasonsOf(started.failures);
    },
    {
      keywords: ['game', 'preview', 'run', 'play', 'scenario', 'simulate'],
      availability: (context) => {
        const ready = playable(context);
        return typeof ready === 'string' ? unavailable(ready) : AVAILABLE;
      },
    },
  );
}

/** A command that acts on an emitter of the run playing: the one named, or its first. */
function emitterCommand(
  id: string,
  label: string,
  act: (context: ShellContext, emitter: PreviewEmitterId) => void,
  keywords: readonly string[],
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.Transport,
    (context, invocation) => {
      const named = emitterOf(context, invocation);
      if (typeof named === 'string') return named;
      act(context, named.emitter);
      return undefined;
    },
    { keywords, availability: runningAvailability, takesItsKeyOnlyWhenAvailable: true },
  );
}

function runControlCommands(): readonly Command<ShellContext>[] {
  return [
    shellCommand(
      PreviewCommand.Stop,
      'Stop the game preview',
      CommandCategory.Transport,
      (context) => {
        context.gamePreview.runner.stop();
        context.interaction.announce('The preview stopped.');
        return undefined;
      },
      { keywords: ['game', 'preview', 'stop'], availability: runningAvailability },
    ),
    emitterCommand(
      PreviewCommand.Trigger,
      'Trigger an emitter of the preview',
      (context, emitter) => {
        context.gamePreview.runner.trigger(emitter);
      },
      ['game', 'preview', 'trigger', 'fire', 'play', 'emitter'],
    ),
    emitterCommand(
      PreviewCommand.StopVoices,
      "Stop an emitter's voices",
      (context, emitter) => {
        context.gamePreview.runner.stopVoices(emitter);
      },
      ['game', 'preview', 'stop', 'voices', 'emitter'],
    ),
  ];
}

/** The commands that run the preview: run, stop, trigger and stop an emitter's voices. */
export function previewRunCommands(): readonly Command<ShellContext>[] {
  return [runCommand(), ...runControlCommands()];
}
