import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  canonicalJson,
  writeMediaSource,
  type ContentId,
  type MediaSource,
} from '@audiogubbins/project-format';

import { contentIdsIn } from './content-references.js';
import { retainedMedia } from './media-roots.js';
import { exportBundle } from './project-transfer.js';
import { memorySink, storageOf, storedMedia } from './testing/memory-ports.js';
import { harness, nodeDigest } from './testing/node-services.js';
import type { SessionCadence } from './session-contracts.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { contentOf, setMedia } from './testing/test-commands.js';

/**
 * Media a change names inside a nested value it carries as JSON text is found
 * (REQ-STOR-099, REQ-STOR-102): a project command takes an asset with its
 * source, or where an asset's bytes are kept, as one string of JSON, and the
 * media named there is media undo or redo restores. Missed, a whole history
 * keeping a state that refers to it could not be taken out, and a purge would
 * remove what redo needs.
 */

function managed(contentId: ContentId): MediaSource {
  return { kind: 'managed', contentId, byteLength: 3_000, mediaType: 'audio/wav' };
}

/** A closed project whose one change, undone, had kept its new asset as `media`. */
async function undoneMedia(seed: number, cadence: SessionCadence) {
  const test = harness(seed);
  const tree = new MemoryStorageTree();
  const storage = storageOf(test, tree);
  const media = await storedMedia(storage.store, seed);
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id, { cadence });
  expectSuccess(await session.run(setMedia(test.ids.next<'AssetId'>(), managed(media))));
  expectSuccess(await session.undo());
  expectSuccess(await session.close());
  return { storage, tree, project: header.id, media };
}

describe('the media a change names inside a nested value (REQ-STOR-102)', () => {
  it('is found in an argument that carries the value as JSON text', () => {
    const node = {
      forward: [
        {
          commandId: 'test.set-media',
          arguments: { asset: 'a', media: canonicalJson(writeMediaSource(managed(contentOf(7)))) },
        },
      ],
    };

    expect([...contentIdsIn(node)]).toEqual([contentOf(7)]);
  });

  it('travels with a whole history whose kept state refers to it', async () => {
    const { storage, project } = await undoneMedia(161, { checkpointAfter: 1, keepStateEvery: 1 });
    const sink = memorySink();
    const scope = { kind: 'whole-history' } as const;

    const attempt = await exportBundle(
      project,
      sink,
      { scope, includeCaches: false },
      storage.exporting,
    );

    expectSuccess(expectSuccess(attempt).written);
    expect(sink.ending).toBe('closed');
  });

  it('is kept from a purge while redo can bring it back', async () => {
    const { tree, media } = await undoneMedia(162, { checkpointAfter: 100, keepStateEvery: 100 });
    const roots = new Set<ContentId>();
    for await (const root of retainedMedia(tree, nodeDigest, () => undefined)) roots.add(root);

    expect(roots).toContain(media);
  });
});
