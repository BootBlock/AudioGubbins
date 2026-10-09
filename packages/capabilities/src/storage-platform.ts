/**
 * The browser's storage objects, read once and handed down as typed values.
 *
 * The storage adapters reach no global: each platform object they use is read
 * here, beside every other question put to the browser (REQ-EXEC-136.4), and
 * passed to them by the composition root. An object the browser does not offer
 * is `undefined` rather than a stand-in, so whoever holds the value decides
 * what happens without it (REQ-EXEC-216), and `storage-capabilities.ts` says
 * what that costs the user.
 *
 * Read from a navigator and a global object given as arguments, as
 * `readLayoutMap` is, so a test states the browser it describes and a worker
 * reads its own. The pickers and the scheduler are absent from the DOM type
 * definitions, so they are read through `Reflect` and checked, not trusted.
 */

import { method, offered } from './browser-reads.js';

/** The members of a page's or a worker's navigator that storage reads. */
export interface StorageNavigator {
  readonly storage?: StorageManager | undefined;
  readonly locks?: LockManager | undefined;
}

/** The members of a page's or a worker's global object that storage reads. */
export interface StorageGlobals {
  readonly indexedDB?: IDBFactory | undefined;
  readonly crypto?: Crypto | undefined;
  readonly BroadcastChannel?: typeof BroadcastChannel | undefined;
  readonly MessageChannel?: typeof MessageChannel | undefined;
  /** Only whether it is a constructor is asked; the application makes the worker. */
  readonly Worker?: unknown;
}

/** Asking the browser not to evict this origin's storage, and whether it agreed. */
export interface StoragePersistence {
  readonly persist: () => Promise<boolean>;
  readonly persisted: () => Promise<boolean>;
}

/**
 * The File System Access pickers, which only Chromium offers. Each resolves to
 * whatever the browser returns, which the adapters check.
 */
export interface FilePickers {
  readonly openFiles: (options: object) => Promise<unknown>;
  readonly openDirectory: (options: object) => Promise<unknown>;
  readonly saveFile: (options: object) => Promise<unknown>;
}

/**
 * How long work gives the page a turn: the scheduler's own yield where the
 * browser has it, a message posted to itself otherwise, which runs after the
 * events already queued, and nothing where neither exists.
 */
export type HostYielding =
  | { readonly kind: 'scheduler'; readonly yieldNow: () => Promise<void> }
  | { readonly kind: 'macrotask'; readonly createChannel: () => MessageChannel }
  | { readonly kind: 'none' };

/** Every storage object the browser offers, read once. */
export interface StoragePlatform {
  /**
   * Whether projects can be kept in the origin-private file system.
   *
   * The files are written through synchronous access handles, which every floor
   * browser offers only inside a dedicated worker, and whose presence cannot be
   * seen from the page. So this needs both the directory and the worker; the
   * worker reads its own root through {@link readOriginPrivateRoot}.
   */
  readonly originPrivateFileSystem: boolean;
  readonly locks: LockManager | undefined;
  readonly openBroadcastChannel: ((name: string) => BroadcastChannel) | undefined;
  readonly persistence: StoragePersistence | undefined;
  readonly estimate: (() => Promise<StorageEstimate>) | undefined;
  readonly pickers: FilePickers | undefined;
  readonly indexedDb: IDBFactory | undefined;
  readonly subtle: SubtleCrypto | undefined;

  /**
   * Cryptographically random bytes, from which the tokens that name kept
   * handles and stored objects are made, since two tabs choosing names must
   * never choose the same one.
   */
  readonly randomBytes: ((length: number) => Uint8Array) | undefined;
  readonly hostYielding: HostYielding;
}

/**
 * The origin-private file system's root, for the worker that writes it.
 *
 * The one read of `getDirectory`: a page asks whether it exists, and the
 * worker, which alone can write through it, asks for the directory.
 */
