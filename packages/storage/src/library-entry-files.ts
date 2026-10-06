/**
 * Where each entry of the person's library is kept, and how it is read and
 * written (ADR-0060, REQ-AUDIO-017).
 *
 * An entry is kept at `library/<entry>/` as a pair rewritten by turns
 * (`generational-pair.ts`): `entry-0.json` and `entry-1.json`, each a checked
 * record holding its generation and the entry's document, which the library
 * format's one reader reads (`library-json.ts`), its content in the chain's
 * one persisted form. An entry is kept apart from the others, so a write torn
 * by a crash, or an entry another build wrote, costs that entry alone; and as
 * a pair, so a rename or a replacement cut short leaves it as it was.
 *
 * An entry is read as usable, or as unusable with the reason, never as
 * nothing: a document of a schema version this build does not know or that
 * does not read, a pair with no valid record, or content naming a processor
 * type or version the catalogue refuses. Only a directory holding no record
 * at all, as a removal cut short leaves, is nothing kept.
 */

import {
  FailureKind,
  checkProcessors,
  failure,
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type DomainFailure,
  type DomainResult,
  type LibraryContent,
  type LibraryEntry,
  type LibraryEntryId,
  type ProcessorCatalogue,
} from '@audiogubbins/domain';
import {
  integerConverter,
  objectOf,
  pathOf,
  readLibraryEntry,
  required,
  writeLibraryEntry,
  type Converter,
  type Digest,
  type JsonValue,
  type StorageTree,
} from '@audiogubbins/project-format';

import { CheckedRecords, RecordKind, type RecordFault } from './checked-records.js';
import {
  readPair,
  writeNext,
  type Generational,
  type PairFiles,
  type PairReading,
} from './generational-pair.js';
import { LIBRARY_DIRECTORY, type PairSlot } from './storage-layout.js';

/** An entry as the library lists it: one this build can use, or why it cannot. */
export type ListedEntry =
  | { readonly kind: 'usable'; readonly entry: LibraryEntry }
  | {
      readonly kind: 'unusable';
      readonly id: LibraryEntryId;
      readonly reason: DomainFailure;

      /** The entry its document holds, where that document reads. */
      readonly entry?: LibraryEntry;
    };

/** What one record of an entry's pair holds: its generation and the entry's document. */
interface EntryRecord extends Generational {
  readonly document: JsonValue;
}

/** An entry as it is kept: how it lists, and its pair, which the next write follows. */
export interface KeptEntry {
  readonly listed: ListedEntry;
  readonly pair: PairReading<EntryRecord>;
}

/** The pair of an entry not yet kept, whose first write starts it. */
export const NOTHING_KEPT: PairReading<EntryRecord> = { valid: [], faults: [] };

const RECORD_MEMBERS: ReadonlySet<string> = new Set(['generation', 'entry']);
const asGeneration = integerConverter(1, Number.MAX_SAFE_INTEGER);

/** Any value: the entry's document is read by the library format's reader, not here. */
const asDocument: Converter<JsonValue> = (_reading, value) => value;

const readEntryRecord: Converter<EntryRecord> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, RECORD_MEMBERS);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const generation = required(reading, object, at, 'generation', asGeneration);
  const document = required(reading, object, at, 'entry', asDocument);
  return generation === undefined || document === undefined ? undefined : { generation, document };
};

/** Why a pair with no valid record cannot be read. */
function damaged(id: LibraryEntryId, fault: RecordFault): DomainFailure {
  const cause =
    fault.kind === 'malformed'
      ? fault.failures[0]
      : fault.kind === 'damaged'
        ? fault.cause
        : undefined;
  return failure(
    'library.entry-damaged',
    FailureKind.IntegrityViolation,
    `The saved entry cannot be read (${fault.kind}), so only removing it is left.`,
    { details: { entry: id }, ...(cause === undefined ? {} : { cause }) },
  );
}

/** The entries of a library kept in one tree (see the module comment). */
export class LibraryEntryFiles {
  private readonly records: CheckedRecords;
  private readonly catalogue: ProcessorCatalogue;

