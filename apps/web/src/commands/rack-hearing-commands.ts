/**
 * Hearing an asset processed or as its original (REQ-AUDIO-019): every chain
 * it runs bypassed, its range rack edits, its rack and a region's rack, and
 * every other edit kept. A listening choice of the page, never a change of
 * the project; the transport follows it where it plays, from where the
 * listener is (`playing-asset.ts`), and the Transport panel shows which is
 * heard.
 */

import { CommandCategory, unchanged, type Command } from '@audiogubbins/commands';

import { Hearing } from '../state/hearing-store.js';
import { focusedEditor, needsEditor } from './editor-target.js';
import { availableUnless, shellCommand } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** Why the original of the asset in the editor in use cannot be heard apart, or nothing where it can. */
function noOriginal(context: ShellContext): string | undefined {
  const view = focusedEditor(context);
  if (typeof view === 'string') return view;
  return view.asset.original === undefined
    ? `No chain processes ${view.asset.name}, so its original is the sound heard.`
    : undefined;
}

function listenOriginalCommand(): Command<ShellContext> {
  return shellCommand(
    'transport.listen-original',
    'Hear the original',
    CommandCategory.Transport,
    (context) => {
      const refused = noOriginal(context);
      if (refused !== undefined) return refused;
      if (context.hearing.get() === Hearing.Original) {
        return unchanged('transport.hearing-unchanged', 'The original is heard already.');
      }
      context.hearing.choose(Hearing.Original);
      context.interaction.announce('Hearing the original, every chain bypassed.');
      return undefined;
    },
    {
      availability: (context) => availableUnless(noOriginal(context)),
      keywords: ['original', 'bypass', 'compare', 'dry', 'unprocessed', 'listen'],
      description:
        'Plays the asset in the editor in use with every chain it runs bypassed and every other edit kept, from where it plays.',
    },
  );
}

function listenProcessedCommand(): Command<ShellContext> {
  return shellCommand(
    'transport.listen-processed',
    'Hear it processed',
    CommandCategory.Transport,
    (context) => {
      if (context.hearing.get() === Hearing.Processed) {
        return unchanged('transport.hearing-unchanged', 'The processed sound is heard already.');
      }
      context.hearing.choose(Hearing.Processed);
      context.interaction.announce('Hearing it processed.');
      return undefined;
    },
    {
      availability: needsEditor,
      keywords: ['processed', 'wet', 'compare', 'effects', 'listen'],
      description:
        'Plays the asset in the editor in use through every chain it runs, from where it plays.',
    },
  );
}

/** The commands that choose between hearing an asset processed and as its original. */
export function rackHearingCommands(): readonly Command<ShellContext>[] {
  return [listenOriginalCommand(), listenProcessedCommand()];
}
