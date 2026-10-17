/**
 * The words the person finds import and export by (ADR-0090, ADR-0092): the
 * menu entries, the buttons and the names of the surfaces, declared once so
 * the commands, the surfaces and the browser suite that looks for them by
 * name agree.
 */

import type { CollisionAnswer } from '@audiogubbins/import-export';
import { quoted } from '@audiogubbins/text';

/** The labels of the commands the File menu lists. */
export const IMPORT_EXPORT_MENU = {
  importFiles: 'Import audio…',
  importFolder: 'Import a folder of audio…',
  exportAudio: 'Export audio…',
} as const;

/** The button on each region's row and on the Quick Edit banner that opens the Export dialog. */
export const EXPORT_BUTTON = 'Export…';

/** The Export dialog's title, the disclosure of every setting, and the button that starts it. */
export const EXPORT_DIALOG_WORDS = {
  title: 'Export',
  everySetting: 'Every setting',
  start: 'Export',
} as const;

/**
 * The collision prompt's title, its button for each answer, and its checkbox
 * for the rest of the batch.
 */
export const COLLISION_PROMPT_WORDS = {
  title: 'File already exists',
  answers: {
    overwrite: 'Replace',
    rename: 'Keep both',
    skip: 'Skip',
  } satisfies Readonly<Record<CollisionAnswer, string>>,
  forTheRest: 'Do the same for the rest',
} as const;

/** The collision prompt's first sentence, naming the file whose name is taken as the folder lists it. */
export function collisionPromptSentence(name: string): string {
  return `A file named ${quoted(name)} is there already.`;
}

/** The accessible name of the list of files an import is bringing in. */
export const IMPORT_LIST_LABEL = 'Files being imported';
