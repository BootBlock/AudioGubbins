import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  MemoryStorageTree,
  SimulatedCrash,
  type TornWrite,
} from '@audiogubbins/media-store/testing';
import { changeNodeOf } from '@audiogubbins/history';
import type { AffectedEntities, HistoryNodeId, StorageTree } from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import { newestHead } from './project-heads.js';
import { ProjectFiles } from './project-files.js';
import { openProject, type OpenedProject } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { summaryOf } from './testing/model-summary.js';
import { addAsset, contentOf, setName } from './testing/test-commands.js';
import { madeProject, openToWrite, type Harness } from './testing/storage-harness.js';
import { harness, nodeDigest } from './testing/node-services.js';

/**
 * Crash injection at every operation of the tree (REQ-EXEC-180, the packet's
 * "Failure and Recovery Behaviour"): a scripted session of changes, undo,
 * moves, a snapshot, a branch name, a checkpoint and a close is run once whole,
 * to learn the project after each step, then again with the tree crashing at
 * each of its operations in turn. After each crash the project is opened from
 * what the tree held: it must open, validated, to the project as of the last
 * step acknowledged as written or as of the step the crash cut short, never to
 * anything else, and it must go on working.
 */

const PROJECT_ONLY: AffectedEntities = {
  assets: [],
  tracks: [],
  buses: [],
  clips: [],
  regions: [],
  markers: [],
  effectChains: [],
  project: true,
};

type Step = (context: StepContext) => Promise<unknown>;

interface StepContext {
  readonly test: Harness;
  readonly tree: StorageTree;
  project?: ProjectSession;
  readonly nodes: Map<string, HistoryNodeId>;
}

function session(context: StepContext): ProjectSession {
  if (context.project === undefined) throw new Error('No session is open.');
  return context.project;
}

function remember(context: StepContext, name: string): void {
  context.nodes.set(name, session(context).getSnapshot().model.history.cursor);
}

function node(context: StepContext, name: string): HistoryNodeId {
  const found = context.nodes.get(name);
  if (found === undefined) throw new Error(`No node ${name} was remembered.`);
  return found;
}

const SCRIPT: readonly (readonly [string, Step])[] = [
  ['create', async ({ test, tree }) => await madeProject(test, tree)],
  [
    'open',
    async (context) => {
      const [header] = await listed(context.test, context.tree);
      if (header === undefined) throw new Error('The project was not listed.');
      context.project = await openToWrite(context.test, context.tree, header, {
        cadence: { checkpointAfter: 4, keepStateEvery: 2 },
      });
      remember(context, 'root');
    },
  ],
  ['name A', async (context) => expectSuccess(await session(context).run(setName('A')))],
  [
    'add an asset',
    async (context) => {
      expectSuccess(
        await session(context).run(addAsset('0000aaaa-0000-4000-8000-000000000001', contentOf(7))),
      );
      remember(context, 'asset');
    },
  ],
  ['name B', async (context) => expectSuccess(await session(context).run(setName('B')))],
  ['undo', async (context) => expectSuccess(await session(context).undo())],
  [
    'snapshot',
    async (context) => expectSuccess(await session(context).createSnapshot({ name: 'Kept' })),
  ],
  [
    'go to the root',
    async (context) => expectSuccess(await session(context).goTo(node(context, 'root'))),
  ],
  ['name C', async (context) => expectSuccess(await session(context).run(setName('C')))],
  ['checkpoint', async (context) => expectSuccess(await session(context).checkpoint())],
  [
    'name the branch',
    async (context) =>
      expectSuccess(await session(context).nameBranch(node(context, 'asset'), 'Asset line')),
  ],
  [
    'go to the asset',
    async (context) => expectSuccess(await session(context).goTo(node(context, 'asset'))),
  ],
  ['name D', async (context) => expectSuccess(await session(context).run(setName('D')))],
  ['name E', async (context) => expectSuccess(await session(context).run(setName('E')))],
  [
    'close',
    async (context) => {
      expectSuccess(await session(context).close());
    },
  ],
];

async function listed(test: Harness, tree: StorageTree) {
  const ids = [];
  for await (const entry of test.repository(tree).list()) {
    if (entry.kind === 'project') ids.push(entry.header.id);
  }
  return ids;
}

