import { countingTokens } from '@audiogubbins/media-store/testing';
import { FOLDER_KEY_PREFIX, isHandleKey } from '@audiogubbins/project-format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileHandleKeeper } from './file-handle-keeper.js';
import { FakeDirectoryHandle, FakeFileHandle, installFakeHandles } from './testing/file-handles.js';
import { MemoryDatabases } from './testing/memory-indexed-db.js';
import { MOST_RECORDS, TrustedFolders } from './trusted-folders.js';

/**
 * The folders kept trusted for exports (ADR-0092): each kept with the records
 * of what was exported into it, the last for each name, beside the kept
 * handles and under keys no linked file can record.
 */

beforeEach(installFakeHandles);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the folders kept trusted for exports', () => {
  it('keeps a folder once, under a key no linked file may record, and finds it again', async () => {
    const databases = new MemoryDatabases();
    const trusted = new TrustedFolders(databases, countingTokens());
    const folder = new FakeDirectoryHandle('Game sounds', []);
    const key = await trusted.trust(folder);

    expect(isHandleKey(key)).toBe(false);
    expect(await trusted.trust(folder)).toBe(key);
    expect(await trusted.find(key)).toEqual({ key, folder, records: [] });
    // Another window, opening the same database, finds it too.
    const elsewhere = new TrustedFolders(databases, countingTokens());
    expect((await elsewhere.list()).map((each) => each.key)).toEqual([key]);
  });

  it('keeps the last record of each name, letting the oldest go past the most it keeps', async () => {
    const trusted = new TrustedFolders(new MemoryDatabases(), countingTokens());
    const key = await trusted.trust(new FakeDirectoryHandle('Game sounds', []));
    await trusted.record(key, [
      { name: 'Step.wav', size: 10, hash: 'a'.repeat(64) },
      { name: 'Rain.wav', size: 20, hash: 'b'.repeat(64) },
    ]);
    await trusted.record(key, [{ name: 'Step.wav', size: 11, hash: 'c'.repeat(64) }]);

    expect((await trusted.find(key))?.records).toEqual([
      { name: 'Rain.wav', size: 20, hash: 'b'.repeat(64) },
      { name: 'Step.wav', size: 11, hash: 'c'.repeat(64) },
    ]);

    await trusted.record(
      key,
      Array.from({ length: MOST_RECORDS }, (_, index) => ({
        name: `${String(index)}.wav`,
        size: index,
        hash: 'd'.repeat(64),
      })),
    );
    const records = (await trusted.find(key))?.records ?? [];
    expect(records).toHaveLength(MOST_RECORDS);
    expect(records.some((record) => record.name === 'Rain.wav')).toBe(false);
  });

  it('forgets a folder, and reads nothing as one that is not', async () => {
    const databases = new MemoryDatabases();
    const trusted = new TrustedFolders(databases, countingTokens());
    const key = await trusted.trust(new FakeDirectoryHandle('Game sounds', []));
    await trusted.forget(key);
    expect(await trusted.list()).toEqual([]);
    expect(
      databases
        .contents('audiogubbins-file-handles', 'handles')
        .get(`${FOLDER_KEY_PREFIX}trusted-folders`),
    ).toEqual([]);
    expect(await trusted.find(key)).toBeUndefined();

    // A linked file's handle is never read back as a trusted folder.
    const keeper = new FileHandleKeeper(databases, countingTokens());
    const file = await keeper.keep(new FakeFileHandle(new File(['x'], 'take.wav')));
    expect(await trusted.find(file)).toBeUndefined();
  });
});
