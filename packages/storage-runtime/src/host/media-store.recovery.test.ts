import { describe, expect, it, vi } from 'vitest';

import { webDigest } from '@audiogubbins/browser-storage';
import { MediaObjectStore } from '@audiogubbins/media-store';
import {
  MemoryStorageTree,
  SimulatedCrash,
  countedSharing,
  countingTokens,
  generatedSource,
} from '@audiogubbins/media-store/testing';

import { memoryStorage } from '../testing/memory-storage.js';

/**
 * The media store's recovery of what a crash left of its writing, which the
 * storage worker runs as it starts (ADR-0071): an object a crash cut short is
 * undone before anything is stored, with no page asking.
 */

/** Storage a crash left in the middle of storing an object, with its intent written. */
async function cutShortWhileStoring(): Promise<MemoryStorageTree> {
  for (let crashAt = 1; ; crashAt += 1) {
    const tree = new MemoryStorageTree({ crashAt });
    const store = new MediaObjectStore({
      tree,
      root: 'media',
      digest: webDigest(crypto.subtle),
      nextToken: countingTokens(),
      sharing: countedSharing(),
    });
    await store.put(generatedSource(4_096, 7)).catch((error: unknown) => {
      if (!(error instanceof SimulatedCrash)) throw error;
    });
    const found = tree.restarted();
    const paths = found.paths();
    if (
      paths.some((path) => path.endsWith('.intent')) &&
      paths.some((path) => /^media\/[0-9a-f]{2}\//u.test(path))
    ) {
      return found;
    }
    if (crashAt > 100) throw new Error('No crash left an intent and its object.');
  }
}

describe('the storage worker as it starts', () => {
  it('undoes the object a crash cut short while it was stored, and the files it was received in', async () => {
    const tree = await cutShortWhileStoring();
    expect(tree.paths().some((path) => path.startsWith('media/incoming/'))).toBe(true);
    memoryStorage({ tree });
    await vi.waitFor(() => {
      expect(tree.paths().filter((path) => path.startsWith('media/'))).toEqual([]);
    });
  });
});
