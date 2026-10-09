/**
 * What each part of AudioGubbins that writes to the log is called.
 *
 * The identifier is what a record carries and what a filter matches on; a
 * settings heading built from it would read "What the commands log records",
 * showing the identifier to the person changing the setting. Two forms, because
 * the name stands alone in the log's column and sits inside a sentence in a
 * settings label: one form in both places would read "What The shell records".
 *
 * A category this build does not know falls back to its identifier, because a
 * later phase's records are still worth filtering. Its own module rather than
 * the composition root's: how a subsystem is spelt for a reader is a view's
 * business, and the root is what builds the application.
 */

import { isLogCategory } from '@audiogubbins/diagnostics';

/**
 * The subsystems that write to the log from the moment the application starts.
 *
 * Listed so each can be given its own level before it has written anything: a
 * user raising the level for commands to investigate a problem should not have
 * to wait for a command to log first.
 */
const KNOWN_LOG_CATEGORIES = [
  'shell',
  'commands',
  'audio',
  'editor',
  // Project storage: opening, saving and recovering projects, the project
  // commands' own bus, and the storage beneath them, each levelled apart.
  'projects',
  'project-commands',
  'storage',
  // The input, monitoring and the latency calibration (ADR-0070).
  'recording',
] as const;

/** One of the categories above. */
type KnownLogCategory = (typeof KNOWN_LOG_CATEGORIES)[number];

/** A category's name, standing alone and inside a sentence. */
interface CategoryNames {
  readonly alone: string;
  readonly inSentence: string;
}

/**
 * Each known category's names. Keyed by the list above, so a category cannot
 * be listed without being named.
 */
const LOG_CATEGORY_NAMES: Readonly<Record<KnownLogCategory, CategoryNames>> = {
  shell: { alone: 'Shell', inSentence: 'the shell' },
  commands: { alone: 'Commands', inSentence: 'commands' },
  audio: { alone: 'Audio engine', inSentence: 'the audio engine' },
  editor: { alone: 'Editor', inSentence: 'the editor' },
  projects: { alone: 'Projects', inSentence: 'projects' },
  'project-commands': { alone: 'Project changes', inSentence: 'changes to projects' },
  storage: { alone: 'Storage', inSentence: 'storage' },
  recording: { alone: 'Recording', inSentence: 'recording' },
};

/** The same names, looked up by whatever a record carries. */
const NAMES_BY_CATEGORY: ReadonlyMap<string, CategoryNames> = new Map(
  Object.entries(LOG_CATEGORY_NAMES),
);

/** What a subsystem is called where it stands alone, as in a list or a column. */
export function logCategoryName(category: string): string {
  return NAMES_BY_CATEGORY.get(category)?.alone ?? category;
}

/** What a subsystem is called inside a sentence. */
export function logCategoryInSentence(category: string): string {
  return NAMES_BY_CATEGORY.get(category)?.inSentence ?? category;
}

/**
 * The subsystems a user can give their own level, in order.
 *
 * The known ones, the ones already given a level, and the ones that have
 * written a record. Only category names: a record carrying anything else was
 * not written by a logger, and its category is not something a user should be
 * offered.
 */
export function logCategoriesFrom(
  levelled: readonly string[],
  recorded: readonly string[],
): readonly string[] {
  return [...new Set([...KNOWN_LOG_CATEGORIES, ...levelled, ...recorded])]
    .filter(isLogCategory)
    .sort();
}
