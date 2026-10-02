import { describe, expect, it, vi } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import type { History } from '@audiogubbins/history';
import { MemoryStorageTree, memorySource } from '@audiogubbins/media-store/testing';
import {
  TreeFailure,
  TreeFailureKind,
  type BackupPolicy,
  type ByteSink,
} from '@audiogubbins/project-format';
import { openProject, type BackupTick, type ExternalBackupTarget } from '@audiogubbins/storage';
import { memorySink, type MemorySink } from '@audiogubbins/storage/testing';

import { SLICE_ENTRIES } from '../host/project-updates.js';
import { readPortMessage } from '../protocol/port-messages.js';
import { openingStream, type ProjectHandle } from '../protocol/project-operations.js';
import { memoryStorage } from '../testing/memory-storage.js';
import type { PortPair } from '../testing/port-pair.js';
import {
  madeProject,
  opened,
  projectScene,
  rename,
  storedModel,
  writable,
  type ProjectScene,
} from '../testing/project-scene.js';

/** A generation after every two changes, copied to the backups folder too. */
const EVERY_TWO: BackupPolicy = {
  kind: 'automatic',
  trigger: { everyChanges: 2 },
  retention: { count: 10 },
  external: true,
};

/** A backups folder in memory, keeping each copy written into it by name. */
function backupsFolder(): ExternalBackupTarget & { readonly copies: Map<string, MemorySink> } {
  const copies = new Map<string, MemorySink>();
  return {
    copies,
    create: ({ name, number }) => {
      const sink = memorySink();
      copies.set(`${name} ${String(number)}`, sink);
      return Promise.resolve(sink);
    },
  };
}

/** The generation a tick made, or throws naming what it did instead. */
function madeBy(tick: BackupTick) {
  if (tick.kind !== 'made') throw new Error(`The tick was ${tick.kind}.`);
  return tick;
}

/** Waits for a later task, by which a message posted now has arrived. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** How many slices of history the worker sent as it began to hold `handle`. */
function slicesSent(pair: PortPair, handle: ProjectHandle): number {
  const stream = openingStream(handle);
  return pair.toPage.filter((data) => {
    const read = readPortMessage(data);
    return read.ok && read.value.type === 'event' && read.value.stream === stream;
  }).length;
}

/** A history's entries, for comparing two made apart. */
function entriesOf(history: History) {
  return {
    root: history.root,
    cursor: history.cursor,
    nodes: new Map(history.nodes.entries()),
    children: new Map(history.children.entries()),
  };
}

