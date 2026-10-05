/**
 * Copy, cut and paste (ADR-0053): copying takes the selection's range and
 * channels from the plan of the asset or region shown, or all of it where
 * nothing is selected; a cut is a copy and a deletion, the deletion the one
 * change the project keeps; a paste inserts what was copied at the playhead,
 * or replaces the selected range.
 *
 * Every paste is planned by the clipboard package and run by the storage
 * worker, which shows the media it reads is there first, so a paste within
 * one project and one from another take the same path, and a missing or
 * changed source refuses the paste and leaves the project as it was. A
 * payload at another rate is converted only when the command says so.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import { copyAudio, planPaste, type CopiedAudio, type PasteRequest } from '@audiogubbins/clipboard';
import { formatPosition } from '@audiogubbins/timeline';

import {
  RANGE_ONLY,
  RANGE_OR_WHOLE,
  editScope,
  editedView,
  partOfTheChannels,
  type EditScope,
} from './edit-target.js';
import type { ProjectOwner } from '../assets/editor-asset.js';
import { playheadOf, selectedTarget, type EditorTarget } from './editor-target.js';
import {
  chainInvocation,
  changeProject,
  needsProjectAsset,
  onAsset,
  onWholeAsset,
} from './project-edits.js';
import { readyProjects, sayWhenSettled } from './project-access.js';
import { shellCommand, type BodyAnswer } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

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

/** Whether two copies hold the same audio from the same project. */
function sameCopy(one: CopiedAudio | undefined, other: CopiedAudio): boolean {
  return (
    one?.origin === other.origin && JSON.stringify(one.payload) === JSON.stringify(other.payload)
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

/** Where a paste goes: over the selected range, or in at the playhead anywhere else. */
function pastedAt(
  context: ShellContext,
  view: EditorTarget,
  owner: ProjectOwner,
): PasteRequest['place'] {
  const target = selectedTarget(context, view.asset, RANGE_ONLY);
  if (typeof target !== 'string' && target.kind === 'time') {
    const { start, end } = target.range;
    return { kind: 'replace', range: { start: onAsset(owner, start), end: onAsset(owner, end) } };
  }
  return { kind: 'at', at: onAsset(owner, playheadOf(context, view.asset)) };
}

function pasteCommand(): Command<ShellContext> {
  return clipboardCommand(
    'edit.paste',
    'Paste',
    (context, invocation) => {
      const { copied: held, description } = context.clipboard.get();
      if (held === undefined) return 'Nothing is copied. Copy or cut some audio first.';
      const found = editedView(context, invocation);
      if (typeof found === 'string') return found;
      const stores = readyProjects(context);
      if (typeof stores === 'string') return stores;
      const { owner, state, session } = found.project;
      const planned = planPaste(
        state,
        {
          copied: held,
          asset: owner.asset.id,
          place: pastedAt(context, found.view, owner),
          convertRate: invocation.arguments?.['convertRate'] === true,
        },
        context.ids,
      );
      if (!planned.ok) return planned.failures[0].summary;
      sayWhenSettled(
        context,
        stores.pastes.paste(session, {
          description: 'Paste',
          records: planned.value.records,
          asset: owner.asset.id,
          operations: planned.value.operations,
        }),
        (outcome) =>
          outcome.kind === 'applied'
            ? onWholeAsset(owner, `Pasted ${description ?? 'the copied audio'}.`)
            : outcome.reason,
      );
      return undefined;
    },
    ['paste', 'clipboard', 'insert'],
  );
}

/** Copy, cut and paste. */
export function clipboardCommands(): readonly Command<ShellContext>[] {
  return [cutCommand(), copyCommand(), pasteCommand()];
}
