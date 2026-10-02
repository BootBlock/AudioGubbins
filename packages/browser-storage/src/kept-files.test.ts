import { countingTokens } from '@audiogubbins/media-store/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileHandleKeeper } from './file-handle-keeper.js';
import { reopenKeptFile, requestKeptFileAccess } from './kept-files.js';
import { FakeFileHandle, installFakeHandles } from './testing/file-handles.js';
import { MemoryDatabases } from './testing/memory-indexed-db.js';

beforeEach(installFakeHandles);
afterEach(() => {
  vi.unstubAllGlobals();
});

async function kept(): Promise<{
  readonly keeper: FileHandleKeeper;
  readonly handle: FakeFileHandle;
  readonly key: string;
}> {
  const keeper = new FileHandleKeeper(new MemoryDatabases(), countingTokens());
  const handle = new FakeFileHandle(
    new File(['audio'], 'take.wav', { type: 'audio/wav', lastModified: 1_000 }),
  );
  return { keeper, handle, key: await keeper.keep(handle) };
}

describe('finding a linked file again', () => {
  it('answers the file, with its handle key, where it is there and readable', async () => {
    const { keeper, key } = await kept();
    const access = await reopenKeptFile(keeper, key);

    expect(access).toMatchObject({
      kind: 'available',
      file: { fileName: 'take.wav', mediaType: 'audio/wav', lastModified: 1_000, handleKey: key },
    });
    if (access.kind !== 'available') return;
    expect(await access.file.file.text()).toBe('audio');
  });

  it('answers missing where nothing is kept under the key, or the file has gone', async () => {
    const { keeper, handle, key } = await kept();
    expect(await reopenKeptFile(keeper, 'unknown')).toEqual({ kind: 'missing' });

    handle.delete();
    expect(await reopenKeptFile(keeper, key)).toEqual({ kind: 'missing' });
  });

  it('answers that leave is needed without asking, and asks only when told to', async () => {
    const { keeper, handle, key } = await kept();
    handle.permission.state = 'prompt';

    expect(await reopenKeptFile(keeper, key)).toEqual({ kind: 'permission-needed' });
    expect(handle.permission.state).toBe('prompt');

    expect(await requestKeptFileAccess(keeper, key)).toMatchObject({ kind: 'available' });
  });

  it('answers that leave is still needed where the gesture that asks has lapsed', async () => {
    const { keeper, handle, key } = await kept();
    handle.permission.state = 'prompt';
    handle.permission.activated = false;

    expect(await requestKeptFileAccess(keeper, key)).toEqual({ kind: 'permission-needed' });
    handle.permission.activated = true;
    expect(await requestKeptFileAccess(keeper, key)).toMatchObject({ kind: 'available' });
  });

  it('answers denied where the user refused, whether before or when asked', async () => {
    const { keeper, handle, key } = await kept();
    handle.permission.state = 'prompt';
    handle.permission.answer = 'denied';
    expect(await requestKeptFileAccess(keeper, key)).toEqual({ kind: 'denied' });
    expect(await reopenKeptFile(keeper, key)).toEqual({ kind: 'denied' });
  });
});
