/**
 * Exporting and discarding the stored text AudioGubbins could not read.
 *
 * Each store that finds stored text it cannot read keeps it, set aside or,
 * with no room, where it was found, and says so in a notice. Kept and never
 * offered, that text was the user's in name only, and the room it took was
 * room no write could have: the export hands it to the user as a file, and
 * the discard gives the room back once they have it (REQ-UX-059,
 * REQ-STOR-106). Both are commands, so the settings, the palette and a future
 * macro reach them by the one route (REQ-EDIT-073).
 */

import { CommandCategory, type Command } from '@audiogubbins/commands';

import { isNoticeAbout, subjectOf, type NoticeAbout } from '../state/recovery-notices.js';
import type { Discarded, UnreadCopy } from '../state/text-custody.js';
import { availableUnless, report, shellCommand, textArgument } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The name of the exported file, which holds nothing the user named. */
const EXPORT_FILE_NAME = 'audiogubbins-unread-text.json';

/** What the exported file says it is, so a reader of it knows what it holds. */
const EXPORT_FORMAT = 'audiogubbins.unread-text';

/** Why there is nothing to export or discard. */
const NOTHING_UNREAD = 'There is no text that could not be read.';

/** Every thing text nobody could read is about, in the order the notices stand. */
const EVERY_ABOUT: readonly NoticeAbout[] = ['layout', 'collection', 'profiles'];

/** Why there is nothing of the text about `about`, or `undefined` where there is. */
function unreadProblem(context: ShellContext, about: NoticeAbout): string | undefined {
  return about === 'profiles'
    ? context.shortcuts.unreadProblem()
    : context.workspace.unreadProblem(about);
}

/** Every text about `about`, as it is exported. */
function copiesOf(context: ShellContext, about: NoticeAbout): readonly UnreadCopy[] {
  return about === 'profiles'
    ? context.shortcuts.unreadCopies()
    : context.workspace.unreadCopies(about);
}

/** Discards the text about `about`, or says why not. */
function discardOf(context: ShellContext, about: NoticeAbout): Discarded | string {
  return about === 'profiles'
    ? context.shortcuts.discardUnread()
    : context.workspace.discardUnread(about);
}

/** Why there is no text at all to export or discard, or `undefined` where there is. */
function anythingProblem(context: ShellContext): string | undefined {
  return EVERY_ABOUT.some((about) => unreadProblem(context, about) === undefined)
    ? undefined
    : NOTHING_UNREAD;
}

/** The refusal of an `about` argument that names nothing text is kept about. */
function noSuchThing(named: string): string {
  return `There is no text that could not be read about anything called "${named}".`;
}

/**
 * What the command's `about` argument names, every thing where it names none,
 * or why it names nothing text is kept about.
 */
function aboutNamed(named: string | undefined): readonly NoticeAbout[] | string {
  if (named === undefined) return EVERY_ABOUT;
  return isNoticeAbout(named) ? [named] : noSuchThing(named);
}

/**
 * The exported file: each text whole, with what it is about, the key it is
 * stored under, and whether it is set aside or left where it was found, so a
 * text can be put back by hand under the key it came from.
 */
function exportedFile(context: ShellContext, abouts: readonly NoticeAbout[]): string {
  const texts = abouts.flatMap((about) =>
    copiesOf(context, about).map(({ key, setAside, text }) => ({
      about,
      key,
      where: setAside ? 'set aside' : 'left where it was found',
      text,
    })),
  );
  return JSON.stringify(
    { format: EXPORT_FORMAT, exported: new Date(context.clock.now()).toISOString(), texts },
    null,
    2,
  );
}

/** Exporting the text that could not be read about one thing, or about everything. */
function exportCommand(): Command<ShellContext> {
  return shellCommand(
    'settings.export-unread-text',
    'Export text that could not be read',
    CommandCategory.Settings,
    (context, invocation) => {
      const abouts = aboutNamed(textArgument(invocation, 'about'));
      if (typeof abouts === 'string') return abouts;
      // One thing named is refused for its own reason; everything, for none.
      const problems = abouts.map((about) => unreadProblem(context, about));
      const kept = abouts.filter((_, index) => problems[index] === undefined);
      if (kept.length === 0)
        return (abouts.length === 1 ? problems[0] : undefined) ?? NOTHING_UNREAD;

      const refusal = context.files.save(
        EXPORT_FILE_NAME,
        exportedFile(context, kept),
        'application/json',
      );
      return report(
        context,
        refusal,
        `The text that could not be read was saved as "${EXPORT_FILE_NAME}".`,
      );
    },
    {
      keywords: ['unreadable', 'damaged', 'recovered', 'export', 'save', 'file', 'storage'],
      description:
        'Saves to a file every stored text AudioGubbins could not read, so nothing of it is lost when you discard it.',
      availability: (context) => availableUnless(anythingProblem(context)),
    },
  );
}

/** Discarding the text that could not be read about one thing named. */
function discardCommand(): Command<ShellContext> {
  return shellCommand(
    'settings.discard-unread-text',
    'Discard text that could not be read',
    CommandCategory.Settings,
    (context, invocation) => {
      // Named, never all at once: discarding cannot be undone, and each
      // thing's text is discarded where the settings show it, after the
      // reader has been told so.
      const named = textArgument(invocation, 'about');
      if (named === undefined) {
        return 'Choose what to discard in the Workspaces or Shortcuts settings.';
      }
      if (!isNoticeAbout(named)) return noSuchThing(named);

      const discarded = discardOf(context, named);
      if (typeof discarded === 'string') return discarded;
      const done = `The text about ${subjectOf(named)} that could not be read is discarded.`;
      return report(
        context,
        undefined,
        discarded.keptAgain === undefined ? done : `${done} ${discarded.keptAgain}`,
      );
    },
    {
      keywords: ['unreadable', 'damaged', 'recovered', 'discard', 'delete', 'room', 'storage'],
      description:
        'Deletes for good the stored text AudioGubbins could not read about one thing, which makes room. Export it first to keep a copy.',
      availability: (context) => availableUnless(anythingProblem(context)),
    },
  );
}

/** Exporting the text that could not be read, and discarding it. */
export function unreadTextCommands(): readonly Command<ShellContext>[] {
  return [exportCommand(), discardCommand()];
}
