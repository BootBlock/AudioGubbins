import { describe, expect, it } from 'vitest';

import { StorageCapabilityKey, missingStorageCapabilities } from './storage-capabilities.js';
import {
  readOriginPrivateRoot,
  readStoragePlatform,
  type StorageGlobals,
  type StorageNavigator,
} from './storage-platform.js';

const unused = (): never => {
  throw new Error('Not used by these tests.');
};

/** The root directory a storage manager hands over. */
const ROOT: FileSystemDirectoryHandle = {
  kind: 'directory',
  name: '',
  isSameEntry: unused,
  getDirectoryHandle: unused,
  getFileHandle: unused,
  removeEntry: unused,
  resolve: unused,
};

/** A storage manager offering everything, recording what it was asked. */
function storageManager(asked: string[]): StorageManager {
  return {
    getDirectory: () => {
      asked.push('getDirectory');
      return Promise.resolve(ROOT);
    },
    persist: () => {
      asked.push('persist');
      return Promise.resolve(true);
    },
    persisted: () => Promise.resolve(false),
    estimate: () => Promise.resolve({ usage: 1, quota: 2 }),
  };
}

/** A worker constructor, which is all the reader asks about. */
class FakeWorker {
  terminate(): void {
    return undefined;
  }
}

const LOCKS: LockManager = { request: unused, query: unused };

const DATABASES: IDBFactory = {
  open: unused,
  deleteDatabase: unused,
  cmp: unused,
  databases: unused,
};

/** A browser offering everything storage reads. */
function everything(asked: string[] = []): {
  readonly navigatorLike: StorageNavigator;
  readonly globalLike: StorageGlobals & Record<string, unknown>;
} {
  return {
    navigatorLike: { storage: storageManager(asked), locks: LOCKS },
    globalLike: {
      indexedDB: DATABASES,
      crypto,
      BroadcastChannel,
      MessageChannel,
      Worker: FakeWorker,
      showOpenFilePicker: (options: unknown) => {
        asked.push(`open ${JSON.stringify(options)}`);
        return Promise.resolve([]);
      },
      showDirectoryPicker: () => Promise.resolve(ROOT),
      showSaveFilePicker: () => Promise.resolve(ROOT),
      scheduler: {
        yield: () => {
          asked.push('yield');
          return Promise.resolve();
        },
      },
    },
  };
}

describe('the storage objects the browser offers', () => {
  it('reads every one a browser offering them all has, each bound to its host', async () => {
    const asked: string[] = [];
    const { navigatorLike, globalLike } = everything(asked);
    const platform = readStoragePlatform(navigatorLike, globalLike);

    expect(platform.originPrivateFileSystem).toBe(true);
    expect(platform.locks).toBe(navigatorLike.locks);
    expect(platform.indexedDb).toBe(globalLike.indexedDB);
    expect(platform.subtle).toBe(crypto.subtle);
    expect(platform.randomBytes?.(16)).toHaveLength(16);
    expect(platform.openBroadcastChannel?.('audiogubbins')).toBeInstanceOf(BroadcastChannel);

    expect(await platform.persistence?.persist()).toBe(true);
    expect(await platform.persistence?.persisted()).toBe(false);
    expect(await platform.estimate?.()).toEqual({ usage: 1, quota: 2 });
    expect(await platform.pickers?.openFiles({ multiple: true })).toEqual([]);
    expect(platform.hostYielding.kind).toBe('scheduler');
    if (platform.hostYielding.kind === 'scheduler') await platform.hostYielding.yieldNow();

    expect(asked).toEqual(['persist', 'open {"multiple":true}', 'yield']);
    expect(missingStorageCapabilities(platform)).toEqual([]);
  });

  it('reads nothing a browser without them has, and says what each absence costs', () => {
    const platform = readStoragePlatform({}, {});

    expect(platform).toEqual({
      originPrivateFileSystem: false,
      locks: undefined,
      openBroadcastChannel: undefined,
      persistence: undefined,
      estimate: undefined,
      pickers: undefined,
      indexedDb: undefined,
      subtle: undefined,
      randomBytes: undefined,
      hostYielding: { kind: 'none' },
    });
    const missing = missingStorageCapabilities(platform);
    expect(missing.map(({ key }) => key)).toEqual(Object.values(StorageCapabilityKey));
    for (const absence of missing) {
      expect(absence.reason).not.toBe('');
      expect(absence.fallback).not.toBe('');
    }
    expect(missing.find(({ key }) => key === StorageCapabilityKey.WebLocks)?.fallback).toMatch(
      /read-only/,
    );
  });

  it('needs a worker for the origin-private file system, whose files only a worker can write', () => {
    const { navigatorLike, globalLike } = everything();
    const withoutWorkers = readStoragePlatform(navigatorLike, { ...globalLike, Worker: undefined });
    expect(withoutWorkers.originPrivateFileSystem).toBe(false);
  });

  it('offers no pickers where the browser has only some of them', () => {
    const { navigatorLike, globalLike } = everything();
    const withoutSaving: StorageGlobals & Record<string, unknown> = {
      ...globalLike,
      showSaveFilePicker: undefined,
    };
    const partial = readStoragePlatform(navigatorLike, withoutSaving);
    expect(partial.pickers).toBeUndefined();
  });

  it('gives turns through a posted message where the browser has no scheduler', () => {
    const { navigatorLike, globalLike } = everything();
    const withoutScheduler: StorageGlobals & Record<string, unknown> = {
      ...globalLike,
      scheduler: undefined,
    };
    const platform = readStoragePlatform(navigatorLike, withoutScheduler);
    expect(platform.hostYielding.kind).toBe('macrotask');
    if (platform.hostYielding.kind === 'macrotask') {
      expect(platform.hostYielding.createChannel()).toBeInstanceOf(MessageChannel);
    }
  });

  it('takes an object the browser refuses to hand over as not offered, and a fault as a fault', () => {
    const refusing = {
      get storage(): StorageManager {
        throw new DOMException('Sandboxed.', 'SecurityError');
      },
    };
    expect(readStoragePlatform(refusing, {}).persistence).toBeUndefined();
    expect(readOriginPrivateRoot(refusing)).toBeUndefined();

    const faulty = {
      get storage(): StorageManager {
        throw new TypeError('A defect.');
      },
    };
    expect(() => readStoragePlatform(faulty, {})).toThrow(TypeError);
  });

  it("reads the worker's own root directory", async () => {
    const asked: string[] = [];
    const root = readOriginPrivateRoot({ storage: storageManager(asked) });
    expect(await root?.()).toBe(ROOT);
    expect(asked).toEqual(['getDirectory']);
  });
});
