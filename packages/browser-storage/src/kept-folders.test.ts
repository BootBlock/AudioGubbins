import { countingTokens } from '@audiogubbins/media-store/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileHandleKeeper, FolderUse } from './file-handle-keeper.js';
import { reopenKeptFolder, requestKeptFolderAccess } from './kept-folders.js';
import { FakeDirectoryHandle, FakeFileHandle, installFakeHandles } from './testing/file-handles.js';
import { MemoryDatabases } from './testing/memory-indexed-db.js';

beforeEach(installFakeHandles);
afterEach(() => {
  vi.unstubAllGlobals();
});

async function kept(): Promise<{
  readonly keeper: FileHandleKeeper;
  readonly folder: FakeDirectoryHandle;
}> {
  const keeper = new FileHandleKeeper(new MemoryDatabases(), countingTokens());
  const folder = new FakeDirectoryHandle('Backups', []);
  await keeper.keepFolder(FolderUse.Backups, folder);
  return { keeper, folder };
}

describe('finding the folder chosen for backups again', () => {
  it('answers the folder where the browser lets it be written', async () => {
    const { keeper, folder } = await kept();

    expect(await reopenKeptFolder(keeper, FolderUse.Backups)).toEqual({
      kind: 'available',
      folder,
    });
  });

  it('answers none where no folder is kept, or a file stands under its use', async () => {
    const keeper = new FileHandleKeeper(new MemoryDatabases(), countingTokens());
    expect(await reopenKeptFolder(keeper, FolderUse.Backups)).toEqual({ kind: 'none' });

    const { keeper: forgetting } = await kept();
    await forgetting.forget(FolderUse.Backups);
    expect(await reopenKeptFolder(forgetting, FolderUse.Backups)).toEqual({ kind: 'none' });

    // A key of a file is never read back as a folder.
    const key = await keeper.keep(new FakeFileHandle(new File(['x'], 'take.wav')));
    expect(await keeper.findFolder(FolderUse.Backups)).toBeUndefined();
    expect(await keeper.find(key)).toBeDefined();
  });

  it('says leave is needed without asking, as after a reload, and asks only when told to', async () => {
    const { keeper, folder } = await kept();
    folder.permission.state = 'prompt';

    expect(await reopenKeptFolder(keeper, FolderUse.Backups)).toEqual({
      kind: 'permission-needed',
      name: 'Backups',
    });
    expect(folder.permission.state).toBe('prompt');

    expect(await requestKeptFolderAccess(keeper, FolderUse.Backups)).toEqual({
      kind: 'available',
      folder,
    });

    // Leave to write, which is what a backup needs: leave to read alone would
    // be granted and the first copy refused.
    expect(folder.modesAsked).toEqual(['readwrite', 'readwrite']);
  });

  it('answers denied, with the folder’s name, where the user refused', async () => {
    const { keeper, folder } = await kept();
    folder.permission.state = 'prompt';
    folder.permission.answer = 'denied';

    expect(await requestKeptFolderAccess(keeper, FolderUse.Backups)).toEqual({
      kind: 'denied',
      name: 'Backups',
    });
    expect(await reopenKeptFolder(keeper, FolderUse.Backups)).toEqual({
      kind: 'denied',
      name: 'Backups',
    });
  });

  it('keeps one folder for the use, the one chosen last', async () => {
    const { keeper } = await kept();
    const other = new FakeDirectoryHandle('Elsewhere', []);
    await keeper.keepFolder(FolderUse.Backups, other);

    expect(await keeper.findFolder(FolderUse.Backups)).toBe(other);
  });
});
