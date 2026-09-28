/**
 * The workspaces the user made, where they are stored, and how much of what is
 * stored can be read.
 *
 * Apart from the workspace store because it is a concept of its own, with keys
 * of its own: the store asks it for the layouts it could read. Where a text
 * that could not all be read is kept, and where the collection is written
 * meanwhile, is `workspace-custody.ts`.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import {
  readLayout,
  sameLayout,
  type PanelDescriptor,
  type PanelKind,
  type WorkspaceLayout,
} from '@audiogubbins/workspace';

import type { StateStorage } from './state-storage.js';

/**
 * Where the workspaces the user made are kept.
 *
 * Separate from the key the mounted layout is stored under, which holds only
 * that one layout.
 *
 * Without it, a workspace saved with "Save this workspace as a new one" would
 * be mounted and then absent from the list on the next load, so it could not be
 * switched to, renamed or deleted, and its identifier would be free to be given
 * again, so the next save-as would collide with it.
 */
export const COLLECTION_KEY = 'audiogubbins.workspaces';

/**
 * Where the collection is written while its damaged text could not be set
 * aside.
 *
 * Beside the damaged text rather than over it, and read back whenever the
 * collection is damaged, however it is damaged: this copy is the newest of what
 * the user has. It is read at every start, damaged collection or not, and
 * removed only once nothing in it can be lost: when it could all be read, or
 * its text is set aside, and after a write of the collection's own key that was
 * kept. Read only beside a damaged collection, a copy that could not all be
 * read would be deleted unread once the collection is whole again.
 */
export const RECOVERED_COLLECTION_KEY = 'audiogubbins.workspaces.recovered';

/** A collection's text, read as far as it can be. */
type ParsedCollection =
  | { readonly kind: 'whole'; readonly layouts: readonly WorkspaceLayout[] }
  | {
      readonly kind: 'partial';
      readonly layouts: readonly WorkspaceLayout[];
      readonly unreadable: number;
    }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** Reads a collection's text as far as it can be read. */
function parseCollection(
  text: string,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): ParsedCollection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'unreadable', reason: 'not JSON' };
  }
  if (!Array.isArray(parsed)) return { kind: 'unreadable', reason: 'not a list of workspaces' };

  // Each entry as it is read, so a field the reading does not check is not
  // kept, and is written back by nothing.
  const layouts = parsed.flatMap((one) => readLayout(one, descriptors).layout ?? []);
  const unreadable = parsed.length - layouts.length;
  return unreadable === 0 ? { kind: 'whole', layouts } : { kind: 'partial', layouts, unreadable };
}

/** The layouts a parsed collection holds, none when it could not be read at all. */
function layoutsOf(parsed: ParsedCollection): readonly WorkspaceLayout[] {
  return parsed.kind === 'whole' || parsed.kind === 'partial' ? parsed.layouts : [];
}

/** A stored text, and how much of it could be read. */
export interface StoredText {
  readonly text: string;
  readonly parsed: ParsedCollection;
}

/** Reads the text stored under a key, when there is any. */
function readText(
  storage: StateStorage,
  key: string,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
): StoredText | undefined {
  const text = storage.read(key);
  return text === null ? undefined : { text, parsed: parseCollection(text, descriptors) };
}

/** A stored text that could not all be read. */
export interface DamagedText extends StoredText {
  readonly parsed: Extract<ParsedCollection, { readonly kind: 'partial' | 'unreadable' }>;
}

/** Whether a stored text holds anything that could not be read. */
export function isDamaged(stored: StoredText | undefined): stored is DamagedText {
  return stored !== undefined && stored.parsed.kind !== 'whole';
}

/**
 * The workspaces the user made, as far as this build can still mount them.
 *
 * Each is validated on its own, so one layout naming a panel this version does
 * not have costs the user that layout rather than all of them.
 *
 * A file that cannot be read at all is a different matter, and is not an empty
 * one: read as empty, every workspace the user has made would disappear with no
 * notice and no log record, and the next change would write an empty list over
 * the damaged text, so nothing could be recovered afterwards. It is reported
 * like any other recovery, and its text is set aside before anything is
 * written.
 *
 * The copy beside a damaged or missing collection is the newest of what the
 * user has, whichever way the collection is damaged, so it is the list.
 *
 * Beside a collection this build reads whole, the copy can still hold
 * workspaces the collection does not: whether a collection is whole depends on
 * the panels a build knows, so a build that cannot read it writes what the user
 * saves to the copy instead, and a later build can read the collection whole
 * again. Taking the collection alone, every workspace saved while its text is
 * held in place would disappear from the list, with nothing said, and survive
 * only in a set-aside text nothing reads.
 *
 * Every entry of both is kept, as every stored entry is: the first of the
 * copy's entries under an identifier takes the place of the first of the
 * collection's under it, and every other entry of either is listed, the store
 * holding each one whose identifier another holds under a free one. The copy's
 * entry takes the place because the copy is written apart from the collection
 * only while the collection's text is held in place, so it is the newer, and
 * with the collection's entry kept instead, a workspace renamed or rearranged
 * in the copy would come back as it was before. What the collection alone
 * holds is kept too, since a workspace the build that wrote the copy could not
 * read is in no other text. The collection's own entries a copy replaces are
 * set aside before anything is written over them ({@link replacedBy}).
 */
