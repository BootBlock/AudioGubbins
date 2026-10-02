import { Blob as PlatformBlob, File as PlatformFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { webDigest } from '@audiogubbins/browser-storage';
import { unsafeBrandId } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { SourceHandling } from '@audiogubbins/media-store';
import { memorySource } from '@audiogubbins/media-store/testing';
import { contentIdOf } from '@audiogubbins/project-format';

import { projectScene, storedModel } from '../testing/project-scene.js';
import type { PageFile } from './page-ports.js';

const IMPORTED_AT = 1_790_000_000_000;
const ASSET = unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000a1');

/** A mono 16-bit WAV at 48 kHz holding `samples`, written field by field. */
function monoWav(samples: readonly number[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(at + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    view.setInt16(44 + index * 2, sample, true);
  });
  return bytes;
}

function pageFileOf(bytes: Uint8Array<ArrayBuffer>, fileName: string): PageFile {
  return {
    bytes: { kind: 'file', file: new File([bytes], fileName, { lastModified: IMPORTED_AT }) },
    fileName,
    mediaType: 'audio/wav',
    lastModified: IMPORTED_AT,
  };
}

// jsdom's `File` and `Blob` clone to plain objects, where a browser clones
// them whole, so these tests hold the platform's own.
beforeEach(() => {
  vi.stubGlobal('File', PlatformFile);
  vi.stubGlobal('Blob', PlatformBlob);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('audio files, through the storage worker (ADR-0052)', () => {
  it('imports a file the page passes as one asset, and answers the stored object as a file', async () => {
    const { storage, project, session } = await projectScene();
    const bytes = monoWav(Array.from({ length: 4_800 }, (_, index) => (index % 200) - 100));

    const imported = expectSuccess(
      await storage.client.media.import(session, {
        file: pageFileOf(bytes, 'Kick drum.wav'),
        choice: { mode: SourceHandling.Copy },
        assetId: ASSET,
        importedAt: IMPORTED_AT,
      }),
    );

    expect(imported.asset).toMatchObject({ displayName: 'Kick drum', length: 4_800 });
    expect(session.getSnapshot().model.state.project.assets.get(ASSET)).toEqual(imported.asset);
    const stored = await storedModel(storage, project);
    const media = stored.state.sources.get(ASSET)?.media;
    const { contentId } = expectSuccess(
      await contentIdOf(memorySource(bytes), webDigest(crypto.subtle)),
    );
    expect(media).toMatchObject({ kind: 'managed', contentId });

    const file = expectSuccess(await storage.client.media.file(contentId));
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(storage.lentPorts()).toBe(0);
  });

  it('refuses a file it does not read, naming it, and keeps nothing', async () => {
    const { storage, project, session } = await projectScene();
    const ogg = new Uint8Array(1_024);
    ogg.set([0x4f, 0x67, 0x67, 0x53]);

    const refused = await storage.client.media.import(session, {
      file: pageFileOf(ogg, 'Rain.ogg'),
      choice: { mode: SourceHandling.Copy },
      assetId: ASSET,
      importedAt: IMPORTED_AT,
    });

    expect(expectFailureCode(refused)).toBe('codecs.unsupported-format');
    expect(refused.ok ? '' : refused.failures[0].summary).toContain('Ogg');
    expect((await storedModel(storage, project)).state.project.assets.size).toBe(0);
    const { contentId } = expectSuccess(
      await contentIdOf(memorySource(ogg), webDigest(crypto.subtle)),
    );
    expect(expectFailureCode(await storage.client.media.file(contentId))).toBe(
      'media.object-missing',
    );
  });
});
