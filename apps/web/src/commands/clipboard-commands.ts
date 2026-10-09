/**
 * Copy, cut and paste (ADR-0053): copying takes the selection's range and
 * channels from the plan of the asset or region shown, or all of it where
 * nothing is selected; a cut is a copy and a deletion, the deletion the one
 * change the project keeps; a paste inserts what was copied at the playhead,
 * or replaces the selected range.
 *
 * Every paste is planned by the clipboard package and run by the storage
 * worker, which shows the media it reads is there first, so a paste within one
 * project and one from another take the same path, and a missing or changed
 * source refuses the paste and leaves the project as it was. Audio at another
 * rate is converted only by its own command, which a plain paste's refusal
 * names.
 */

import { ENGINE_VERSIONS } from '@audiogubbins/audio-engine';
import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandId,
  type CommandInvocation,
} from '@audiogubbins/commands';
import {
  copyAudio,
  planPaste,
  type AudioPayload,
  type ClipboardPayload,
  type PasteRequest,
} from '@audiogubbins/clipboard';
import { canonicalJson, writeEditPlan } from '@audiogubbins/project-format';
import { formatPosition } from '@audiogubbins/timeline';

import {
  RANGE_ONLY,
  RANGE_OR_WHOLE,
  editScope,
  editedView,
  insertionPlace,
  partOfTheChannels,
  type EditScope,
} from './edit-target.js';
import {
  chainInvocation,
  changeProject,
  needsProjectAsset,
  onWholeAsset,
} from './project-edits.js';
import { sampleRateWords } from '../wording.js';
import { readyProjects, sayWhenSettled } from './project-access.js';
import { shellCommand, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The command that pastes audio converted to the asset's rate, as a refusal names it. */
const PASTE_CONVERTING = 'Paste, converting the sample rate';

function clipboardCommand(
  id: string,
  label: string,
  run: (context: ShellContext, invocation: CommandInvocation) => BodyAnswer,
  keywords: readonly string[],
): Command<ShellContext> {
  return shellCommand(id, label, CommandCategory.Edit, run, {
    availability: needsProjectAsset,
    keywords,
  });
}

/**
 * Whether two copies hold the same audio from the same project, each plan
 * compared as the project writes it, so every value in it counts.
 */
function sameCopy(one: ClipboardPayload | undefined, other: AudioPayload): boolean {
  return (
    one?.kind === 'audio' &&
    one.origin === other.origin &&
    canonicalJson(writeEditPlan(one.plan)) === canonicalJson(writeEditPlan(other.plan))
  );
}

/** Copies the scope to the clipboard, answering what it was called, or why it could not. */
function copied(
  context: ShellContext,
  scope: EditScope,
): string | { readonly description: string; readonly again: boolean } {
  const { owner, state } = scope.project;
  // The plan shown is the view's own, so its range is the view's.
  const copy = copyAudio(state, owner.plan, scope.shown, scope.target.channels);
  if (!copy.ok) return copy.failures[0].summary;
  const { asset, state: view } = scope.view;
  const length = formatPosition(
    scope.shown.end - scope.shown.start,
    asset.sampleRate,
    view.timeFormat,
  );
  const description = scope.whole ? `all of ${asset.name}` : `${length} of ${asset.name}`;
  const again = sameCopy(context.clipboard.get().copied, copy.value);
  if (!again) context.clipboard.hold(copy.value, description);
  return { description, again };
}

function copyCommand(): Command<ShellContext> {
  return clipboardCommand(
    'edit.copy',
    'Copy',
    (context, invocation) => {
      const scope = editScope(context, invocation, RANGE_OR_WHOLE);
      if (typeof scope === 'string') return scope;
      const done = copied(context, scope);
      if (typeof done === 'string') return done;
      if (done.again) return unchanged('edit.copied-already', 'That audio is copied already.');
      context.interaction.announce(`Copied ${done.description}.`);
      return undefined;
    },
    ['copy', 'clipboard', 'duplicate'],
  );
}

function cutCommand(): Command<ShellContext> {
  return clipboardCommand(
    'edit.cut',
    'Cut',
    (context, invocation) => {
      const scope = editScope(context, invocation, RANGE_ONLY);
      if (typeof scope === 'string') return scope;
      const split = partOfTheChannels(scope);
      if (split !== undefined) return split;
      const done = copied(context, scope);
      if (typeof done === 'string') return done;
      const { owner, session } = scope.project;
      changeProject(context, session, {
        description: 'Cut',
        invocations: [
          chainInvocation(context, scope.target, { kind: 'delete', range: scope.target.range }),
        ],
        said: onWholeAsset(owner, `Cut ${done.description}.`),
      });
      return undefined;
    },
    ['cut', 'clipboard', 'remove'],
  );
}

/** The audio the clipboard holds, and what it was called, or why it holds none. */
function heldAudio(
  context: ShellContext,
): { readonly audio: AudioPayload; readonly description: string | undefined } | string {
  const { copied, description } = context.clipboard.get();
  if (copied === undefined) return 'Nothing is copied. Copy or cut some audio first.';
  if (copied.kind !== 'audio') {
    return 'The clipboard holds processors, not audio. Paste them into a rack.';
  }
  return { audio: copied, description };
}

/**
 * A paste, converting audio at another rate to the asset's by the engine's
 * canonical resampler where `convertRate`.
 */
function pasteCommand(
  id: string,
  label: string,
  convertRate: boolean,
  keywords: readonly string[],
): Command<ShellContext> {
  return clipboardCommand(
    id,
    label,
    (context, invocation) => {
      const held = heldAudio(context);
      if (typeof held === 'string') return held;
      const found = editedView(context, invocation);
      if (typeof found === 'string') return found;
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const { owner, state, session } = found.project;
      const place = insertionPlace(context, found.view, owner);
      if (typeof place === 'string') return place;
      const request: PasteRequest = {
        payload: held.audio,
        asset: owner.asset.id,
        place,
        convertWith: convertRate ? ENGINE_VERSIONS.resampler : undefined,
      };
      const planned = planPaste(state, request, context.ids);
      if (!planned.ok) {
        const [failure] = planned.failures;
        if (failure.code !== 'editing.payload-rate') return failure.summary;
        const from = sampleRateWords(held.audio.plan.streams[0].sampleRate);
        const to = sampleRateWords(owner.asset.sampleRate);
        return `The copied audio is at ${from} and this audio is at ${to}. To convert it to ${to} as it is pasted, use ${PASTE_CONVERTING}.`;
      }
      const { records, operations } = planned.value;
      sayWhenSettled(
        context,
        stores.pastes.paste(session, {
          description: 'Paste',
          records,
          asset: owner.asset.id,
          operations,
        }),
        (outcome) =>
          outcome.kind === 'applied'
            ? onWholeAsset(owner, `Pasted ${held.description ?? 'the copied audio'}.`)
            : outcome.reason,
      );
      return undefined;
    },
    keywords,
  );
}

/** Copy, cut and paste. */
export function clipboardCommands(): readonly Command<ShellContext>[] {
  return [
    cutCommand(),
    copyCommand(),
    pasteCommand('edit.paste', 'Paste', false, ['paste', 'clipboard', 'insert']),
    pasteCommand('edit.paste-converting-rate', PASTE_CONVERTING, true, [
      'paste',
      'clipboard',
      'insert',
      'sample rate',
      'resample',
      'convert',
    ]),
  ];
}

/**
 * Every clipboard command, which a shortcut runs only where the keyboard is in
 * an editor: everywhere else the platform's own clipboard keys copy and paste
 * the page's text, so the browser is left to act on them (`use-shortcuts.ts`).
 * Named by command rather than by key, so a command bound to other keys takes
 * the rule with it.
 */
export const CLIPBOARD_COMMANDS: ReadonlySet<CommandId> = new Set(
  clipboardCommands().map((command) => command.id),
);
