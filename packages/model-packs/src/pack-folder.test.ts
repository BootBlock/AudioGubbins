import { describe, expect, it } from 'vitest';

import type { DomainResult } from '@audiogubbins/domain';
import type { ByteSource } from '@audiogubbins/project-format';

import { nobleSha256 } from './adapter/noble-sha256.js';
import { refOf } from './manifest.js';
import { manifestJson } from './manifest-writing.js';
import { readPackFolder, type PackFolder } from './pack-folder.js';

/** The file a pack build writes a version's manifest to, beside its files. */
const PACK_MANIFEST_FILE = 'manifest.json';
import { PackInstaller } from './pack-installer.js';
import { MemoryPackStore } from './testing/memory-pack-store.js';
import { patterned, testPack } from './testing/node-sha256.js';
import type { TestPack } from './testing/sample-packs.js';

/**
 * A pack version a person already has, imported from the folder its build
 * wrote (ADR-0062): the folder's manifest, read by the one reader, and the
 * files it names, installed by the installer's own path and checked against
 * every hash.
 */

function codes<TValue>(result: DomainResult<TValue>): readonly string[] {
  return result.ok ? [] : result.failures.map((failure) => failure.code);
}

/** Bytes as a source. */
function sourceOf(bytes: Uint8Array<ArrayBuffer>): ByteSource {
  return {
    size: bytes.length,
    read: (offset, length) => Promise.resolve(bytes.slice(offset, offset + length)),
  };
}

/** The folder a pack build writes for `pack`: its manifest and its files, with `changes` made. */
function folderOf(
  pack: TestPack,
  changes: {
    readonly without?: string;
    readonly manifest?: Uint8Array<ArrayBuffer>;
    readonly serve?: Readonly<Record<string, Uint8Array<ArrayBuffer>>>;
  } = {},
): PackFolder {
  const files = new Map<string, Uint8Array<ArrayBuffer>>(pack.files);
  files.set(
    PACK_MANIFEST_FILE,
    changes.manifest ?? new TextEncoder().encode(JSON.stringify(manifestJson(pack.manifest))),
  );
  for (const [path, bytes] of Object.entries(changes.serve ?? {})) files.set(path, bytes);
  if (changes.without !== undefined) files.delete(changes.without);
  return {
    open: (path) => {
      const bytes = files.get(path);
      return Promise.resolve(bytes === undefined ? undefined : sourceOf(bytes));
    },
  };
}

describe('importing a pack from its folder', () => {
  it('installs every file the manifest names, checked as a download is', async () => {
    const pack = testPack();
    const store = new MemoryPackStore();
    const installer = new PackInstaller({ store, sha256: nobleSha256 });

    const imported = await readPackFolder(folderOf(pack));
    if (!imported.ok) throw new Error(imported.failures[0].summary);
    const state = await installer.download(imported.value.manifest, imported.value.source);

    expect(imported.value.manifest).toEqual(pack.manifest);
    expect(state).toEqual({ ok: true, value: { kind: 'installed' } });
    const read = await installer.read(refOf(pack.manifest), 'encoder.onnx');
    expect(read.ok ? [...read.value.bytes] : []).toEqual([...patterned(10, 1)]);
  });

  it('refuses a folder that holds no manifest, saying it is not a pack', async () => {
    const imported = await readPackFolder(folderOf(testPack(), { without: PACK_MANIFEST_FILE }));

    expect(codes(imported)).toEqual(['model-pack.import-manifest-missing']);
  });

  it('refuses a folder missing a file the manifest names, before anything is kept', async () => {
    const pack = testPack();
    const store = new MemoryPackStore();

    const imported = await readPackFolder(folderOf(pack, { without: 'models/decoder.onnx' }));

    expect(codes(imported)).toEqual(['model-pack.import-file-missing']);
    expect(imported.ok ? undefined : imported.failures[0].summary).toBe(
      'The folder chosen holds no models/decoder.onnx, which Sample pack 1.0.0 needs.',
    );
    expect(await store.kept()).toEqual({ ok: true, value: [] });
  });

  it('refuses a manifest the reader refuses, with the reader’s reasons', async () => {
    const imported = await readPackFolder(
      folderOf(testPack(), { manifest: new TextEncoder().encode('{"format": 1}') }),
    );

    expect(imported.ok).toBe(false);
    expect(codes(imported).length).toBeGreaterThan(0);
    expect(codes(imported)).not.toContain('model-pack.import-manifest-missing');
  });

  it('refuses a manifest longer than a manifest may be without reading it', async () => {
    const unread: ByteSource = {
      size: 256 * 1024 * 3 + 1,
      read: () => Promise.reject(new Error('The manifest was read.')),
    };
    const folder: PackFolder = {
      open: (path) => Promise.resolve(path === PACK_MANIFEST_FILE ? unread : undefined),
    };

    const imported = await readPackFolder(folder);

    expect(codes(imported)).toEqual(['model-pack.import-manifest-too-long']);
  });

  it('keeps nothing of a file whose bytes are not the ones its manifest names', async () => {
    const pack = testPack();
    const store = new MemoryPackStore();
    const installer = new PackInstaller({ store, sha256: nobleSha256 });

    const imported = await readPackFolder(
      folderOf(pack, { serve: { 'encoder.onnx': patterned(10, 9) } }),
    );
    if (!imported.ok) throw new Error(imported.failures[0].summary);
    const state = await installer.download(imported.value.manifest, imported.value.source);

    expect(state.ok && state.value.kind).toBe('failed');
    expect(installer.stateOf(refOf(pack.manifest)).kind).toBe('failed');
  });
});
