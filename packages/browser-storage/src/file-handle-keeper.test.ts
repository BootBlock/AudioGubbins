import { countingTokens } from '@audiogubbins/media-store/testing';
import { TreeFailure, TreeFailureKind } from '@audiogubbins/project-format';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import { FileHandleKeeper, type HandleDatabaseFactory } from './file-handle-keeper.js';
import { FakeFileHandle, installFakeHandles } from './testing/file-handles.js';
import { MemoryDatabases } from './testing/memory-indexed-db.js';

const DATABASE = 'audiogubbins-file-handles';

beforeEach(installFakeHandles);
afterEach(() => {
  vi.unstubAllGlobals();
});

const handle = (name: string): FakeFileHandle => new FakeFileHandle(new File(['x'], name));

describe('the kept handles of linked files', () => {
  it('opens through the browser’s own factory', () => {
    expectTypeOf<IDBFactory>().toExtend<HandleDatabaseFactory>();
  });

  it('keeps a handle under a token from the injected source, never under its name', async () => {
    const databases = new MemoryDatabases();
    const keeper = new FileHandleKeeper(databases, countingTokens());
    const kept = handle('Take 3 (final).wav');

    const key = await keeper.keep(kept);
    expect(key).toBe('t1');
    expect(await keeper.find(key)).toBe(kept);
    expect([...databases.contents(DATABASE, 'handles').keys()]).toEqual(['t1']);
  });

  it('finds nothing under a key it never kept, or one it forgot', async () => {
    const keeper = new FileHandleKeeper(new MemoryDatabases(), countingTokens());
    const key = await keeper.keep(handle('a.wav'));
    expect(await keeper.find('t9')).toBeUndefined();

    await keeper.forget(key);
    expect(await keeper.find(key)).toBeUndefined();
    await keeper.forget('t9');
  });

  it('opens the database once, and again only after another tab closes it with a newer version', async () => {
    const databases = new MemoryDatabases();
    const keeper = new FileHandleKeeper(databases, countingTokens());
    await keeper.keep(handle('a.wav'));
    await keeper.keep(handle('b.wav'));
    expect(databases.opened).toBe(1);

    databases.announceNewerVersion(DATABASE);
    await keeper.keep(handle('c.wav'));
    expect(databases.opened).toBe(2);
  });

  it('reports a database the browser will not open as its designed failure, and asks again next time', async () => {
    const refused = new DOMException('Blocked site data.', 'SecurityError');
    const keeper = new FileHandleKeeper(
      new MemoryDatabases({ refuseOpen: refused }),
      countingTokens(),
    );

    const failure = await keeper.keep(handle('a.wav')).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TreeFailure);
    expect(failure).toMatchObject({ kind: TreeFailureKind.Unavailable, cause: refused });
    await expect(keeper.find('t1')).rejects.toBeInstanceOf(TreeFailure);
  });

  it('reports a full disk as a quota failure', async () => {
    const full = new DOMException('Full.', 'QuotaExceededError');
    const keeper = new FileHandleKeeper(
      new MemoryDatabases({ refuseWrite: full }),
      countingTokens(),
    );
    await expect(keeper.keep(handle('a.wav'))).rejects.toMatchObject({
      kind: TreeFailureKind.Quota,
    });
  });
});