  /** The entries kept in `tree`, usable where `catalogue` has what they name. */
  constructor(tree: StorageTree, digest: Digest, catalogue: ProcessorCatalogue) {
    this.records = new CheckedRecords(tree, digest);
    this.catalogue = catalogue;
  }

  /** Every entry kept, in the order of their identifiers. */
  async every(signal: AbortSignal | undefined): Promise<ListedEntry[]> {
    const listed: ListedEntry[] = [];
    for (const kept of await this.records.tree.list(LIBRARY_DIRECTORY)) {
      signal?.throwIfAborted();
      // A name the library never makes is not an entry of it.
      if (kept.kind !== 'directory' || !isWellFormedId(kept.name)) continue;
      const found = await this.read(unsafeBrandId<'LibraryEntryId'>(kept.name), signal);
      if (found !== undefined) listed.push(found.listed);
    }
    return listed;
  }

  /** The entry kept as `id`, usable or not, or `undefined` where nothing is kept. */
  async read(id: LibraryEntryId, signal: AbortSignal | undefined): Promise<KeptEntry | undefined> {
    const pair = await readPair(this.records, this.filesOf(id), signal);
    const current = pair.valid[0];
    if (current === undefined) {
      const [first] = pair.faults;
      return first === undefined
        ? undefined
        : { listed: { kind: 'unusable', id, reason: damaged(id, first.fault) }, pair };
    }
    const read = readLibraryEntry(id, current.value.document);
    if (!read.ok) return { listed: { kind: 'unusable', id, reason: read.failures[0] }, pair };
    const usable = this.usable(read.value.content);
    return {
      listed: usable.ok
        ? { kind: 'usable', entry: read.value }
        : { kind: 'unusable', id, reason: usable.failures[0], entry: read.value },
      pair,
    };
  }

  /**
   * Writes `entry` as the next record after `pair`, once the library format's
   * reader reads it and, where `checked`, the catalogue takes its content.
   */
  async write(
    entry: LibraryEntry,
    pair: PairReading<EntryRecord>,
    signal: AbortSignal | undefined,
    checked: boolean,
  ): Promise<DomainResult<LibraryEntry>> {
    const document = writeLibraryEntry(entry);
    const read = readLibraryEntry(entry.id, document);
    if (!read.ok) return read;
    if (checked) {
      const usable = this.usable(read.value.content);
      if (!usable.ok) return usable;
    }
    const kept = await writeNext(
      this.records,
      this.filesOf(entry.id),
      pair,
      (generation) => ({ generation, entry: document }),
      signal,
    );
    return kept.ok ? succeed(read.value) : kept;
  }

  /** Removes the entry `id`, answering whether anything was kept of it. */
  async remove(id: LibraryEntryId, signal: AbortSignal | undefined): Promise<boolean> {
    const { tree } = this.records;
    const directory = `${LIBRARY_DIRECTORY}/${id}`;
    if ((await tree.list(directory)).length === 0) return false;
    const current = (await readPair(this.records, this.filesOf(id), signal)).valid[0];
    if (current !== undefined) {
      // The file that is not current goes first, so a removal cut short
      // leaves the entry as it was rather than as it was before that.
      const other: PairSlot = current.slot === 0 ? 1 : 0;
      await tree.remove(this.filesOf(id).path(other));
    }
    await tree.remove(directory);
    return true;
  }

  /** Whether this build has every processor type and version `content` names. */
  private usable(content: LibraryContent): DomainResult<void> {
    const slots = content.kind === 'chain' ? content.chain.slots : [content.processor];
    return checkProcessors(slots, this.catalogue);
  }

  private filesOf(id: LibraryEntryId): PairFiles<EntryRecord> {
    return {
      path: (slot) => `${LIBRARY_DIRECTORY}/${id}/entry-${String(slot)}.json`,
      kind: RecordKind.LibraryEntry,
      convert: readEntryRecord,
    };
  }
}
