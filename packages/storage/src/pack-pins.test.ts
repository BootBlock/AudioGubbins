import { describe, expect, it } from 'vitest';

import {
  SummingLaw,
  type EffectChain,
  type IdGenerator,
  type ModelIdentity,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { PackRef } from '@audiogubbins/model-packs';
import type { BackupPolicy, StorageTree } from '@audiogubbins/project-format';

import { BackupScheduler } from './backup-scheduler.js';
import { projectPackPins } from './pack-pins.js';
import { ProjectPaths } from './storage-layout.js';
import { storageOf } from './testing/memory-ports.js';
import { addChain, setName } from './testing/test-commands.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * Which model pack versions the projects need (REQ-AUDIO-139): every version
 * a processor instance names, wherever a restore or an undo could bring it
 * back from, and none where a project cannot be read, since then the set
 * cannot be told and every pack is kept.
 */

const EVERY_CHANGE: BackupPolicy = {
  kind: 'automatic',
  trigger: { everyChanges: 1 },
  retention: { count: 4 },
};

/** Past the number of arguments a call takes in any engine this runs in. */
const LONGER_THAN_ARGUMENTS = 1_000_000;

function modelOf(pack: string, version = '1.0.0'): ModelIdentity {
  return { pack, version, modelHash: 'a'.repeat(64), runtimeHash: 'b'.repeat(64) };
}

/** A chain whose one processor runs `model`, in a group, as a rack can nest it. */
function chainRunning(ids: IdGenerator, model: ModelIdentity): EffectChain {
  const processor: ProcessorInstance = {
    kind: 'processor',
    id: ids.next<'ProcessorId'>(),
    typeKey: model.pack,
    enabled: true,
    soloed: false,
    mix: 1,
    version: { implementation: 1, parameters: 1, resampler: 1, model },
    values: new Map(),
  };
  return {
    id: ids.next<'EffectChainId'>(),
    slots: [
      {
        kind: 'group',
        id: ids.next<'ProcessorGroupId'>(),
        enabled: true,
        soloed: false,
        mix: 1,
        summing: SummingLaw.Sum,
        branches: [{ slots: [processor] }],
      },
    ],
  };
}

async function pinsOf(tree: StorageTree): Promise<readonly string[]> {
  const pins = expectSuccess(await projectPackPins(tree, nodeDigest)());
  return pins.map((ref: PackRef) => `${ref.id}@${ref.version}`).sort();
}

describe('the model packs the projects need', () => {
  it('needs none where no processor names a model', async () => {
    const test = harness(61);
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(setName('Plain')));
    expect(await pinsOf(tree)).toEqual([]);
  });

  it('needs a version the current state names', async () => {
    const test = harness(62);
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(addChain(chainRunning(test.ids, modelOf('deepfilternet-3')))));
    expectSuccess(await session.close());
    expect(await pinsOf(tree)).toEqual(['deepfilternet-3@1.0.0']);
  });

  it('needs a version only an undone change in the history names, before and after a checkpoint', async () => {
    const test = harness(63);
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(addChain(chainRunning(test.ids, modelOf('spleeter-2-stems')))));
    expectSuccess(await session.undo());
    expect(session.getSnapshot().model.state.project.effectChains.size).toBe(0);

    // Only the journal's record of the change names it.
    expect(await pinsOf(tree)).toEqual(['spleeter-2-stems@1.0.0']);
    expectSuccess(await session.close());
    // Now only the checkpoint's history, whose change redo would replay.
    expect(await pinsOf(tree)).toEqual(['spleeter-2-stems@1.0.0']);
  });

  it('needs a version only a backup generation names, once its project is gone', async () => {
    const test = harness(64);
    const storage = storageOf(test, new MemoryStorageTree());
    const header = await madeProject(test, storage.tree);
    const session = await openToWrite(test, storage.tree, header.id);
    expectSuccess(await session.setBackupPolicy(EVERY_CHANGE));
    expectSuccess(
      await session.run(addChain(chainRunning(test.ids, modelOf('mossformer2-se-48k', '2.0.0')))),
    );
    const made = expectSuccess(
      await new BackupScheduler(header.id, storage.exporting).tick(
        test.clock.now(),
        session.getSnapshot().model,
      ),
    );
    expect(made.kind).toBe('made');
    const snapshot = (storage.tree as MemoryStorageTree).snapshot();
    const onlyBackups = new MemoryStorageTree(
      {},
      new Map([...snapshot].filter(([path]) => !path.startsWith('projects/'))),
    );

    expect(await pinsOf(onlyBackups)).toEqual(['mossformer2-se-48k@2.0.0']);
  });

  it("finds a version beside a list longer than the engine takes as one call's arguments", async () => {
    const test = harness(66);
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(setName('Long')));
    // A record of the journal that holds a list as long as a record may, with
    // a model named after it, as a change carrying a long value would.
    const record = `${new ProjectPaths(header.id).journal}/long.json`;
    const body = { list: new Array<number>(LONGER_THAN_ARGUMENTS).fill(0), model: modelOf('ten') };
    await tree.writeFile(record, new TextEncoder().encode(JSON.stringify(body)));

    expect(await pinsOf(tree)).toEqual(['ten@1.0.0']);
  });

  it('cannot be told, keeping everything with the reason, where a project cannot be read', async () => {
    const test = harness(65);
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(addChain(chainRunning(test.ids, modelOf('deepfilternet-3')))));
    const journal = new ProjectPaths(header.id).journal;
    const [record] = tree.paths().filter((path) => path.startsWith(`${journal}/`));
    if (record === undefined) throw new Error('The change has a journal record.');
    await tree.writeFile(record, new Uint8Array([123, 34, 116]));

    const pins = await projectPackPins(tree, nodeDigest)();

    expect(pins.ok ? [] : pins.failures.map((one) => one.code)).toEqual([
      'storage.pack-pins-unread',
    ]);
    expect(pins.ok ? undefined : pins.failures[0].details).toEqual({ path: record });
  });
});