/** Runs the script, and gives the summary after each step reached and the step that threw. */
async function runScript(
  tree: StorageTree,
): Promise<{ readonly after: readonly string[]; readonly crashedAt: number | undefined }> {
  const context: StepContext = { test: harness(5), tree, nodes: new Map() };
  const after: string[] = [];
  for (const [index, [, step]] of SCRIPT.entries()) {
    try {
      await step(context);
    } catch (error) {
      if (error instanceof SimulatedCrash) return { after, crashedAt: index };
      throw error;
    }
    after.push(
      context.project === undefined ? 'no session' : summaryOf(context.project.getSnapshot().model),
    );
  }
  return { after, crashedAt: undefined };
}

async function opened(tree: StorageTree, seed: number): Promise<OpenedProject | undefined> {
  const test = harness(seed);
  const [project] = await listed(test, tree);
  if (project === undefined) return undefined;
  return expectSuccess(await openProject({ project, access: 'write' }, test.services(tree)));
}

describe('crash recovery at every tree operation (REQ-STOR-101)', () => {
  it.each<TornWrite>(['short', 'full-length'])(
    'opens every crash, a write torn %s, to the last acknowledged step or the one cut short, and goes on',
    async (tornWrite) => {
      const clean = new MemoryStorageTree();
      const whole = await runScript(clean);
      expect(whole.crashedAt).toBeUndefined();
      const operations = clean.operations;
      expect(operations).toBeGreaterThan(100);

      const reportedBreaks = new Set<string>();
      for (let crashAt = 1; crashAt <= operations; crashAt += 1) {
        const tree = new MemoryStorageTree({ crashAt, tornWrite });
        const run = await runScript(tree);
        const found = tree.restarted();
        const reopened = await opened(found, 1_000 + crashAt);
        const crashed = run.crashedAt ?? SCRIPT.length;

        if (reopened === undefined) {
          // Only a crash while the project was being made leaves none to list.
          expect(crashed, `crash at ${String(crashAt)}`).toBe(0);
          continue;
        }
        if (reopened.kind !== 'writable') throw new Error('Expected the project to open to write.');
        const summary = summaryOf(reopened.session.getSnapshot().model);
        const acknowledged = run.after.at(-1);
        const cutShort = whole.after[crashed];
        const allowed = [acknowledged, cutShort].filter((one) => one !== 'no session');
        // A crash before the session opened leaves the project as it was made.
        if (crashed <= 1) allowed.push(whole.after[1]);
        expect(
          allowed,
          `crash at ${String(crashAt)} in step ${SCRIPT[crashed]?.[0] ?? 'none'}`,
        ).toContain(summary);
        const journalBreak = reopened.report.journalBreak;
        if (journalBreak !== undefined) reportedBreaks.add(journalBreak.reason.kind);

        // Closed as it was found, the project's checkpoint names the state the
        // crash may have torn, and the close writes that state whole again.
        expectSuccess(await reopened.session.close());
        const settled = await opened(found, 3_000 + crashAt);
        if (settled?.kind !== 'writable') throw new Error('Expected the project to open again.');
        expect(settled.report.rebuiltCursorState, `crash at ${String(crashAt)}`).toBeUndefined();
        expect(settled.report.missingStates, `crash at ${String(crashAt)}`).toEqual([]);

        // The project goes on working after the crash, and keeps what it did.
        expectSuccess(await settled.session.run(setName(`After ${String(crashAt)}`)));
        expectSuccess(await settled.session.close());
        const again = await opened(found, 5_000 + crashAt);
        if (again?.kind !== 'writable') throw new Error('Expected the project to open again.');
        expect(again.session.getSnapshot().model.state.project.displayName).toBe(
          `After ${String(crashAt)}`,
        );
        expect(again.report.journalBreak).toBeUndefined();
      }
      // Some crash tore a journal record, and recovery said so.
      expect(reportedBreaks).toContain('invalid');
    },
    120_000,
  );
});

