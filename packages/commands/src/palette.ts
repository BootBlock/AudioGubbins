/**
 * Finding a command by typing part of its name.
 *
 * REQ-EDIT-073 requires command discovery and REQ-UX-066 requires the palette
 * to show a command's shortcut. A palette is how a user finds an action they
 * cannot remember the location of, so the matching has to forgive: the right
 * result for "rst lay" is "Reset layout".
 *
 * The ranking is deterministic and depends on nothing outside its arguments. It
 * does not learn from what the user has chosen before: REQ-PRIV-162 prohibits
 * usage tracking, and a palette that reorders itself based on a hidden history
 * is also one whose results a user cannot predict.
 */

import type { KeyboardLayout } from '@audiogubbins/input';

import type { Command, CommandId } from './command.js';
import { shortcutOffered } from './platform-reservations.js';
import type { KeyboardConvention, ShortcutProfile } from './shortcut.js';

/** One palette result. */
export interface PaletteResult<TContext> {
  readonly command: Command<TContext>;

  /** How well it matched. Higher is better. */
  readonly score: number;

  /**
   * Which characters of the label the query matched, for highlighting.
   *
   * Empty when the match came from a keyword rather than the label, so the
   * interface underlines nothing rather than underlining the wrong letters.
   */
  readonly matchedLabelIndices: readonly number[];

  /** The shortcut to show beside the command, already written for the platform. */
  readonly shortcutText?: string;

  /** Why the command cannot run, when it cannot. */
  readonly unavailableReason?: string;
}

/** What the palette needs besides the query. */
export interface PaletteOptions<TContext> {
  readonly context: TContext;
  readonly profile: ShortcutProfile;
  readonly convention: KeyboardConvention;

  /** What the user's keyboard layout types, which each shortcut is written in. */
  readonly layout: KeyboardLayout;

  /**
   * Whether to offer commands that cannot run right now.
   *
   * On by default, shown dimmed with the reason. Hiding them makes the palette
   * look as though the command does not exist, which sends the user hunting
   * through menus for something that is simply not applicable yet.
   */
  readonly includeUnavailable?: boolean;

  /** How many results to return. */
  readonly limit?: number;
}

/** Points awarded for the ways a query can match. */
const SCORE = {
  /** The label starts with the query. */
  prefix: 1_000,

  /** A word of the label starts with the query. */
  wordStart: 600,

  /** The label contains the query. */
  substring: 300,

  /** The query's letters appear in the label in order, with gaps. */
  subsequence: 100,

  /** A keyword matched instead of the label. */
  keyword: 200,

  /** Per character matched consecutively, rewarding tighter matches. */
  adjacency: 5,
} as const;

/** What every command scores when there is no query: in, with nothing highlighted. */
const UNFILTERED: { readonly score: number; readonly indices: readonly number[] } = {
  score: 0,
  indices: [],
};

/**
 * Positions `start` to `start + length - 1`.
 *
 * Every index this module produces is a UTF-16 offset into the label, matching
 * what `String.prototype.indexOf` returns and what a caller needs to slice the
 * label for highlighting. Mixing code-point offsets with UTF-16 offsets would
 * put the highlight in the wrong place the first time a label held an astral
 * character.
 */
function run(start: number, length: number): readonly number[] {
  return Array.from({ length }, (_unused, offset) => start + offset);
}

/**
 * Matches a query against a label unit by unit, allowing gaps.
 *
 * Returns the matched positions, or `undefined` if the units do not all appear
 * in order. Matching greedily from the left is what makes "rstlay" find "Reset
 * layout": each query unit takes the earliest position it can.
 */
function matchSubsequence(label: string, query: string): readonly number[] | undefined {
  const matched: number[] = [];
  let position = 0;

  for (let index = 0; index < query.length; index += 1) {
    const found = label.indexOf(query.charAt(index), position);
    if (found === -1) return undefined;
    matched.push(found);
    position = found + 1;
  }

  return matched;
}

/**
 * Where a word of the label begins with the query, or `undefined`.
 *
 * Words are separated by a space or a hyphen. Scanning positions rather than
 * splitting keeps the offsets right when a word appears twice, which splitting
 * and then searching for the word would get wrong.
 */
