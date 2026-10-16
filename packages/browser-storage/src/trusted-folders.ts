/**
 * The folders a person marked trusted for exports, and what AudioGubbins
 * exported into each (ADR-0092, REQ-ARCH-054).
 *
 * A trusted folder is a kept folder handle, and in it a file AudioGubbins
 * exported there before, unchanged since, is overwritten without asking. So
 * beside the handle is kept the record of each file exported there: its name,
 * size and SHA-256, the last for each name, which the delivery checks the file
 * now there against. A file delivered into a folder inside the trusted one is
 * named by its path from it, `sfx/ui/Click.wav` (ADR-0102, `trustedRecordName`
 * in `@audiogubbins/storage`), so a record speaks only for the file at that
 * path. Only this browser on this machine keeps them, in the database the kept
 * handles are in (`handle-database.ts`), since a handle cannot be kept anywhere
 * else: a folder under a token of its own, and a list of the tokens, every key
 * beginning with the project format's `FOLDER_KEY_PREFIX`, which no linked
 * file's token can.
 *
 * What is read back is checked field by field, and a value that is not one
 * kept here is passed over, so a damaged entry costs its folder and nothing
 * else. Each folder keeps the records of its last `MOST_RECORDS` names, the
 * oldest let go first: a file whose record is gone is asked about, which is
 * the safe way to be wrong. Two windows recording at once may each keep the
 * list as it read it, losing a record the other made, with the same result.
 */

import type { ExportedFileRecord } from '@audiogubbins/import-export';
import type { TokenSource } from '@audiogubbins/media-store';
import { FOLDER_KEY_PREFIX } from '@audiogubbins/project-format';

import {
  HANDLE_STORE,
  HandleStore,
  committed,
  settled,
  type HandleDatabaseFactory,
} from './handle-database.js';

/** A folder kept trusted, and the records of what was exported into it. */
export interface TrustedFolder {
  /** The token it is kept under, which a delivery names it by. */
  readonly key: string;
  readonly folder: FileSystemDirectoryHandle;
  readonly records: readonly ExportedFileRecord[];
}

/** The key the list of trusted folders is kept under. */
const LIST_KEY = `${FOLDER_KEY_PREFIX}trusted-folders`;

/** The start of the key of each trusted folder. */
const FOLDER_PREFIX = `${FOLDER_KEY_PREFIX}trusted-`;

/** The most records a folder keeps, one for each name exported there last. */
const MOST_RECORDS = 1_024;

/** A member of an object, where the value is one. */
function member(host: unknown, name: string): unknown {
  return typeof host === 'object' && host !== null ? Reflect.get(host, name) : undefined;
}

/** A record read back, where it is one. */
function recordOf(value: unknown): ExportedFileRecord | undefined {
  const name = member(value, 'name');
  const size = member(value, 'size');
  const hash = member(value, 'hash');
  return typeof name === 'string' &&
    typeof size === 'number' &&
    Number.isSafeInteger(size) &&
    size >= 0 &&
    typeof hash === 'string'
    ? { name, size, hash }
    : undefined;
}

/** A folder's entry read back, where it is one. */
function entryOf(key: string, value: unknown): TrustedFolder | undefined {
  const folder = member(value, 'folder');
  const records = member(value, 'records');
  if (!(folder instanceof FileSystemDirectoryHandle) || !Array.isArray(records)) return undefined;
  const read: unknown[] = records;
  return {
    key,
    folder,
    records: read.map(recordOf).filter((record) => record !== undefined),
  };
}

/** The folders kept trusted (see the module comment). */
export class TrustedFolders {
  readonly #database: HandleStore;
  readonly #nextToken: TokenSource;

  constructor(factory: HandleDatabaseFactory, nextToken: TokenSource) {
    this.#database = new HandleStore(factory);
    this.#nextToken = nextToken;
  }

  /** Every folder kept trusted, in the order each was marked. */
  async list(): Promise<readonly TrustedFolder[]> {
    const folders: TrustedFolder[] = [];
    for (const key of await this.#keys()) {
      const folder = await this.find(key);
      if (folder !== undefined) folders.push(folder);
    }
    return folders;
  }

  /** The folder kept trusted under `key`, where one is. */
  async find(key: string): Promise<TrustedFolder | undefined> {
    return entryOf(key, await this.#get(key));
  }

  /**
   * Marks `folder` trusted, answering the key it is kept under: the key it
   * has already, where it is the same folder as one kept.
   */
  async trust(folder: FileSystemDirectoryHandle): Promise<string> {
    for (const kept of await this.list()) {
      if (await kept.folder.isSameEntry(folder)) return kept.key;
    }
    const key = `${FOLDER_PREFIX}${this.#nextToken()}`;
    await this.#put(key, { folder, records: [] });
    await this.#put(LIST_KEY, [...(await this.#keys()), key]);
    return key;
  }

  /**
   * Keeps the records of files exported into the folder kept under `key`, in
   * order, as a batch delivers them, each in place of any record of its name,
   * the oldest let go past `MOST_RECORDS`.
   */
  async record(key: string, records: readonly ExportedFileRecord[]): Promise<void> {
    const kept = await this.find(key);
    if (kept === undefined) return;
    let held = kept.records;
    for (const record of records) {
      held = [...held.filter((each) => each.name !== record.name), record];
    }
    await this.#put(key, { folder: kept.folder, records: held.slice(-MOST_RECORDS) });
  }

  /** No longer trusts the folder kept under `key`; none there is not a failure. */
  async forget(key: string): Promise<void> {
    await this.#put(
      LIST_KEY,
      (await this.#keys()).filter((each) => each !== key),
    );
    const transaction = (await this.#database.open()).transaction(HANDLE_STORE, 'readwrite');
    const done = committed(transaction, 'Forgetting a trusted folder');
    transaction.objectStore(HANDLE_STORE).delete(key);
    await done;
  }

  /** The keys of the folders kept trusted. */
  async #keys(): Promise<readonly string[]> {
    const listed = await this.#get(LIST_KEY);
    if (!Array.isArray(listed)) return [];
    const keys: unknown[] = listed;
    return keys.filter(
      (key): key is string => typeof key === 'string' && key.startsWith(FOLDER_PREFIX),
    );
  }

  async #get(key: string): Promise<unknown> {
    const transaction = (await this.#database.open()).transaction(HANDLE_STORE, 'readonly');
    return await settled(
      transaction.objectStore(HANDLE_STORE).get(key),
      'Finding a trusted folder',
    );
  }

  async #put(key: string, value: unknown): Promise<void> {
    const transaction = (await this.#database.open()).transaction(HANDLE_STORE, 'readwrite');
    const done = committed(transaction, 'Keeping a trusted folder');
    transaction.objectStore(HANDLE_STORE).put(value, key);
    await done;
  }
}