describe('recovery from damage it did not make', () => {
  async function closedProject() {
    const test = harness();
    const tree = new MemoryStorageTree();
    const header = await madeProject(test, tree);
    const session = await openToWrite(test, tree, header.id);
    expectSuccess(await session.run(setName('Checkpointed')));
    expectSuccess(await session.checkpoint());
    expectSuccess(await session.run(setName('Journalled')));
    const files = new ProjectFiles(new CheckedRecords(tree, nodeDigest), header.id);
    return { test, tree, header, session, files };
  }

  it('opens from the head before when a head is torn as it is written', async () => {
    // Learn which operation writes the second checkpoint's head, then crash on it.
    const spy = new HeadWrites(new MemoryStorageTree());
    await twoCheckpoints(spy);
    const secondHead = expectDefined(spy.operations.at(-1));
    const tree = new MemoryStorageTree({ crashAt: secondHead });
    await expect(twoCheckpoints(tree)).rejects.toBeInstanceOf(SimulatedCrash);

    const found = tree.restarted();
    const [project] = await listed(harness(99), found);
    const reopened = expectSuccess(
      await openProject(
        { project: expectDefined(project), access: 'read' },
        harness(99).services(found),
      ),
    );
    expect(reopened.report.fallbacks).toMatchObject([
      { reason: { kind: 'head-invalid', fault: { kind: 'damaged' } } },
    ]);
    expect(reopened.report.replayed).toBe(1);
    const view = reopened.kind === 'read-only' ? reopened.view.getSnapshot() : undefined;
    expect(view?.model.state.project.displayName).toBe('Second');
  });

  it('refuses to open, and says why, when no head leads anywhere', async () => {
    const { tree, header, files } = await closedProject();
    await tree.remove(files.paths.checkpoints);
    const test = harness(99);
    const reopened = await openProject({ project: header.id, access: 'read' }, test.services(tree));
    expect(reopened.ok ? 'opened' : reopened.failures[0].code).toBe('storage.no-usable-head');
  });

  it('rebuilds a cursor state whose file does not hold what its name promises, and reports it', async () => {
    const { tree, header, files, session } = await closedProject();
    const head = expectDefined(await newestHead(files.records, files.paths));
    const checkpoint = await files.readCheckpoint(head.epoch, head.checkpoint);
    if (checkpoint.kind !== 'valid') throw new Error('No checkpoint.');
    const cursor = checkpoint.value.cursorState;
    const other = [...checkpoint.value.keptStates].find((state) => state !== cursor);
    // The cursor's file now holds another valid state: it reads, but is not the one named.
    await tree.writeFile(
      files.states.path(cursor),
      expectDefined(await tree.readFile(files.states.path(expectDefined(other)))),
    );

    const test = harness(99);
    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, test.services(tree)),
    );
    expect(reopened.report.rebuiltCursorState?.code).toBe('storage.state-mismatch');
    const view = reopened.kind === 'read-only' ? reopened.view.getSnapshot() : undefined;
    expect(view && summaryOf(view.model)).toBe(summaryOf(session.getSnapshot().model));
  });

  it('writes whole again a cursor state it rebuilt, though the cursor moves on', async () => {
    const { test, tree, header, files, session } = await closedProject();
    expectSuccess(await session.createSnapshot({ name: 'Kept' }));
    expectSuccess(await session.close());
    const snapshot = expectDefined([...session.getSnapshot().model.history.snapshots.values()][0]);
    const path = files.states.path(snapshot.stateFingerprint);
    const whole = expectDefined(await tree.readFile(path));
    await tree.writeFile(path, new Uint8Array(whole.length));

    const moving = await openToWrite(test, tree, header.id);
    expectSuccess(await moving.run(setName('Moved on')));
    expectSuccess(await moving.close());
    expectSuccess(await files.states.get(snapshot.stateFingerprint));
  });

  it('reports a kept state that is missing', async () => {
    const { tree, header, files, session } = await closedProject();
    expectSuccess(await session.createSnapshot({ name: 'Kept' }));
    const snapshot = expectDefined([...session.getSnapshot().model.history.snapshots.values()][0]);
    await tree.remove(files.states.path(snapshot.stateFingerprint));
    const test = harness(99);
    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, test.services(tree)),
    );
    expect(reopened.report.missingStates).toContain(snapshot.stateFingerprint);
  });

  it('stops where a replayed change does not give the state it recorded', async () => {
    const { test, tree, header, files, session } = await closedProject();
    const { history } = session.getSnapshot().model;
    const node = changeNodeOf(history, {
      id: test.ids.next<'HistoryNodeId'>(),
      at: 1,
      entry: {
        description: 'Claimed',
        forward: [setName('Claimed')],
        inverse: [setName('Journalled')],
      },
      affects: { ...PROJECT_ONLY },
      stateFingerprint: await files.states.fingerprint(session.getSnapshot().model.state),
    });
    // The session wrote records 1 and 2 of epoch 2; this one claims a state its
    // replay will not give.
    await files.journal.append({ epoch: 2, sequence: 3 }, { kind: 'change', node });

    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(99).services(tree)),
    );
    expect(reopened.report.journalBreak).toMatchObject({
      at: { epoch: 2, sequence: 3 },
      reason: { kind: 'refused', failure: { code: 'storage.replay-diverged' } },
    });
    const view = reopened.kind === 'read-only' ? reopened.view.getSnapshot() : undefined;
    expect(view?.model.state.project.displayName).toBe('Journalled');
  });

  it('stops at a torn record, keeps what follows aside, and reports both', async () => {
    const { tree, header, files, session } = await closedProject();
    expectSuccess(await session.run(setName('Third')));
    expectSuccess(await session.run(setName('Fourth')));
    const records = (await tree.list(files.paths.journal)).flatMap((entry) => [entry.name]);
    const epoch = expectDefined(records.at(-1));
    const directory = `${files.paths.journal}/${epoch}`;
    const [, second] = await tree.list(directory);
    const path = `${directory}/${expectDefined(second).name}`;
    const bytes = expectDefined(await tree.readFile(path));
    await tree.writeFile(path, bytes.subarray(0, 10));

    const test = harness(99);
    const reopened = expectSuccess(
      await openProject({ project: header.id, access: 'write' }, test.services(tree)),
    );
    expect(reopened.report.replayed).toBe(1);
    expect(reopened.report.journalBreak).toMatchObject({
      reason: { kind: 'invalid', fault: { kind: 'damaged' } },
      discarded: [{ sequence: 3 }, { sequence: 4 }],
    });
    const view = reopened.kind === 'writable' ? reopened.session.getSnapshot() : undefined;
    expect(view?.model.state.project.displayName).toBe('Journalled');

    // Sealed at the last good record: the tail is set aside at the next
    // checkpoint rather than deleted, and never replayed again.
    if (reopened.kind !== 'writable') throw new Error('Expected a writable project.');
    expectSuccess(await reopened.session.checkpoint());
    const quarantined = await tree.list(files.paths.quarantine);
    expect(quarantined.map((entry) => entry.name)).toHaveLength(2);
    const again = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, harness(98).services(tree)),
    );
    expect(again.report.journalBreak).toBeUndefined();
  });
});

