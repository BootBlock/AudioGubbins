import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrustedFolders } from '@audiogubbins/browser-storage';
import {
  FakeDirectoryHandle,
  MemoryDatabases,
  installFakeHandles,
} from '@audiogubbins/browser-storage/testing';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { countingTokens } from '@audiogubbins/media-store/testing';

import { TrustedFoldersStore } from './trusted-folders-store.js';

beforeEach(() => {
  installFakeHandles();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function storeOver(): TrustedFoldersStore {
  return new TrustedFoldersStore(new TrustedFolders(new MemoryDatabases(), countingTokens()));
}

describe('the trusted folders (ADR-0092, REQ-ARCH-054)', () => {
  it('says why there are none where this browser keeps no folder', async () => {
    const store = new TrustedFoldersStore(undefined);
    await store.refresh();

    expect(store.get().kind).toBe('unavailable');
    expect(expectFailureCode(await store.trust(new FakeDirectoryHandle('Game sounds', [])))).toBe(
      'export.trusted-folders-unavailable',
    );
  });

  it('lists a folder once it is trusted, once however often it is chosen, and says what trusting does', async () => {
    const store = storeOver();
    await store.refresh();
    expect(store.get()).toEqual({ kind: 'read', folders: [] });
    const folder = new FakeDirectoryHandle('Game sounds', []);

    expect(expectSuccess(await store.trust(folder))).toMatch(
      /^“Game sounds” is trusted: an export there replaces a file it exported before/u,
    );
    expectSuccess(await store.trust(folder));
    const state = store.get();
    expect(state.kind === 'read' ? state.folders.map((one) => one.name) : []).toEqual([
      'Game sounds',
    ]);
  });

  it('lets a folder go by its key, and refuses one it does not keep', async () => {
    const store = storeOver();
    await store.trust(new FakeDirectoryHandle('Game sounds', []));
    const state = store.get();
    const key = state.kind === 'read' ? state.folders[0]?.key : undefined;
    if (key === undefined) throw new Error('The folder is listed.');

    expect(expectFailureCode(await store.forget('trusted-elsewhere'))).toBe(
      'export.trusted-folder-unknown',
    );
    expect(expectSuccess(await store.forget(key))).toBe(
      '“Game sounds” is no longer trusted; nothing in it was changed.',
    );
    expect(store.get()).toEqual({ kind: 'read', folders: [] });
  });
});
