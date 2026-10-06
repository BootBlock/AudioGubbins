import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FailureKind, fail, failure, succeed } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  PackInstaller,
  refOf,
  type FileRange,
  type PackRef,
  type PackSource,
  type ReceiveChunk,
  type Sha256,
} from '@audiogubbins/model-packs';
import { ANY_SHA256, sampleManifest } from '@audiogubbins/model-packs/testing';

import { planCleanup } from './cleanup-planning.js';
import { runCleanup } from './cleanup-running.js';
import type { ModelPackStore } from './model-pack-store.js';
import type { PackPins } from './pack-cleanup.js';
import { storageOf } from './testing/memory-ports.js';
import { harness } from './testing/node-services.js';

/**
 * Model packs in a cleanup (REQ-AUDIO-139, REQ-STOR-102, REQ-STOR-106): a
 * download not finished is offered as safe to remove, since nothing unverified
 * is used, but never while it is being written; an installed pack is removed
 * only where the person chose it, needing their confirmation; and a version a
 * project needs is never offered, the plan saying why it is kept, nor removed
 * where a project came to need it after the plan.
 */

/** Keeps a version of pack `id` whose one file holds `size` bytes, `kept` of them, sealed where whole. */
async function keptPack(packs: ModelPackStore, id: string, size: number, kept = size) {
  const manifest = sampleManifest({
    id,
    files: [{ path: 'model.onnx', bytes: size, sha256: ANY_SHA256 }],
  });
  expectSuccess(await packs.stage(manifest));
  const sink = expectSuccess(await packs.append(refOf(manifest), 0));
  await sink.write(new Uint8Array(kept));
  await sink.close();
  if (kept === size) expectSuccess(await packs.seal(refOf(manifest)));
  return refOf(manifest);
}

/** The storage of a test, its cleanup reading the pins `pins` gives. */
function storageWith(seed: number, pins: PackPins) {
  const test = harness(seed);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  return { tree, storage, cleaning: { ...storage.cleaning, packPins: pins } };
}

const pinning =
  (...refs: PackRef[]): PackPins =>
  () =>
    Promise.resolve(succeed(refs));

/** The versions the store keeps, by key and kind. */
async function keptKinds(packs: ModelPackStore): Promise<readonly string[]> {
  return expectSuccess(await packs.measured()).map(
    ({ ref, kind }) => `${ref.id}@${ref.version} ${kind}`,
  );
}