/** A session that checkpoints twice, the second time after one more change. */
async function twoCheckpoints(tree: StorageTree): Promise<void> {
  const test = harness(3);
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  expectSuccess(await session.run(setName('First')));
  expectSuccess(await session.checkpoint());
  expectSuccess(await session.run(setName('Second')));
  expectSuccess(await session.checkpoint());
}

/** A tree that notes the number of each operation that writes a head. */
class HeadWrites implements StorageTree {
  readonly operations: number[] = [];
  private readonly inner: MemoryStorageTree;

  constructor(inner: MemoryStorageTree) {
    this.inner = inner;
  }

  readFile = async (path: string) => await this.inner.readFile(path);
  openFile = async (path: string) => await this.inner.openFile(path);
  createFile = async (path: string) => await this.inner.createFile(path);
  remove = async (path: string) => {
    await this.inner.remove(path);
  };
  list = async (directory: string) => await this.inner.list(directory);
  writeFile = async (path: string, bytes: Uint8Array) => {
    if (/\/heads\/[0-9-]+\.json$/u.test(path)) this.operations.push(this.inner.operations + 1);
    await this.inner.writeFile(path, bytes);
  };
}

function expectDefined<TValue>(value: TValue | undefined): TValue {
  if (value === undefined) throw new Error('Expected a value.');
  return value;
}
