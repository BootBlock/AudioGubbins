import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { readBundleManifest, writeBundleManifest, type ManifestEntry } from './bundle-manifest.js';
import { contentIdOfDigit } from './testing/project-states.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

const ENTRIES: readonly ManifestEntry[] = [
  { path: 'media/' + contentIdOfDigit('a'), size: 9_600, contentId: contentIdOfDigit('a') },
  { path: 'audiogubbins-project.json', size: 310, contentId: contentIdOfDigit('1') },
  { path: 'project/settings.json', size: 60, contentId: contentIdOfDigit('2') },
];

function edited(change: (manifest: Record<string, unknown>) => unknown): Uint8Array {
  const manifest: Record<string, unknown> = JSON.parse(
    expectSuccess(decodeUtf8(expectSuccess(writeBundleManifest(ENTRIES)))),
  );
  return encodeUtf8(JSON.stringify(change(manifest)));
}

describe('the bundle manifest (REQ-STOR-099, REQ-STOR-052)', () => {
  it('lists every entry sorted by path, and reads back as written', () => {
    const bytes = expectSuccess(writeBundleManifest(ENTRIES));
    const read = expectSuccess(readBundleManifest(bytes));
    expect(read.entries.map(({ path }) => path)).toEqual([
      'audiogubbins-project.json',
      `media/${contentIdOfDigit('a')}`,
      'project/settings.json',
    ]);
    expect(expectSuccess(writeBundleManifest(read.entries))).toEqual(bytes);
  });

  it('refuses a manifest of another bundle schema, naming the version found', () => {
    const newer = SCHEMA_VERSIONS.portableBundle + 1;
    const read = readBundleManifest(edited((manifest) => ({ ...manifest, schemaVersion: newer })));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.failures[0]).toMatchObject({
      code: 'format.schema-incompatible',
      details: { schema: 'portableBundle', found: newer },
    });
  });

  it('refuses a path listed twice, a path outside the tree and the manifest listing itself', () => {
    const twice = edited((manifest) => ({
      ...manifest,
      entries: [...(manifest['entries'] as unknown[]), (manifest['entries'] as unknown[])[0]],
    }));
    expect(expectFailureCode(readBundleManifest(twice))).toBe('manifest.duplicate-path');
    for (const path of ['../escape.json', 'manifest.json', 'Media/x', '']) {
      const bad = edited((manifest) => ({
        ...manifest,
        entries: [{ path, size: 1, contentId: contentIdOfDigit('3') }],
      }));
      expect(readBundleManifest(bad).ok).toBe(false);
    }
  });

  it('refuses to write a manifest listing a path twice', () => {
    const [first] = ENTRIES;
    if (first === undefined) throw new Error('No entry.');
    expect(() => expectSuccess(writeBundleManifest([...ENTRIES, first]))).toThrow(/twice/u);
  });

  it('refuses to write a manifest listing more files than its reader reads', () => {
    const contentId = contentIdOfDigit('4');
    const entries = Array.from({ length: 1_000_001 }, (_, index) => ({
      path: `media/${String(index)}`,
      size: 1,
      contentId,
    }));
    expect(expectFailureCode(writeBundleManifest(entries))).toBe('manifest.too-large');
  });
});
