/**
 * The person's library of saved chains and presets as the page lists it, and
 * the changes to it: saving, replacing, renaming and removing an entry
 * (ADR-0060, REQ-AUDIO-017).
 *
 * The storage worker's library is the one authority on what is saved, since
 * another tab may change it: the list is read again after every change made
 * here, and an entry about to be applied is read afresh rather than taken from
 * the list (`entry`). A reading replaced by a newer one is given up, since the
 * newer one shows the list. Each change is the library's to refuse, and its
 * reason is answered as it gave it. An entry this build cannot use is listed
 * with the reason, so the person sees it and may remove it.
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

import { Requests, isAbandoned } from './abandoning.js';
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

/** The saved chains and presets, and the changes to them. */
export class SavedProcessingStore implements Observable<SavedProcessingState> {
  private readonly library: ProcessingLibraryClient;
  private readonly lifetime: AbortSignal;
  private readonly readings: Requests;
  private readonly state = observable<SavedProcessingState>({ entries: [], loaded: false });

  readonly get = this.state.get;
  readonly subscribe = this.state.subscribe;

  /** The library `library` keeps, whose work ends once `lifetime` aborts. */
  constructor(library: ProcessingLibraryClient, lifetime: AbortSignal) {
    this.library = library;
    this.lifetime = lifetime;
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
    const entries = listed.value;
    this.state.update(({ problem: _read, ...current }) => ({ ...current, entries, loaded: true }));
    return succeed(undefined);
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

  /** Runs a change, and reads the list again after, whatever it came to. */
  private async changing<TValue>(
    change: () => Promise<DomainResult<TValue>>,
  ): Promise<DomainResult<TValue>> {
    try {
      return await change();
    } finally {
      await this.refresh();
    }
  }
}
