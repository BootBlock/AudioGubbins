/**
 * The person's library of saved chains and presets, kept in the storage tree
 * beside the projects (ADR-0060, REQ-AUDIO-017): one per person, not per
 * project, so a chain made in one project is applied in another.
 *
 * Each entry is kept apart, as a pair of records (`library-entry-files.ts`),
 * and every entry kept is listed: one this build cannot use is listed as
 * unusable with the reason, never dropped. It can be removed, and renamed
 * where its document reads, its content kept as it is.
 *
 * Names are unique within a kind, compared as a reader hears them
 * (`sameName`). Every change is made with the library's lock held, which one
 * window holds at a time, so two windows never both find a name free; where
 * the platform has no coordinator or refuses the lock, nothing is changed and
 * the reason is given, as a project opens read-only there.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type IdGenerator,
  type LibraryContent,
  type LibraryEntry,
  type LibraryEntryId,
  type LibraryEntryKind,
  type ProcessorCatalogue,
} from '@audiogubbins/domain';
import { savedEntryName, type Digest, type StorageTree } from '@audiogubbins/project-format';
import { holderOf, namesCanBeCompared, quoted } from '@audiogubbins/text';

import {
  LibraryEntryFiles,
  NOTHING_KEPT,
  type KeptEntry,
  type ListedEntry,
} from './library-entry-files.js';
import { refusalsReported } from './storage-failures.js';
import type { LeaseCoordinator } from './write-lease.js';

/** What the library is kept with, each made once by the composition root. */
export interface LibraryServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly clock: Clock;
  readonly ids: IdGenerator;

  /** The processor types this build has, which say whether an entry can be used. */
  readonly catalogue: ProcessorCatalogue;

  /** The platform's coordination, whose library lock every change holds. */
  readonly coordinator?: LeaseCoordinator;
}

/** What each kind of entry is called at the start of a sentence. */
const KIND_WORDS: Readonly<Record<LibraryEntryKind, string>> = {
  chain: 'A chain',
  preset: 'A preset',
};

function refused(
  code: string,
  summary: string,
  kind: FailureKind = FailureKind.Rejected,
): DomainFailure {
  return failure(`library.${code}`, kind, summary);
}

const UNKNOWN_ENTRY = refused('entry-unknown', 'The library has no such saved chain or preset.');

/** An entry whose document reads, usable or not, and its pair. */
type ReadableEntry = { readonly entry: LibraryEntry } & Pick<KeptEntry, 'pair'>;

/** The library a storage keeps (see the module comment). */
export class ProcessingLibraryStore {
  private readonly files: LibraryEntryFiles;
  private readonly services: LibraryServices;

  constructor(services: LibraryServices) {
    this.files = new LibraryEntryFiles(services.tree, services.digest, services.catalogue);
    this.services = services;
  }

  /** Every entry kept, usable or not, in the order of their identifiers. */
  async list(signal?: AbortSignal): Promise<DomainResult<readonly ListedEntry[]>> {
    return await refusalsReported(async () => succeed(await this.files.every(signal)));
  }

  /** The entry kept as `id`, usable or not, or why there is none. */
  async entry(id: LibraryEntryId, signal?: AbortSignal): Promise<DomainResult<ListedEntry>> {
    return await refusalsReported(async () => {
      const found = await this.files.read(id, signal);
      return found === undefined ? fail(UNKNOWN_ENTRY) : succeed(found.listed);
    });
  }

  /**
   * Saves `content` under `name`, a new entry; refused where an entry of its
   * kind is called that already, which is replaced only when asked by its
   * identifier (`replace`), never by taking a name.
   */
  async save(
    name: string,
    content: LibraryContent,
    signal?: AbortSignal,
  ): Promise<DomainResult<LibraryEntry>> {
    const given = this.givenName(name);
    if (!given.ok) return given;
    return await this.changing(async () => {
      const taken = holder(await this.files.every(signal), content.kind, given.value);
      if (taken !== undefined) return fail(taken);
      const entry: LibraryEntry = {
        id: this.services.ids.next<'LibraryEntryId'>(),
        name: given.value,
        savedAt: this.services.clock.now(),
        content,
      };
      return await this.files.write(entry, NOTHING_KEPT, signal, true);
    }, signal);
  }

