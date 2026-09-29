import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import {
  SourceChangePolicy,
  compareCodeUnits,
  contentIdFrom,
  type ContentId,
  type ProjectState,
} from '@audiogubbins/project-format';
import { seededRandom } from '@audiogubbins/project-format/testing';
import { sampleProject } from '@audiogubbins/test-fixtures';

import { collect, contentReferencedBy, planCollection } from './collection.js';
import { MediaObjectStore } from './object-store.js';
import {
  MemoryStorageTree,
  countedSharing,
  countingTokens,
  generatedSource,
} from './testing/index.js';
import { nodeDigest } from './testing/node-digest.js';

function storeOver(tree = new MemoryStorageTree()): MediaObjectStore {
  return new MediaObjectStore({
    tree,
    root: 'media',
    digest: nodeDigest,
    nextToken: countingTokens(),
    sharing: countedSharing(),
  });
}

/** Stores objects of the given seeds, releasing each, as a recorded import would be. */
async function holding(store: MediaObjectStore, seeds: readonly number[]): Promise<ContentId[]> {
  const ids: ContentId[] = [];
  for (const seed of seeds) {
    const { contentId } = expectSuccess(await store.put(generatedSource(100 + seed, seed)));
    store.release(contentId);
    ids.push(contentId);
  }
  return ids;
}

async function listed(store: MediaObjectStore): Promise<readonly ContentId[]> {
  const ids: ContentId[] = [];
  for await (const { contentId } of store.list()) ids.push(contentId);
  return ids;
}

async function* lazily(ids: readonly ContentId[]): AsyncGenerator<ContentId> {
  for (const id of ids) {
    await Promise.resolve();
    yield id;
  }
}

const byId = (one: ContentId, other: ContentId): number => compareCodeUnits(one, other);

/** The identifier at an index, which the test stored. */
function nth(ids: readonly ContentId[], index: number): ContentId {
  const id = ids[index];
  if (id === undefined) throw new Error(`The test stored no object at ${String(index)}.`);
  return id;
}

const idOf = (digit: string): ContentId => expectSuccess(contentIdFrom(`c1-${digit.repeat(64)}`));

describe('planning a collection', () => {
  it('lists what no root reaches, sorted by identifier, with the bytes it would free', async () => {
    const store = storeOver();
    const ids = await holding(store, [1, 2, 3, 4, 5, 6]);

    const plan = expectSuccess(await planCollection(store, ids.slice(0, 2)));

    expect(plan.unreachable.map(({ contentId }) => contentId)).toEqual(ids.slice(2).toSorted(byId));
    expect(plan.reclaimableBytes).toBe(
      plan.unreachable.reduce((sum, { byteLength }) => sum + byteLength, 0),
    );
    expect(await listed(store)).toHaveLength(6);
  });

  it('plans alike whatever order and form the roots arrive in', async () => {
    const store = storeOver();
    const ids = await holding(store, [7, 8, 9, 10, 11]);
    const roots = ids.slice(0, 2);

    const one = expectSuccess(await planCollection(store, roots));
    const other = expectSuccess(await planCollection(store, lazily(roots.toReversed())));

    expect(other).toEqual(one);
  });

  it('keeps out what an import still holds', async () => {
    const store = storeOver();
    const kept = nth(await holding(store, [12]), 0);
    const held = expectSuccess(await store.put(generatedSource(50, 13))).contentId;

    const plan = expectSuccess(await planCollection(store, []));

    expect(plan.unreachable.map(({ contentId }) => contentId)).toEqual([kept]);
    expect(plan.unreachable.map(({ contentId }) => contentId)).not.toContain(held);
  });
});

describe('collecting', () => {
  it('refuses a confirmation of another plan, removing nothing', async () => {
    const store = storeOver();
    await holding(store, [1, 2]);
    const plan = expectSuccess(await planCollection(store, []));

    const refused = await collect(store, plan, { reclaimableBytes: plan.reclaimableBytes + 1 }, []);

    expect(expectFailureCode(refused)).toBe('media.purge-unconfirmed');
    expect(await listed(store)).toHaveLength(2);
  });

  it('keeps a planned object that became reachable, or was imported again, since the plan', async () => {
    const store = storeOver();
    const ids = await holding(store, [1, 2, 3]);
    const [again, reached, gone] = [nth(ids, 0), nth(ids, 1), nth(ids, 2)];
    const plan = expectSuccess(await planCollection(store, []));
    expectSuccess(await store.put(generatedSource(101, 1)));

    const report = expectSuccess(
      await collect(store, plan, { reclaimableBytes: plan.reclaimableBytes }, [reached]),
    );

    expect(report.removed.map(({ contentId }) => contentId)).toEqual([gone]);
    expect(report.kept.toSorted(byId)).toEqual([again, reached].toSorted(byId));
    expect(report.reclaimedBytes).toBe(103);
    expect((await listed(store)).toSorted(byId)).toEqual([again, reached].toSorted(byId));
  });

  it('never removes a rooted or held object, and removes exactly the rest of the plan (property)', async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const random = seededRandom(seed);
      const store = storeOver();
      const count = 1 + random.below(12);
      const ids = await holding(
        store,
        Array.from({ length: count }, (_, index) => seed * 100 + index),
      );
      const roots = ids.filter(() => random.chance(0.4));
      const plan = expectSuccess(await planCollection(store, roots));
      const planned = plan.unreachable.map(({ contentId }) => contentId);
      const fresh = [...roots, ...planned.filter(() => random.chance(0.3))];
      const held = planned.filter(() => random.chance(0.2));
      for (const id of held) {
        const index = ids.indexOf(id);
        expectSuccess(
          await store.put(generatedSource(100 + seed * 100 + index, seed * 100 + index)),
        );
      }

      const report = expectSuccess(
        await collect(store, plan, { reclaimableBytes: plan.reclaimableBytes }, fresh),
      );

      const removed = report.removed.map(({ contentId }) => contentId);
      const protectedIds = new Set([...fresh, ...held]);
      const context = `seed ${String(seed)}`;
      expect(planned, context).toEqual(planned.toSorted(byId));
      expect(
        planned.filter((id) => roots.includes(id)),
        context,
      ).toEqual([]);
      expect(removed, context).toEqual(planned.filter((id) => !protectedIds.has(id)));
      expect((await listed(store)).toSorted(byId), context).toEqual(
        ids.filter((id) => !removed.includes(id)).toSorted(byId),
      );
      for (const id of protectedIds) {
        expect(expectSuccess(await store.verify(id)).contentId, context).toBe(id);
      }
    }
  });
});

describe('what a project state refers to', () => {
  it('is each managed source and each retained copy, and never an external file itself', () => {
    const { project, assets } = sampleProject();
    const [managed, retained, external] = [idOf('1'), idOf('2'), idOf('3')];
    const identity = {
      byteLength: 1,
      lastModified: 0,
      mediaType: 'audio/wav',
      signature: '',
      fastFingerprint: 'a'.repeat(64),
      contentId: external,
    };
    const state: ProjectState = {
      project,
      sources: new Map([
        [
          assets.footstep.id,
          { media: { kind: 'managed', contentId: managed, byteLength: 1, mediaType: 'audio/wav' } },
        ],
        [
          assets.ambience.id,
          {
            media: {
              kind: 'external',
              identity,
              policy: SourceChangePolicy.Freeze,
              retainedCopy: retained,
            },
          },
        ],
      ]),
    };

    expect([...contentReferencedBy(state)]).toEqual([managed, retained]);
  });
});