function chooseLayouts(
  collection: StoredText | undefined,
  copy: StoredText | undefined,
): readonly WorkspaceLayout[] {
  const collectionLayouts = collection === undefined ? [] : layoutsOf(collection.parsed);
  const copyLayouts = copy === undefined ? [] : layoutsOf(copy.parsed);

  // Beside a damaged or a missing collection, a copy that could be read at all
  // is the newest of what the user has, and is the list on its own.
  const copyReadable = copy !== undefined && copy.parsed.kind !== 'unreadable';
  if (copyReadable && (collection === undefined || isDamaged(collection))) return copyLayouts;

  const newer = replacements(collectionLayouts, copyLayouts);
  const placed = new Set(newer.values());
  const merged = collectionLayouts.map((one) => newer.get(one) ?? one);
  return [...merged, ...copyLayouts.filter((one) => !placed.has(one))];
}

/**
 * Each of the collection's entries the copy's takes the place of, with the
 * copy's entry that takes it: under each identifier both hold, the first of
 * the collection's, with the first of the copy's.
 *
 * One entry for one, by the order each is stored in, so no entry of either is
 * left out of the list or listed twice, whichever identifiers they share.
 */
function replacements(
  collection: readonly WorkspaceLayout[],
  copy: readonly WorkspaceLayout[],
): ReadonlyMap<WorkspaceLayout, WorkspaceLayout> {
  const firstInTheCopy = new Map<string, WorkspaceLayout>();
  for (const one of copy) if (!firstInTheCopy.has(one.id)) firstInTheCopy.set(one.id, one);

  const newer = new Map<WorkspaceLayout, WorkspaceLayout>();
  for (const one of collection) {
    const replacement = firstInTheCopy.get(one.id);
    if (replacement === undefined) continue;
    newer.set(one, replacement);
    firstInTheCopy.delete(one.id);
  }
  return newer;
}

/**
 * How many of a whole collection's entries a whole copy beside it replaces
 * with another version, as {@link chooseLayouts} replaces them.
 *
 * The collection's text is set aside before it is written over whenever there
 * are any, as a damaged text is, so the version the merge left out can still
 * be recovered.
 */
function replacedBy(collection: StoredText | undefined, copy: StoredText | undefined): number {
  if (collection === undefined || copy === undefined || isDamaged(collection) || isDamaged(copy)) {
    return 0;
  }
  const newer = replacements(layoutsOf(collection.parsed), layoutsOf(copy.parsed));
  return [...newer].filter(([one, replacement]) => !sameLayout(replacement, one)).length;
}

/** What the user is told about the collection's damage, in words. */
export function collectionDamage(parsed: DamagedText['parsed']): string {
  if (parsed.kind === 'partial') {
    return parsed.unreadable === 1
      ? 'One of the workspaces you saved could not be read, so it is not listed.'
      : `${String(parsed.unreadable)} of the workspaces you saved could not be read, so they are not listed.`;
  }
  return 'The workspaces you saved could not be read, so only the built-in ones and any you have saved since are listed.';
}

/** What is stored of the collection, read as far as it can be. */
export interface StoredCollection {
  /** The workspaces that could be read, as the list shows them. */
  readonly layouts: readonly WorkspaceLayout[];

  /** The collection's own text, when there is any. */
  readonly collection: StoredText | undefined;

  /** The copy written beside it, when there is one. */
  readonly copy: StoredText | undefined;

  /** How many of the collection's entries the copy replaces ({@link replacedBy}). */
  readonly replaced: number;
}

/**
 * Reads the collection and the copy beside it, and logs what could not be
 * read.
 *
 * What is done with a text that could not all be read, before anything is
 * written over it, is the custody's (`workspace-custody.ts`).
 */
export function readCollection(
  storage: StateStorage,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  logger: Logger,
): StoredCollection {
  const collection = readText(storage, COLLECTION_KEY, descriptors);
  const copy = readText(storage, RECOVERED_COLLECTION_KEY, descriptors);

  for (const [what, stored] of [
    ['The workspaces you saved could not all be read.', collection],
    ['A copy of the workspaces you saved could not all be read.', copy],
  ] as const) {
    if (!isDamaged(stored)) continue;
    logger.warning(what, {
      reason:
        stored.parsed.kind === 'partial'
          ? `${String(stored.parsed.unreadable)} entries`
          : stored.parsed.reason,
    });
  }

  const replaced = replacedBy(collection, copy);
  if (replaced > 0) {
    logger.info('A newer copy of the workspaces replaces some of those saved.', { replaced });
  }

  return { layouts: chooseLayouts(collection, copy), collection, copy, replaced };
}
