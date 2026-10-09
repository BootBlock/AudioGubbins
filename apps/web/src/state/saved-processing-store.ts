/**
 * The person's library of saved chains and presets as the page lists it, and
 * the changes to it: saving, replacing, renaming and removing an entry
 * (ADR-0060, REQ-AUDIO-017).
 *
 * The storage worker's library is the one authority on what is saved, and it
 * is the person's, so every tab of theirs changes it: the list is read again
 * after every change made here, whenever another tab says it changed one, and
 * whenever the person comes back to this page, which covers a tab whose word
 * was missed while this one was asleep. Every change this tab makes is said on
 * the library's channel (`LibraryChanges`), from here, the one path every
 * change takes, so no surface can change the library without the other tabs
 * hearing. An entry about to be applied is read afresh rather than taken from
 * the list (`entry`). A reading replaced by a newer one is given up, since the
 * newer one shows the list. Each change is the library's to refuse, and its
 * reason is answered as it gave it. An entry this build cannot use is listed
 * with the reason, so the person sees it and may remove it.
 *
 * The list is brought up to date in place: an entry a reading finds as it was
 * is the very value it was, and a reading that finds the whole list as it was
 * changes nothing, so a surface that lists it redraws only what changed.
 */

import {
  succeed,
  type DomainResult,
  type LibraryContent,
  type LibraryEntry,
  type LibraryEntryId,
} from '@audiogubbins/domain';
import type { ListedEntry } from '@audiogubbins/storage';
import type { ProcessingLibraryClient } from '@audiogubbins/storage-runtime';

import type { LibraryChanges } from '../io/library-channel.js';
import { Requests, isAbandoned } from './abandoning.js';
import type { PageVisibility } from './layout-map-watch.js';
import { observable, type Observable } from './observable.js';

/** The saved chains and presets, and what is being done to them. */
export interface SavedProcessingState {
  /** Every entry kept, usable or not, in the order the library lists them. */
  readonly entries: readonly ListedEntry[];

  /** Whether the list has been read yet. */
  readonly loaded: boolean;

  /** Why the list could not be read the last time it was, where it could not. */
  readonly problem?: string;
}

/** Whether a reading found an entry as it was: the same identity, name, save and reason. */
function sameEntry(one: ListedEntry, other: ListedEntry): boolean {
  // Content changes only by a save, which stamps it, and a name only by a
  // rename, so an entry with the same name and stamp holds the same content.
  const same = (a: LibraryEntry | undefined, b: LibraryEntry | undefined): boolean =>
    a?.id === b?.id && a?.name === b?.name && a?.savedAt === b?.savedAt;
  if (one.kind === 'usable' || other.kind === 'usable') {
    return one.kind === other.kind && same(one.entry, other.entry);
  }
  return (
    one.id === other.id &&
    one.reason.code === other.reason.code &&
    one.reason.summary === other.reason.summary &&
    same(one.entry, other.entry)
  );
}

/** What identifies an entry, usable or not. */
function idOf(listed: ListedEntry): LibraryEntryId {
  return listed.kind === 'usable' ? listed.entry.id : listed.id;
}

/**
 * The list a reading found, each entry found as it was kept as the value it
 * was; the list it had where nothing at all changed.
 */
function keptInPlace(
  before: readonly ListedEntry[],
  read: readonly ListedEntry[],
): readonly ListedEntry[] {
  const known = new Map(before.map((listed) => [idOf(listed), listed]));
  const after = read.map((listed) => {
    const was = known.get(idOf(listed));
    return was !== undefined && sameEntry(was, listed) ? was : listed;
  });
  const unchanged =
    after.length === before.length && after.every((listed, index) => listed === before[index]);
  return unchanged ? before : after;
}

/** The saved chains and presets, and the changes to them. */
export class SavedProcessingStore implements Observable<SavedProcessingState> {
  private readonly library: ProcessingLibraryClient;
  private readonly lifetime: AbortSignal;
  private readonly changes: LibraryChanges;
  private readonly readings: Requests;
  private readonly state = observable<SavedProcessingState>({ entries: [], loaded: false });

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /**
   * The library `library` keeps, whose changes are said to other tabs, and
   * heard from them, on `changes`, and whose work ends once `lifetime` aborts.
   */
  constructor(library: ProcessingLibraryClient, lifetime: AbortSignal, changes: LibraryChanges) {
    this.library = library;
    this.lifetime = lifetime;
    this.changes = changes;
    this.readings = new Requests(() => lifetime);
  }

  /**
   * Reads the list again. A reading replaced by a newer one is given up and
   * settles at once, leaving the list to the newer one.
   */
  readonly refresh = async (): Promise<DomainResult<void>> => {
    const signal = this.readings.next();
    let listed: DomainResult<readonly ListedEntry[]>;
    try {
      listed = await this.library.list(signal);
      signal.throwIfAborted();
    } catch (error) {
      // Given up for a newer reading, the list is that reading's to show;
      // anything else is a fault, and surfaces as one.
      if (signal.aborted && isAbandoned(error)) return succeed(undefined);
      throw error;
    }
    if (!listed.ok) {
      const problem = `Your saved chains and presets could not be read: ${listed.failures[0].summary}`;
      this.state.update((current) => ({ ...current, problem }));
      return listed;
    }
    const read = listed.value;
    this.state.update((current) => {
      const entries = keptInPlace(current.entries, read);
      if (current.loaded && current.problem === undefined && entries === current.entries) {
        return current;
      }
      const { problem: _read, ...rest } = current;
      return { ...rest, entries, loaded: true };
    });
    return succeed(undefined);
  };

  /**
   * Reads the list again whenever another tab says the library changed, and
   * whenever the person comes back to `page`, until the answer is called or
   * the lifetime ends. A reading that fails as a fault goes to `fault`, since
   * nothing that asked for it is waiting.
   */
  readonly follow = (page: PageVisibility, fault: (error: unknown) => void): (() => void) => {
    const reread = (): void => {
      this.refresh().catch(fault);
    };
    const whenBack = (): void => {
      if (page.isVisible()) reread();
    };
    const stops = [
      this.changes.hear(reread),
      page.listen('visibilitychange', whenBack),
      page.listen('focus', whenBack),
    ];
    const stop = (): void => {
      for (const one of stops.splice(0)) one();
    };
    this.lifetime.addEventListener('abort', stop, { once: true });
    return stop;
  };

  /** The entry `id` as the library keeps it now, or why there is none. */
  readonly entry = (id: LibraryEntryId): Promise<DomainResult<ListedEntry>> =>
    this.library.entry(id, this.lifetime);

  readonly save = (name: string, content: LibraryContent): Promise<DomainResult<LibraryEntry>> =>
    this.changing(() => this.library.save(name, content, this.lifetime));

  readonly replace = (
    id: LibraryEntryId,
    content: LibraryContent,
  ): Promise<DomainResult<LibraryEntry>> =>
    this.changing(() => this.library.replace(id, content, this.lifetime));

  readonly rename = (id: LibraryEntryId, name: string): Promise<DomainResult<LibraryEntry>> =>
    this.changing(() => this.library.rename(id, name, this.lifetime));

  readonly remove = (id: LibraryEntryId): Promise<DomainResult<void>> =>
    this.changing(() => this.library.remove(id, this.lifetime));

  /**
   * Runs a change, tells the other tabs where it was made, and reads the list
   * again after, whatever it came to.
   */
  private async changing<TValue>(
    change: () => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    try {
      const changed = await change();
      if (changed.ok) this.changes.say();
      return changed;
    } finally {
      await this.refresh();
    }
  }
}