describe('model packs in a cleanup', () => {
  it('offers an unpinned pack to be chosen, keeps a pinned one and says why, and plans a stale download as safe', async () => {
    let pins: readonly PackRef[] = [];
    const { tree, storage, cleaning } = storageWith(141, () => Promise.resolve(succeed(pins)));
    const needed = await keptPack(storage.packs, 'needed-pack', 3_000);
    const spare = await keptPack(storage.packs, 'spare-pack', 2_000);
    const stale = await keptPack(storage.packs, 'stale-pack', 5_000, 1_200);
    pins = [needed];
    const sizes = (id: string) =>
      [...tree.snapshot()]
        .filter(([path]) => path.startsWith(`packs/${id}/`))
        .reduce((sum, [, bytes]) => sum + bytes.length, 0);

    const everything = expectSuccess(await planCleanup('everything', cleaning, 0));
    expect(everything.installedPacks).toEqual([
      { ref: needed, name: 'Sample pack', bytes: sizes('needed-pack'), kept: 'needed' },
      { ref: spare, name: 'Sample pack', bytes: sizes('spare-pack') },
    ]);
    expect(everything.steps).toEqual([
      {
        kind: 'pack-downloads',
        packs: [{ ref: stale, name: 'Sample pack', bytes: sizes('stale-pack') }],
        bytes: sizes('stale-pack'),
        loses: 'download-progress',
      },
    ]);
    expect(everything.confirmationBytes).toBe(0);

    const chosen = expectSuccess(
      await planCleanup([{ kind: 'model-packs', packs: [needed, spare] }], cleaning, 0),
    );
    expect(chosen.steps).toEqual([
      {
        kind: 'model-packs',
        packs: [{ ref: spare, name: 'Sample pack', bytes: sizes('spare-pack') }],
        bytes: sizes('spare-pack'),
        loses: 'model-packs',
      },
    ]);
    const spareBytes = sizes('spare-pack');
    expect(chosen.confirmationBytes).toBe(spareBytes);
    expect((await runCleanup(chosen, undefined, cleaning)).ok).toBe(false);
    expect(await keptKinds(storage.packs)).toHaveLength(3);

    expect(
      expectSuccess(await runCleanup(chosen, { bytes: chosen.confirmationBytes }, cleaning)),
    ).toEqual([{ step: 'model-packs', freed: spareBytes, busy: [] }]);
    expect(await keptKinds(storage.packs)).toEqual([
      'needed-pack@1.0.0 installed',
      'stale-pack@1.0.0 partial',
    ]);

    // A plan of what is safe alone is carried out at a press.
    expect(expectSuccess(await runCleanup(everything, undefined, cleaning))).toEqual([
      { step: 'pack-downloads', freed: everything.steps[0]?.bytes, busy: [] },
    ]);
    expect(await keptKinds(storage.packs)).toEqual(['needed-pack@1.0.0 installed']);
  });

  it('keeps every installed pack, saying so, where which ones projects need cannot be told', async () => {
    const unknown: PackPins = () =>
      Promise.resolve(
        fail(failure('test.pins-unread', FailureKind.Unrecoverable, 'A project cannot be read.')),
      );
    const { storage, cleaning } = storageWith(143, unknown);
    const pack = await keptPack(storage.packs, 'some-pack', 2_000);

    const plan = expectSuccess(
      await planCleanup([{ kind: 'model-packs', packs: [pack] }], cleaning, 0),
    );
    expect(plan.installedPacks).toMatchObject([{ ref: pack, kept: 'needs-unknown' }]);
    expect(plan.steps).toEqual([]);
  });

  it('keeps a chosen pack a project came to need after the plan, and says which', async () => {
    let pins: readonly PackRef[] = [];
    const { storage, cleaning } = storageWith(145, () => Promise.resolve(succeed(pins)));
    const pack = await keptPack(storage.packs, 'some-pack', 2_000);
    const plan = expectSuccess(
      await planCleanup([{ kind: 'model-packs', packs: [pack] }], cleaning, 0),
    );
    expect(plan.steps).toHaveLength(1);

    pins = [pack];
    expect(
      expectSuccess(await runCleanup(plan, { bytes: plan.confirmationBytes }, cleaning)),
    ).toEqual([{ step: 'model-packs', freed: 0, busy: [], needed: [pack] }]);
    expect(await keptKinds(storage.packs)).toEqual(['some-pack@1.0.0 installed']);
  });

  it('passes over a download being written, which installs once written', async () => {
    const { storage, cleaning } = storageWith(147, pinning());
    const bytes = new Uint8Array(12).fill(7);
    const manifest = sampleManifest({
      id: 'arriving-pack',
      files: [
        { path: 'model.onnx', bytes: 12, sha256: createHash('sha256').update(bytes).digest('hex') },
      ],
    });
    let arrived: () => void = () => undefined;
    let halfway: () => void = () => undefined;
    const reachedHalfway = new Promise<void>((resolve) => {
      halfway = resolve;
    });
    const held = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    // Half the file arrives, then the network holds the rest back.
    const source: PackSource = {
      catalogue: () => Promise.resolve(succeed([manifest])),
      read: async (range: FileRange, receive: ReceiveChunk) => {
        const first = await receive(bytes.slice(range.offset, 6));
        if (!first.ok) return first;
        halfway();
        await held;
        return await receive(bytes.slice(6));
      },
    };
    const sha256: Sha256 = () => {
      const hash = createHash('sha256');
      return {
        update: (chunk) => {
          hash.update(chunk);
          return Promise.resolve();
        },
        digest: () => Promise.resolve(new Uint8Array(hash.digest())),
      };
    };
    const installer = new PackInstaller({ store: storage.packs, sha256 });
    const downloading = installer.download(manifest, source);
    await reachedHalfway;

    const plan = expectSuccess(await planCleanup([{ kind: 'pack-downloads' }], cleaning, 0));
    expect(plan.steps).toMatchObject([
      { kind: 'pack-downloads', packs: [{ ref: refOf(manifest) }] },
    ]);
    expect(expectSuccess(await runCleanup(plan, undefined, cleaning))).toEqual([
      { step: 'pack-downloads', freed: 0, busy: [], refused: { kind: 'storing' } },
    ]);

    arrived();
    expect(expectSuccess(await downloading)).toEqual({ kind: 'installed' });
    expect(await keptKinds(storage.packs)).toEqual(['arriving-pack@1.0.0 installed']);
  });
});
