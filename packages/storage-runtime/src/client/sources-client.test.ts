import { File as PlatformFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { webDigest } from '@audiogubbins/browser-storage';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { completeIdentity, type ExternalFile } from '@audiogubbins/media-store';
import { generatedSource, memorySource, observeFile } from '@audiogubbins/media-store/testing';
import type { ExternalSourceIdentity } from '@audiogubbins/project-format';

import { readPortMessage } from '../protocol/port-messages.js';
import { memoryStorage } from '../testing/memory-storage.js';
import type { PageFile } from './page-ports.js';

const RECORDED_AT = 1_790_000_000_000;

/** A linked file of `bytes`, as the page passes it, last changed at `lastModified`. */
function linkedFile(bytes: Uint8Array<ArrayBuffer>, lastModified: number): PageFile {
  return {
    bytes: { kind: 'file', file: new File([bytes], 'rain.wav', { lastModified }) },
    fileName: 'rain.wav',
    mediaType: 'audio/wav',
    lastModified,
    handleKey: 'handle-1',
  };
}

/** The identity the project recorded of `bytes`, its content hashed whole. */
async function recordedOf(bytes: Uint8Array<ArrayBuffer>): Promise<ExternalSourceIdentity> {
  const file: ExternalFile = {
    source: memorySource(bytes),
    fileName: 'rain.wav',
    mediaType: 'audio/wav',
    lastModified: RECORDED_AT,
    handleKey: 'handle-1',
  };
  const services = { digest: webDigest(crypto.subtle), yieldToHost: () => Promise.resolve() };
  const observed = expectSuccess(await observeFile(file, services.digest));
  return expectSuccess(await completeIdentity(observed, file.source, services));
}

// jsdom's `File` clones to a plain object, where a browser clones the file
// itself, so these tests hold the platform's own.
beforeEach(() => {
  vi.stubGlobal('File', PlatformFile);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('linked files, looked at again in the storage worker', () => {
  it('hashes a file the page passed in the worker, taking its turns, the page reading none', async () => {
    let turns = 0;
    const storage = memoryStorage({
      yieldToHost: () => {
        turns += 1;
        return Promise.resolve();
      },
    });
    const source = generatedSource(3_000_000, 5);
    const bytes = await source.read(0, source.size);
    const recorded = await recordedOf(bytes);
    const before = turns;

    // Touched since, with the same content: only the whole hash tells.
    const examined = await storage.client.sources.examine(
      recorded,
      linkedFile(bytes, RECORDED_AT + 60_000),
    );

    expect(expectSuccess(examined).contentId).toBe(recorded.contentId);
    expect(turns).toBeGreaterThan(before);
    const pageCalls = storage.pair.toPage.filter((data) => {
      const read = readPortMessage(data);
      return read.ok && read.value.type === 'call';
    });
    expect(pageCalls).toEqual([]);
    expect(storage.lentPorts()).toBe(0);
  });
});