  /** Replaces the content of the entry `id`, of the same kind, keeping its name. */
  async replace(
    id: LibraryEntryId,
    content: LibraryContent,
    signal?: AbortSignal,
  ): Promise<DomainResult<LibraryEntry>> {
    return await this.changing(async () => {
      const found = await this.readable(id, signal);
      if (!found.ok) return found;
      const { entry, pair } = found.value;
      if (entry.content.kind !== content.kind) {
        return fail(
          refused(
            'kind-mismatch',
            `${KIND_WORDS[entry.content.kind]} is replaced only by another ${entry.content.kind}.`,
          ),
        );
      }
      const replaced = { ...entry, savedAt: this.services.clock.now(), content };
      return await this.files.write(replaced, pair, signal, true);
    }, signal);
  }

  /** Gives the entry `id` another name, its content kept as it is. */
  async rename(
    id: LibraryEntryId,
    name: string,
    signal?: AbortSignal,
  ): Promise<DomainResult<LibraryEntry>> {
    const given = this.givenName(name);
    if (!given.ok) return given;
    return await this.changing(async () => {
      const found = await this.readable(id, signal);
      if (!found.ok) return found;
      const { entry, pair } = found.value;
      if (entry.name === given.value) {
        return fail(refused('name-unchanged', `It is already called ${quoted(entry.name)}.`));
      }
      const others = (await this.files.every(signal)).filter((one) => idOf(one) !== id);
      const taken = holder(others, entry.content.kind, given.value);
      if (taken !== undefined) return fail(taken);
      // Written with its content as read, which the content's one persisted
      // form writes again to the same text, usable here or not.
      return await this.files.write({ ...entry, name: given.value }, pair, signal, false);
    }, signal);
  }

  /** Removes the entry `id`, usable or not. */
  async remove(id: LibraryEntryId, signal?: AbortSignal): Promise<DomainResult<void>> {
    return await this.changing(
      async () =>
        (await this.files.remove(id, signal)) ? succeed(undefined) : fail(UNKNOWN_ENTRY),
      signal,
    );
  }

  /** Runs a change of the library with its lock held, or says why it cannot be had. */
  private async changing<TValue>(
    work: () => Promise<DomainResult<TValue>>,
    signal?: AbortSignal,
  ): Promise<DomainResult<TValue>> {
    const { coordinator } = this.services;
    const locking =
      coordinator === undefined
        ? undefined
        : await coordinator.lockLibrary(signal === undefined ? {} : { signal });
    if (locking?.kind !== 'held') {
      return fail(
        refused(
          'lock-unavailable',
          'This browser cannot let one window at a time change your library, so it is not changed here.',
          FailureKind.Unrecoverable,
        ),
      );
    }
    try {
      return await refusalsReported(work);
    } finally {
      await locking.release();
    }
  }

  /** `name` as one an entry is saved under, where names can be compared here. */
  private givenName(name: string): DomainResult<string> {
    if (!namesCanBeCompared()) {
      return fail(
        refused(
          'names-not-comparable',
          'This browser cannot compare names, so nothing can be saved under one here.',
          FailureKind.Unrecoverable,
        ),
      );
    }
    return savedEntryName(name);
  }

  /** The entry kept as `id` whose document reads, usable or not, or why there is none. */
  private async readable(
    id: LibraryEntryId,
    signal: AbortSignal | undefined,
  ): Promise<DomainResult<ReadableEntry>> {
    const found = await this.files.read(id, signal);
    if (found === undefined) return fail(UNKNOWN_ENTRY);
    const { listed, pair } = found;
    if (listed.kind === 'usable') return succeed({ entry: listed.entry, pair });
    return listed.entry === undefined
      ? fail(listed.reason)
      : succeed({ entry: listed.entry, pair });
  }
}

/** Why `name` is taken among `entries` for an entry of `kind`, or `undefined`. */
function holder(
  entries: readonly ListedEntry[],
  kind: LibraryEntryKind,
  name: string,
): DomainFailure | undefined {
  const named = entries.flatMap((one) =>
    one.entry?.content.kind === kind ? [{ id: one.entry.id, displayName: one.entry.name }] : [],
  );
  const found = holderOf(named, name);
  return found === undefined
    ? undefined
    : refused(
        'name-taken',
        `${KIND_WORDS[kind]} is already saved as ${quoted(found.displayName)}: replace it, or choose another name.`,
      );
}

/** The identifier of a listed entry, usable or not. */
function idOf(listed: ListedEntry): LibraryEntryId {
  return listed.kind === 'usable' ? listed.entry.id : listed.id;
}
