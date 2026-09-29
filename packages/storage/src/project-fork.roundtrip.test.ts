import { describe, expect, it } from 'vitest';

import { unsafeBrandId, type ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  canonicalJson,
  writeProjectDocument,
  type ContentId,
  type HistoryNodeId,
  type ProjectState,
} from '@audiogubbins/project-format';

import { forkProject, type ForkPoint } from './project-fork.js';
import type { ProjectSession } from './project-session.js';
import { summaryOf } from './testing/model-summary.js';
import { storageOf, storedMedia, type TestStorage } from './testing/memory-ports.js';
import { randomStep } from './testing/random-sessions.js';
import { seededRandom } from './testing/seeded-random.js';
import { harness, madeProject, openToWrite, type Harness } from './testing/storage-harness.js';

/**
 * Forks (REQ-STOR-199): a fork from any node or snapshot is a project of its
 * own, beginning at the state there, with its origin recorded and an empty
 * export log; the source is not changed by a byte; media is shared, not copied;
 * and the fork survives a reload.
 */

const SEEDS = Array.from({ length: 10 }, (_, index) => index + 1);

/** A state's document with its identity and name set aside, to compare what it holds. */
function held(state: ProjectState): string {
  return canonicalJson(
    writeProjectDocument({
      ...state,
      project: {
        ...state.project,
        id: unsafeBrandId(state.project.id.replace(/./gu, '0')),
        displayName: '',
      },
    }),
  );
}

function sourceFiles(tree: MemoryStorageTree, project: ProjectId) {
  return [...tree.snapshot()].filter(([path]) => path.startsWith(`projects/${project}/`));
}

async function objects(storage: TestStorage): Promise<readonly ContentId[]> {
  const found: ContentId[] = [];
  for await (const { contentId } of storage.store.list()) found.push(contentId);
  return found;
}

async function randomSource(test: Harness, storage: TestStorage, seed: number) {
  const media: ContentId[] = [];
  for (let index = 0; index < 5; index += 1)
    media.push(await storedMedia(storage.store, seed * 7 + index));
  const header = await madeProject(test, storage.tree);
  const session = await openToWrite(test, storage.tree, header.id, {
    cadence: { checkpointAfter: 4, keepStateEvery: 3 },
  });
  const random = seededRandom(seed);
  const run = {
    session,
    random,
    test,
    media: (index: number) => media[index % 5] ?? media[0] ?? missing(),
  };
  for (let step = 0; step < 30; step += 1) await randomStep(run, step);
  expectSuccess(await session.createSnapshot({ name: 'Worth keeping' }));
  for (let step = 30; step < 40; step += 1) await randomStep(run, step);
  return { project: header.id, session, random };
}

function missing(): never {
  throw new Error('No media.');
}

async function stateAtNode(session: ProjectSession, node: HistoryNodeId): Promise<ProjectState> {
  expectSuccess(await session.goTo(node));
  return session.getSnapshot().model.state;
}

describe('forks (REQ-STOR-199)', () => {
  it.each(SEEDS)(
    'seed %i: a fork begins where it was taken, and the source is untouched',
    async (seed) => {
      const test = harness(seed);
      const tree = new MemoryStorageTree();
      const storage = storageOf(test, tree);
      const { project, session, random } = await randomSource(test, storage, seed);
      const { history } = session.getSnapshot().model;
      const nodes = [...history.nodes.keys()];
      const snapshots = [...history.snapshots.values()];
      const snapshot = random.pick(snapshots);
      const from: ForkPoint =
        seed % 2 === 0 && snapshot !== undefined
          ? { kind: 'snapshot', snapshot: snapshot.id }
          : { kind: 'node', node: random.pick(nodes) ?? history.root };
      const node = from.kind === 'node' ? from.node : (snapshot?.node ?? history.root);

      const before = sourceFiles(tree, project);
      const media = await objects(storage);
      const fork = expectSuccess(
        await forkProject(
          { source: project, from, name: 'The other take' },
          test.services(storage.tree),
        ),
      );
      expect(sourceFiles(tree, project)).toEqual(before);
      expect(await objects(storage)).toEqual(media);
      expect(fork.id).not.toBe(project);
      expect(fork.name).toBe('The other take');

      const forked = await openToWrite(test, tree, fork.id);
      const { model } = forked.getSnapshot();
      expect(model.exports).toEqual([]);
      expect(model.history.nodes.size).toBe(1);
      expect(model.history.nodes.get(model.history.root)).toMatchObject({
        origin: { kind: 'fork', project, node },
      });
      expect(model.state.project.id).toBe(fork.id);
      expect(held(model.state)).toBe(held(await stateAtNode(session, node)));

      // The fork survives a reload, and changes of its own leave the source alone.
      const summary = summaryOf(model);
      expectSuccess(await forked.close());
      const reopened = await openToWrite(test, tree, fork.id);
      expect(summaryOf(reopened.getSnapshot().model)).toBe(summary);
      expectSuccess(await session.close());
      const closedSource = sourceFiles(tree, project);
      await randomStep({ session: reopened, random, test, media: () => media[0] ?? missing() }, 99);
      expectSuccess(await reopened.close());
      expect(sourceFiles(tree, project)).toEqual(closedSource);
    },
  );

  it('refuses a fork from a node or snapshot the source does not have, or with no name', async () => {
    const test = harness(50);
    const storage = storageOf(test, new MemoryStorageTree());
    const { project } = await randomSource(test, storage, 50);
    const node = test.ids.next<'HistoryNodeId'>();
    const snapshot = test.ids.next<'SnapshotId'>();
    for (const from of [
      { kind: 'node', node },
      { kind: 'snapshot', snapshot },
    ] as const) {
      const forked = await forkProject(
        { source: project, from, name: 'Fork' },
        test.services(storage.tree),
      );
      expect(forked.ok).toBe(false);
    }
    const root = { kind: 'node', node: node } as const;
    expect(
      (await forkProject({ source: project, from: root, name: '  ' }, test.services(storage.tree)))
        .ok,
    ).toBe(false);
  });
});