function wordStartIndex(label: string, query: string): number | undefined {
  for (let index = 0; index < label.length; index += 1) {
    const atWordStart =
      index === 0 || label.charAt(index - 1) === ' ' || label.charAt(index - 1) === '-';
    if (atWordStart && label.startsWith(query, index)) return index;
  }
  return undefined;
}

/** How many of the matched positions are adjacent to the previous one. */
function adjacencyBonus(indices: readonly number[]): number {
  let adjacent = 0;
  for (let index = 1; index < indices.length; index += 1) {
    const current = indices[index];
    const previous = indices[index - 1];
    if (current !== undefined && previous !== undefined && current === previous + 1) {
      adjacent += 1;
    }
  }
  return adjacent * SCORE.adjacency;
}

/** Scores one command against a query, or returns `undefined` if it does not match. */
function scoreCommand<TContext>(
  command: Command<TContext>,
  query: string,
): { readonly score: number; readonly indices: readonly number[] } | undefined {
  const label = command.label.toLowerCase();

  if (label.startsWith(query)) {
    const indices = run(0, query.length);
    return { score: SCORE.prefix + adjacencyBonus(indices), indices };
  }

  // A word start, so that "layout" finds "Reset layout" as strongly as "reset"
  // does. Users search for the noun at least as often as for the verb.
  const wordStart = wordStartIndex(label, query);
  if (wordStart !== undefined) {
    const indices = run(wordStart, query.length);
    return { score: SCORE.wordStart + adjacencyBonus(indices), indices };
  }

  const substringAt = label.indexOf(query);
  if (substringAt !== -1) {
    const indices = run(substringAt, query.length);
    return { score: SCORE.substring + adjacencyBonus(indices), indices };
  }

  const keywordMatch = command.keywords?.some((keyword) => keyword.toLowerCase().includes(query));
  if (keywordMatch === true) {
    return { score: SCORE.keyword, indices: [] };
  }

  const subsequence = matchSubsequence(label, query);
  if (subsequence !== undefined) {
    return { score: SCORE.subsequence + adjacencyBonus(subsequence), indices: subsequence };
  }

  return undefined;
}

/**
 * Searches the commands.
 *
 * An empty query returns every command, which is what the palette shows when it
 * first opens: a user who does not know what to type should see what there is.
 */
export function searchCommands<TContext>(
  commands: readonly Command<TContext>[],
  query: string,
  options: PaletteOptions<TContext>,
): readonly PaletteResult<TContext>[] {
  const normalised = query.trim().toLowerCase();
  const includeUnavailable = options.includeUnavailable ?? true;
  const limit = options.limit ?? 50;

  const results: (PaletteResult<TContext> & { readonly sortKey: string })[] = [];

  for (const command of commands) {
    if (command.discoverable === false) continue;

    const availability = command.availability(options.context);
    if (!availability.available && !includeUnavailable) continue;

    const match = normalised === '' ? UNFILTERED : scoreCommand(command, normalised);
    if (match === undefined) continue;

    // Nothing where the platform takes the binding: offered as a shortcut, a
    // binding made on another keyboard would teach a press that closes the tab.
    const offered = shortcutOffered(
      options.profile,
      command.id,
      options.convention,
      options.layout,
    );

    results.push({
      command,
      score: match.score,
      matchedLabelIndices: match.indices,
      sortKey: command.label.toLowerCase(),
      ...(offered === undefined ? {} : { shortcutText: offered }),
      ...(availability.available ? {} : { unavailableReason: availability.reason }),
    });
  }

  return results
    .sort((left, right) => {
      // A runnable command outranks one that is not, so the palette's first
      // result is one the user can actually press Enter on.
      const leftRunnable = left.unavailableReason === undefined ? 1 : 0;
      const rightRunnable = right.unavailableReason === undefined ? 1 : 0;
      if (leftRunnable !== rightRunnable) return rightRunnable - leftRunnable;

      if (left.score !== right.score) return right.score - left.score;

      // Alphabetical last, so the order never depends on registration order.
      return left.sortKey.localeCompare(right.sortKey);
    })
    .slice(0, limit)
    .map(({ sortKey: _sortKey, ...result }) => result);
}

/** The commands a palette result refers to, for a test or a menu. */
export function resultCommandIds<TContext>(
  results: readonly PaletteResult<TContext>[],
): readonly CommandId[] {
  return results.map((result) => result.command.id);
}