/** A tree in memory whose reads and writes stop once their signal aborts, as a platform's do. */
class SignalledTree extends MemoryStorageTree {
  override async readFile(
    path: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer> | undefined> {
    signal?.throwIfAborted();
    return await super.readFile(path);
  }

  override async writeFile(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await super.writeFile(path, bytes);
  }
}

/**
 * Turns the worker's storage takes once started, each letting the messages
 * waiting be read as the worker's host does, counted since last asked.
 */
function takenTurns() {
  let taking = false;
  let count = 0;
  let turned: () => void = () => undefined;
  return {
    take: async (): Promise<void> => {
      if (!taking) return;
      count += 1;
      turned();
      await nextTask();
    },
    start: () => {
      taking = true;
    },
    since: () => {
      const counted = count;
      count = 0;
      return counted;
    },
    next: () =>
      new Promise<void>((resolve) => {
        turned = resolve;
      }),
  };
}

/**
 * Waits for the worker to answer a call as cancelled, checks it takes no turn
 * after, and gives the turns it took since last asked.
 */
async function stoppedTurns(
  { storage }: ProjectScene,
  turns: ReturnType<typeof takenTurns>,
): Promise<number> {
  await vi.waitFor(() => {
    expect(storage.pair.toPage).toContainEqual(
      expect.objectContaining({ type: 'answer', outcome: { kind: 'cancelled' } }),
    );
  });
  const stopped = turns.since();
  await nextTask();
  await nextTask();
  expect(turns.since()).toBe(0);
  return stopped;
}

/** A project whose policy makes a generation every two changes, renamed twice. */
async function due(options?: Parameters<typeof projectScene>[0]): Promise<ProjectScene> {
  const scene = await projectScene(options);
  expectSuccess(await scene.session.setBackupPolicy(EVERY_TWO));
  expectSuccess(await scene.session.run(rename('Tide')));
  expectSuccess(await scene.session.run(rename('Ebb')));
  return scene;
}

/**
 * How long a test that makes a long history may take: over a thousand changes
 * take about a second alone, which the whole suite's load can stretch past the
 * default.
 */
const LONG_HISTORY_TIMEOUT = 30_000;

describe('backup generations, made and restored in the storage worker', () => {
  it('makes one as the policy says on a tick, copied through the folder the page lent', async () => {
    const { storage, session } = await due();
    const folder = backupsFolder();
    const elsewhere = backupsFolder();

    const [ticked, meanwhile] = await Promise.all([
      storage.client.backups.tick(session, folder),
      storage.client.backups.tick(session, elsewhere),
    ]);

    const made = madeBy(expectSuccess(ticked));
    expect(expectSuccess(meanwhile)).toEqual({ kind: 'busy' });
    expect(made.external).toEqual({ kind: 'written' });
    expect([...folder.copies.keys()]).toEqual([`Ebb ${String(made.generation.number)}`]);
    expect([...folder.copies.values()].map((sink) => sink.ending)).toEqual(['closed']);
    expect(elsewhere.copies.size).toBe(0);
    expect(expectSuccess(await storage.client.backups.tick(session, folder))).toEqual({
      kind: 'not-due',
    });
    expect(storage.lentPorts()).toBe(0);
  });

  it('makes a protected one now when asked, its copy failing with no folder lent', async () => {
    const { storage, session, project } = await due();

    const made = madeBy(expectSuccess(await storage.client.backups.backUpNow(session)));

    expect(made.generation).toMatchObject({ reason: 'manual', protected: true });
    expect(made.external).toMatchObject({
      kind: 'failed',
      failure: { code: 'storage.unavailable' },
    });
    const listed = expectSuccess(await storage.client.backups.list(project));
    expect(listed.generations).toEqual([made.generation]);
  });

  it("reports the refusal the page's folder met beside the generation it made", async () => {
    const { storage, session, project } = await due();
    const kept = memorySink();
    const full: ByteSink = {
      write: () => Promise.reject(new TreeFailure(TreeFailureKind.Quota, 'The disc is full.')),
      close: () => kept.close(),
      abort: () => kept.abort(),
    };
    const folder: ExternalBackupTarget = { create: () => Promise.resolve(full) };

    const made = madeBy(expectSuccess(await storage.client.backups.tick(session, folder)));

    expect(made.external).toMatchObject({ kind: 'failed', failure: { code: 'storage.full' } });
    expect(kept.ending).toBe('aborted');
    const listed = expectSuccess(await storage.client.backups.list(project));
    expect(listed.generations).toEqual([made.generation]);
    expect(storage.lentPorts()).toBe(0);
  });

  it("stops the worker's backup where it next takes a turn once the page gives up", async () => {
    const turns = takenTurns();
    const scene = await due({ tree: new SignalledTree(), yieldToHost: turns.take });
    const { storage, session, project } = scene;
    turns.start();
    const whole = madeBy(
      expectSuccess(await storage.client.backups.backUpNow(session, backupsFolder())),
    );
    const wholeTurns = turns.since();

    const controller = new AbortController();
    const reason = new Error('Closed.');
    const backing = storage.client.backups.backUpNow(session, backupsFolder(), controller.signal);
    await turns.next();
    controller.abort(reason);

    await expect(backing).rejects.toBe(reason);
    const stopped = await stoppedTurns(scene, turns);
    expect(stopped).toBeLessThan(wholeTurns / 2);
    expect(storage.lentPorts()).toBe(0);
    const listed = expectSuccess(await storage.client.backups.list(project));
    expect(listed.generations).toEqual([whole.generation]);
  });

  it("stops the worker's restore in place before it replaces the project", async () => {
    const turns = takenTurns();
    const scene = await due({ tree: new SignalledTree(), yieldToHost: turns.take });
    const { storage, session, project } = scene;
    const made = madeBy(expectSuccess(await storage.client.backups.backUpNow(session)));
    expectSuccess(await session.run(rename('Flood')));
    turns.start();

    const controller = new AbortController();
    const reason = new Error('Closed.');
    const target = { as: 'replace-current', session } as const;
    const restoring = storage.client.backups.restore(
      made.generation.number,
      target,
      controller.signal,
    );
    // The page closes its session first: give up once the worker restores.
    const asked = expect.objectContaining({ operation: 'backups.restoreInPlace' });
    await vi.waitFor(() => {
      expect(storage.pair.toWorker).toContainEqual(asked);
    });
    await turns.next();
    controller.abort(reason);

    await expect(restoring).rejects.toBe(reason);
    await stoppedTurns(scene, turns);
    expect(await storage.coordinator.ownerOf(project)).toBeUndefined();
    expect((await storedModel(storage, project)).state.project.displayName).toBe('Flood');
  });

  it('protects, lists and removes generations', async () => {
    const { storage, session, project } = await due();
    const first = madeBy(expectSuccess(await storage.client.backups.tick(session))).generation;
    const second = madeBy(
      expectSuccess(await storage.client.backups.backUpNow(session)),
    ).generation;

    expectSuccess(await storage.client.backups.protect(project, first.number, true));
    expectSuccess(await storage.client.backups.protect(project, second.number, false));

    const protectedNow = expectSuccess(await storage.client.backups.list(project)).generations;
    expect(protectedNow.map((one) => [one.number, one.protected])).toEqual([
      [second.number, false],
      [first.number, true],
    ]);
    expectSuccess(await storage.client.backups.remove(project, [first.number]));
    const left = expectSuccess(await storage.client.backups.list(project)).generations;
    expect(left.map(({ number }) => number)).toEqual([second.number]);
  });

  it('restores one as a new project, leaving the project as it is', async () => {
    const { storage, session, project } = await due();
    const made = madeBy(expectSuccess(await storage.client.backups.backUpNow(session)));
    expectSuccess(await session.run(rename('Flood')));

    const restored = expectSuccess(
      await storage.client.backups.restore(made.generation.number, { as: 'new-project', project }),
    );

    if (restored.kind !== 'new-project') throw new Error(`The restore was ${restored.kind}.`);
    expect(restored.header.id).not.toBe(project);
    expect((await storedModel(storage, restored.header.id)).state.project.displayName).toBe('Ebb');
    expect(session.getSnapshot().model.state.project.displayName).toBe('Flood');
  });

  it('restores one in place, handing the page a new session, the old one refusing', async () => {
    const { storage, session, project } = await due();
    const made = madeBy(expectSuccess(await storage.client.backups.backUpNow(session)));
    expectSuccess(await session.run(rename('Flood')));

    const restored = expectSuccess(
      await storage.client.backups.restore(made.generation.number, {
        as: 'replace-current',
        session,
      }),
    );

    if (restored.kind !== 'replaced') throw new Error(`The restore was ${restored.kind}.`);
    const { session: replaced, previous } = restored;
    expect(replaced).not.toBe(session);
    expect(replaced.project).toBe(project);
    expect(replaced.getSnapshot().model.state.project.displayName).toBe('Ebb');
    expect(previous.protected).toBe(true);
    expect(session.getSnapshot().access).toEqual({ kind: 'closed' });
    await expect(session.run(rename('Stale'))).rejects.toThrow(/No project is open to write/);

    expectSuccess(await replaced.run(rename('Neap')));
    expect(replaced.getSnapshot().model.state.project.displayName).toBe('Neap');
    expectSuccess(await replaced.checkpoint());
    expect((await storedModel(storage, project)).state.project.displayName).toBe('Neap');
    const fromPrevious = await storage.client.backups.restore(previous.number, {
      as: 'new-project',
      project,
    });
    const header = expectSuccess(fromPrevious);
    if (header.kind !== 'new-project') throw new Error(`The restore was ${header.kind}.`);
    expect((await storedModel(storage, header.header.id)).state.project.displayName).toBe('Flood');
  });

  it('takes one out as a bundle, which another page brings in as it was', async () => {
    const { storage, session, project } = await due();
    const made = madeBy(expectSuccess(await storage.client.backups.backUpNow(session)));
    expectSuccess(await session.run(rename('Flood')));
    const sink = memorySink();

    const attempt = expectSuccess(
      await storage.client.transfers.exportBackup(project, made.generation.number, sink, {
        scope: { kind: 'whole-history' },
        includeCaches: false,
      }),
    );

    expectSuccess(attempt.written);
    const other = memoryStorage({ tab: { name: 'other', seed: 71 } });
    const bundle = { kind: 'source', source: memorySource(sink.bytes()) } as const;
    const { header } = expectSuccess(await other.client.transfers.importBundle(bundle, 'original'));
    expect((await storedModel(other, header.id)).state.project.displayName).toBe('Ebb');
  });
});

describe('a long history restored in place', { timeout: LONG_HISTORY_TIMEOUT }, () => {
  it("is sent in slices, the page's copy matching storage", async () => {
    const storage = memoryStorage();
    const project = await madeProject(storage);
    const changes = SLICE_ENTRIES + 100;
    // Made in another window of the profile, so the long history costs no
    // update sent to the page for each change.
    const another = expectSuccess(await openProject({ project, access: 'write' }, storage.another));
    if (another.kind !== 'writable') throw new Error(`The project opened ${another.kind}.`);
    for (let at = 0; at < changes; at += 1) {
      expectSuccess(await another.session.run(rename(`Take ${String(at)}`)));
    }
    expectSuccess(await another.session.close());
    const session = writable(await opened(storage, project));
    const made = madeBy(expectSuccess(await storage.client.backups.backUpNow(session)));
    expectSuccess(await session.run(rename('Flood')));

    const restored = expectSuccess(
      await storage.client.backups.restore(made.generation.number, {
        as: 'replace-current',
        session,
      }),
    );

    if (restored.kind !== 'replaced') throw new Error(`The restore was ${restored.kind}.`);
    const { model } = restored.session.getSnapshot();
    expect(slicesSent(storage.pair, restored.session.handle)).toBe(1);
    expect(model.state.project.displayName).toBe(`Take ${String(changes - 1)}`);
    const stored = await storedModel(storage, project);
    expect(entriesOf(model.history)).toEqual(entriesOf(stored.history));
    expectSuccess(await restored.session.undo());
    expect(restored.session.getSnapshot().model.state.project.displayName).toBe(
      `Take ${String(changes - 2)}`,
    );
  });
});
