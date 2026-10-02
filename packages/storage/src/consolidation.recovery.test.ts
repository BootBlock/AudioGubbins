import { describe, expect, it } from 'vitest';

import type { AssetId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { ExternalFile } from '@audiogubbins/media-store';
import { MemoryStorageTree, memorySource, observeFile } from '@audiogubbins/media-store/testing';
import { SourceChangePolicy, type MediaSource } from '@audiogubbins/project-format';

import { consolidate, type ConsolidationServices } from './consolidation.js';
import { openProject } from './project-opening.js';
import { sweepCrashes } from './testing/crash-sweep.js';
import { storageOf } from './testing/memory-ports.js';
import { harness, nodeDigest } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setMedia, setName } from './testing/test-commands.js';

/**
 * A crash at any moment of consolidating a project (REQ-STOR-099,
 * REQ-EXEC-180): afterwards each linked asset is still linked, or is managed
 * media the store holds whole, never a reference to media the store lost; and
 * the project goes on working.
 */

const AUDIO = new Uint8Array(Array.from({ length: 70_000 }, (_, index) => (index * 7) & 0xff));

const LINKED: ExternalFile = {
  source: memorySource(AUDIO),
  fileName: 'footstep.wav',
  mediaType: 'audio/wav',
  lastModified: 1_790_000_000_000,
  handleKey: 'handle-1',
};

function servicesOver(tree: MemoryStorageTree, seed: number): ConsolidationServices {
  return {
    store: storageOf(harness(seed), tree).store,
    digest: nodeDigest,
    yieldToHost: () => Promise.resolve(),
    locate: () => Promise.resolve({ kind: 'found', file: LINKED }),
    setMedia: (id: AssetId, managed: MediaSource) => setMedia(id, managed),
  };
}

describe('a crash while a project is consolidated (REQ-STOR-099)', () => {
  it('leaves each asset linked or held whole by the store, at every operation', async () => {
    const test = harness(91);
    const from = new MemoryStorageTree();
    const header = await madeProject(test, from);
    const session = await openToWrite(test, from, header.id);
    const identity = expectSuccess(await observeFile(LINKED, nodeDigest));
    const asset = test.ids.next<'AssetId'>();
    expectSuccess(
      await session.run(
        setMedia(asset, { kind: 'external', identity, policy: SourceChangePolicy.Prompt }),
      ),
    );
    expectSuccess(await session.close());

    let managed = 0;
    await sweepCrashes({
      from,
      run: async (tree) => {
        const consolidating = await openToWrite(harness(92), tree, header.id);
        const outcomes = expectSuccess(await consolidate(consolidating, servicesOver(tree, 92)));
        expect(outcomes).toMatchObject([{ asset, kind: 'consolidated' }]);
        expectSuccess(await consolidating.close());
      },
      check: async (found) => {
        const store = storageOf(harness(93), found).store;
        expectSuccess(await store.recoverIncomplete());
        const opened = expectSuccess(
          await openProject({ project: header.id, access: 'write' }, harness(94).services(found)),
        );
        if (opened.kind !== 'writable') throw new Error('Expected a writable project.');
        const media = opened.session.getSnapshot().model.state.sources.get(asset)?.media;
        if (media?.kind === 'managed') {
          managed += 1;
          expectSuccess(await store.verify(media.contentId));
        } else {
          expect(media?.kind).toBe('external');
        }
        expectSuccess(await opened.session.run(setName('After the crash')));
        expectSuccess(await opened.session.close());
      },
    });
    expect(managed).toBeGreaterThan(0);
  }, 120_000);
});