export function readOriginPrivateRoot(
  navigatorLike: StorageNavigator,
): (() => Promise<FileSystemDirectoryHandle>) | undefined {
  return offered(() => {
    const storage = navigatorLike.storage;
    if (typeof storage?.getDirectory !== 'function') return undefined;
    return () => storage.getDirectory();
  });
}

function readPersistence(navigatorLike: StorageNavigator): StoragePersistence | undefined {
  return offered(() => {
    const storage = navigatorLike.storage;
    if (typeof storage?.persist !== 'function' || typeof storage.persisted !== 'function') {
      return undefined;
    }
    return { persist: () => storage.persist(), persisted: () => storage.persisted() };
  });
}

function readEstimate(
  navigatorLike: StorageNavigator,
): (() => Promise<StorageEstimate>) | undefined {
  return offered(() => {
    const storage = navigatorLike.storage;
    if (typeof storage?.estimate !== 'function') return undefined;
    return () => storage.estimate();
  });
}

function readLocks(navigatorLike: StorageNavigator): LockManager | undefined {
  return offered(() => {
    const locks = navigatorLike.locks;
    return typeof locks?.request === 'function' ? locks : undefined;
  });
}

/** One picker, answering a promise of what it chose, where the browser has it. */
function readPicker(globalLike: object, name: string): FilePickers['openFiles'] | undefined {
  const pick = offered(() => method(globalLike, name));
  if (pick === undefined) return undefined;
  return async (options) => {
    const chosen: unknown = await pick(options);
    return chosen;
  };
}

function readPickers(globalLike: object): FilePickers | undefined {
  const openFiles = readPicker(globalLike, 'showOpenFilePicker');
  const openDirectory = readPicker(globalLike, 'showDirectoryPicker');
  const saveFile = readPicker(globalLike, 'showSaveFilePicker');
  // Chromium shipped the three together; a browser with only some of them is
  // one no floor version is, and is treated as offering none rather than
  // leaving a flow that can pick a file but never save one.
  if (openFiles === undefined || openDirectory === undefined || saveFile === undefined) {
    return undefined;
  }
  return { openFiles, openDirectory, saveFile };
}

function readHostYielding(globalLike: StorageGlobals): HostYielding {
  const scheduler = offered((): unknown => Reflect.get(globalLike, 'scheduler'));
  const yieldNow = offered(() => method(scheduler, 'yield'));
  if (yieldNow !== undefined) {
    return {
      kind: 'scheduler',
      yieldNow: async () => {
        await yieldNow();
      },
    };
  }
  const Channel = offered(() => globalLike.MessageChannel);
  if (typeof Channel === 'function')
    return { kind: 'macrotask', createChannel: () => new Channel() };
  return { kind: 'none' };
}

/**
 * Reads every storage object once, from the page's navigator and global object,
 * which the composition root passes as `navigator` and `globalThis`.
 */
export function readStoragePlatform(
  navigatorLike: StorageNavigator,
  globalLike: StorageGlobals,
): StoragePlatform {
  const Channel = offered(() => globalLike.BroadcastChannel);
  const hasWorkers = offered(() => typeof globalLike.Worker === 'function') ?? false;
  const factory = offered(() => globalLike.indexedDB);
  // Undefined outside a secure context, whatever its type says.
  const subtle = offered(() => globalLike.crypto?.subtle);
  const random = offered(() => globalLike.crypto);

  return {
    originPrivateFileSystem: hasWorkers && readOriginPrivateRoot(navigatorLike) !== undefined,
    locks: readLocks(navigatorLike),
    openBroadcastChannel:
      typeof Channel === 'function' ? (name: string) => new Channel(name) : undefined,
    persistence: readPersistence(navigatorLike),
    estimate: readEstimate(navigatorLike),
    pickers: readPickers(globalLike),
    indexedDb: typeof factory?.open === 'function' ? factory : undefined,
    subtle: typeof subtle?.digest === 'function' ? subtle : undefined,
    randomBytes:
      typeof random?.getRandomValues === 'function'
        ? (length: number) => random.getRandomValues(new Uint8Array(length))
        : undefined,
    hostYielding: readHostYielding(globalLike),
  };
}
