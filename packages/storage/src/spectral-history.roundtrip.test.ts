import { describe, expect, it } from 'vitest';

import {
  MaskEffect,
  derivedSampleCount,
  instantiateProcessor,
  type AssetId,
  type EditOperation,
  type EffectChain,
  type IdGenerator,
  type SpectralEditOperation,
} from '@audiogubbins/domain';
import { expectSuccess, TEST_FILTER } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { HistoryNodeId, StorageTree } from '@audiogubbins/project-format';

import type { ProjectSession } from './project-session.js';
import { addAsset, addChain, applyEdit, contentOf } from './testing/test-commands.js';
import { harness } from './testing/node-services.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';

/**
 * Spectral edits through branching history (ADR-0081, the packet's acceptance
 * criterion that they round-trip through persistence and branch history): each
 * operation applied as a command, the `process` edit's chain entering with it
 * in one change, a branch made from before the heal with a spectral edit of
 * its own, and each branch holding exactly its spectral edits as the session
 * moves between them, undoes and redoes across the branch point, and once the
 * project is closed and opened again.
 */

/** A spectral edit of `operation` over frames 500 to 4,000 of the test asset's 4,800. */
function spectralEdit(
  ids: IdGenerator,
  operation: SpectralEditOperation,
  low: number,
): EditOperation {
  return {
    id: ids.next<'EditOperationId'>(),
    kind: 'process',
    range: { start: derivedSampleCount(500), end: derivedSampleCount(4_000) },
    edit: {
      kind: 'spectral',
      mask: {
        shapes: [
          {
            kind: 'rectangle',
            effect: MaskEffect.Add,
            range: { start: derivedSampleCount(500), end: derivedSampleCount(3_000) },
            band: { low, high: low + 1_000 },
          },
        ],
        feather: { time: 32, frequency: 50 },
      },
      resolution: 256,
      operation,
    },
  };
}

interface Scene {
  readonly tree: StorageTree;
  readonly project: Parameters<typeof openToWrite>[2];
  readonly asset: AssetId;
  readonly chain: EffectChain;
  /** The spectral edits of the first branch, in order: attenuate, isolate, heal, process. */
  readonly main: readonly EditOperation[];
  /** The edit made on the branch from before the heal. */
  readonly branched: EditOperation;
  readonly mainTip: HistoryNodeId;
  readonly branchTip: HistoryNodeId;
  readonly branchPoint: HistoryNodeId;
}

function cursorOf(session: ProjectSession): HistoryNodeId {
  return session.getSnapshot().model.history.cursor;
}

/** The asset's edits and the chains of the session's state now. */
function stateOf(session: ProjectSession, asset: AssetId) {
  const { project } = session.getSnapshot().model.state;
  return {
    edits: project.assets.get(asset)?.edits ?? [],
    chains: [...project.effectChains.keys()],
  };
}

async function branchedSession(seed: number): Promise<{ scene: Scene; session: ProjectSession }> {
  const test = harness(seed);
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  const asset = test.ids.next<'AssetId'>();
  expectSuccess(await session.run(addAsset(asset, contentOf(1))));
  const chain: EffectChain = {
    id: test.ids.next<'EffectChainId'>(),
    slots: [instantiateProcessor(test.ids.next<'ProcessorId'>(), TEST_FILTER)],
  };
  const main = [
    spectralEdit(test.ids, { kind: 'attenuate', gain: 0.25 }, 100),
    spectralEdit(test.ids, { kind: 'isolate', gain: 0 }, 200),
    spectralEdit(test.ids, { kind: 'heal' }, 300),
    spectralEdit(test.ids, { kind: 'process', chain: chain.id }, 400),
  ] as const;
  const [attenuated, isolated, healed, processed] = main;
  const target = { id: asset };
  expectSuccess(await session.run(applyEdit(target, attenuated)));
  expectSuccess(await session.run(applyEdit(target, isolated)));
  const branchPoint = cursorOf(session);
  expectSuccess(await session.run(applyEdit(target, healed)));
  expectSuccess(
    await session.runGroup('Clean up', [addChain(chain), applyEdit(target, processed)]),
  );
  const mainTip = cursorOf(session);

  expectSuccess(await session.goTo(branchPoint));
  const branched = spectralEdit(test.ids, { kind: 'attenuate', gain: 0 }, 2_000);
  expectSuccess(await session.run(applyEdit(target, branched)));
  const branchTip = cursorOf(session);

  return {
    scene: {
      tree,
      project: header.id,
      asset,
      chain,
      main,
      branched,
      mainTip,
      branchTip,
      branchPoint,
    },
    session,
  };
}

/** Checks the session holds each branch's spectral edits exactly, at either tip and across the point. */
async function holdsEachBranch(session: ProjectSession, scene: Scene): Promise<void> {
  const [attenuated, isolated, healed, processed] = scene.main;
  const onBranch = { edits: [attenuated, isolated, scene.branched], chains: [] };
  const onMain = { edits: [attenuated, isolated, healed, processed], chains: [scene.chain.id] };

  expectSuccess(await session.goTo(scene.mainTip));
  expect(stateOf(session, scene.asset)).toEqual(onMain);
  expect(session.getSnapshot().model.state.project.effectChains.get(scene.chain.id)).toEqual(
    scene.chain,
  );
  expectSuccess(await session.goTo(scene.branchTip));
  expect(stateOf(session, scene.asset)).toEqual(onBranch);

  // Undo to the branch point, and redo along the branch visited last.
  expectSuccess(await session.undo());
  expect(cursorOf(session)).toBe(scene.branchPoint);
  expect(stateOf(session, scene.asset)).toEqual({ edits: [attenuated, isolated], chains: [] });
  expectSuccess(await session.redo());
  expect(stateOf(session, scene.asset)).toEqual(onBranch);

  expectSuccess(await session.goTo(scene.mainTip));
  expectSuccess(await session.undo());
  expectSuccess(await session.undo());
  expect(cursorOf(session)).toBe(scene.branchPoint);
  expectSuccess(await session.redo());
  expectSuccess(await session.redo());
  expect(cursorOf(session)).toBe(scene.mainTip);
  expect(stateOf(session, scene.asset)).toEqual(onMain);
}

describe('spectral edits through branching history (ADR-0081)', () => {
  it('keeps each branch’s spectral edits exactly, moving, undoing and redoing across the point', async () => {
    const { scene, session } = await branchedSession(91);

    await holdsEachBranch(session, scene);
    expectSuccess(await session.close());
  });

  it('keeps them so once the project is closed and opened again', async () => {
    const { scene, session } = await branchedSession(92);
    expectSuccess(await session.goTo(scene.branchTip));
    expectSuccess(await session.close());

    const reopened = await openToWrite(harness(93), scene.tree, scene.project);
    expect(cursorOf(reopened)).toBe(scene.branchTip);
    await holdsEachBranch(reopened, scene);
    expectSuccess(await reopened.close());
  });
});
