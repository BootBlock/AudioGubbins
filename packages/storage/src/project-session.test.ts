import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { activeLine } from '@audiogubbins/history';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  ExportDestinationKind,
  ExportStatus,
  stateFingerprintOf,
  type ExportRecord,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import { openProject } from './project-opening.js';
import type { ProjectSession } from './project-session.js';
import { addAsset, contentOf, setName } from './testing/test-commands.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { harness, nodeDigest } from './testing/node-services.js';

async function started() {
  const test = harness();
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  return { test, tree, header, session };
}

describe('a project session', () => {
  it('runs a command, records it in the history and writes it at once (REQ-STOR-021)', async () => {
    const { test, tree, header, session } = await started();
    const outcome = expectSuccess(await session.run(setName('Rainy walk')));

    expect(outcome).toEqual({ kind: 'applied', saved: { kind: 'written' } });
    const { model, save } = session.getSnapshot();
    expect(model.state.project.displayName).toBe('Rainy walk');
    expect(model.history.nodes.size).toBe(2);
    const cursor = model.history.nodes.get(model.history.cursor);
    expect(cursor?.kind === 'change' && cursor.affects.project).toBe(true);
    expect(save).toEqual({ kind: 'saved' });

    // Written at once: a second window reading the storage now sees it.
    const reader = expectSuccess(
      await openProject({ project: header.id, access: 'read' }, test.services(tree)),
    );
    expect(reader.report.replayed).toBe(1);
    const view = reader.kind === 'read-only' ? reader.view.getSnapshot() : undefined;
    expect(view?.model.state.project.displayName).toBe('Rainy walk');
  });

  it('reports a refused command and changes nothing', async () => {
    const { session } = await started();
    expect(expectFailureCode(await session.run(setName(' ')))).toBe('test.name');
    expect(session.getSnapshot().model.history.nodes.size).toBe(1);
  });

  it.each([
    [
      'a backup policy nothing triggers',
      'backup.no-trigger',
      { kind: 'automatic', trigger: {}, retention: {} },
    ],
    [
      'a backup made every half minute',
      'schema.not-an-integer',
      { kind: 'automatic', trigger: { everyMinutes: 0.5 }, retention: {} },
    ],
  ] as const)(
    'refuses %s, which a reload would refuse, and keeps the policy it had',
    async (_, code, policy) => {
      const { test, tree, header, session } = await started();
      const before = session.getSnapshot().model.backup;
      expect(expectFailureCode(await session.setBackupPolicy(policy))).toBe(code);
      expect(session.getSnapshot().model.backup).toBe(before);
      expectSuccess(await session.close());
      expectSuccess(await openProject({ project: header.id, access: 'read' }, test.services(tree)));
    },
  );

  it.each([
    ['a budget below no bytes', { kind: 'budget', bytes: -1 }],
    ['a rule keeping no changes', { kind: 'rules', rules: [{ kind: 'recent-changes', count: 0 }] }],
  ] as const)(
    'refuses a retention policy of %s, which a reload would refuse',
    async (_, policy) => {
      const { session } = await started();
      const before = session.getSnapshot().model.retention;
      expect((await session.setRetentionPolicy(policy)).ok).toBe(false);
      expect(session.getSnapshot().model.retention).toBe(before);
    },
  );

  it('keeps B → C when the person goes back to A and makes D (REQ-STOR-193)', async () => {
    const { session } = await started();
    expectSuccess(await session.run(setName('A')));
    const a = session.getSnapshot().model.history.cursor;
    expectSuccess(await session.run(setName('B')));
    expectSuccess(await session.run(setName('C')));
    expectSuccess(await session.goTo(a));
    expect(session.getSnapshot().model.state.project.displayName).toBe('A');
    expectSuccess(await session.run(setName('D')));

    const { model } = session.getSnapshot();
    expect(model.history.nodes.size).toBe(5);
    expect(
      activeLine(model.history).map((node) => node.kind === 'change' && node.description),
    ).toEqual([false, 'Name the project A', 'Name the project D']);
  });

  it('undoes and redoes along the line redo follows', async () => {
    const { session } = await started();
    expectSuccess(await session.run(setName('One')));
    expectSuccess(await session.run(setName('Two')));
    expectSuccess(await session.undo());
    expect(session.getSnapshot().model.state.project.displayName).toBe('One');
    expectSuccess(await session.undo());
    expect(session.getSnapshot().model.state.project.displayName).toBe('Forest walk');
    expect(expectFailureCode(await session.undo())).toBe('history.nothing-to-undo');
    expectSuccess(await session.redo());
    expectSuccess(await session.redo());
    expect(session.getSnapshot().model.state.project.displayName).toBe('Two');
    expect(expectFailureCode(await session.redo())).toBe('history.nothing-to-redo');
  });

  it('keeps a snapshot’s state whole and records the exports made from it (REQ-STOR-194)', async () => {
    const { test, session } = await started();
    expectSuccess(await session.run(setName('Approved')));
    const { model } = session.getSnapshot();
    const record: ExportRecord = {
      id: test.ids.next<'ExportRecordId'>(),
      at: 1,
      stateFingerprint: await sessionFingerprint(session),
      engineVersions: new Map(),
      output: { container: 'wav', settings: new Map() },
      destination: { kind: ExportDestinationKind.Download },
      status: ExportStatus.Succeeded,
      problems: [],
    };
    expectSuccess(await session.recordExport(record));
    expectSuccess(
      await session.createSnapshot({ name: 'Approved game export', notes: 'Signed off' }),
    );

    const snapshot = [...session.getSnapshot().model.history.snapshots.values()][0];
    expect(snapshot?.exports).toEqual([record.id]);
    expect(snapshot?.node).toBe(model.history.cursor);
    expect(session.getSnapshot().model.history.nodes.size).toBe(model.history.nodes.size);
    expect(expectFailureCode(await session.createSnapshot({ name: '  ' }))).toBe(
      'history-label.empty',
    );
  });

  it('compares two states without touching either, and promotes one by moving to it (REQ-STOR-195)', async () => {
    const { session } = await started();
    expectSuccess(await session.run(setName('Loop A')));
    const a = session.getSnapshot().model.history.cursor;
    expectSuccess(
      await session.run(addAsset('0000aaaa-0000-4000-8000-000000000001', contentOf(1))),
    );
    const b = session.getSnapshot().model.history.cursor;

    const compared = expectSuccess(
      await session.compare({ kind: 'node', node: a }, { kind: 'node', node: b }),
    );
    expect(compared.compared.difference.assets.added).toHaveLength(1);
    expect(session.getSnapshot().model.history.cursor).toBe(b);
    expectSuccess(await session.switchSide());
    expect(session.getSnapshot().model.comparison?.listening).toBe('b');
    expectSuccess(await session.promote('a'));
    expect(session.getSnapshot().model.history.cursor).toBe(a);
    expect(session.getSnapshot().model.history.nodes.has(b)).toBe(true);
  });

  it('works out what differs between the sides of a comparison kept across a reload, names and all', async () => {
    const { test, tree, header, session } = await started();
    const a = session.getSnapshot().model.history.cursor;
    const asset = '0000aaaa-0000-4000-8000-000000000001';
    expectSuccess(await session.run(addAsset(asset, contentOf(1))));
    const opened = expectSuccess(
      await session.compare(
        { kind: 'node', node: a },
        { kind: 'node', node: session.getSnapshot().model.history.cursor },
      ),
    );
    expect(expectFailureCode(await (await started()).session.comparedDifference())).toBe(
      'comparison.none-open',
    );
    expectSuccess(await session.close());

    const reopened = await openToWrite(test, tree, header.id);
    const again = expectSuccess(await reopened.comparedDifference());
    expect(again).toEqual(opened.compared);
    expect([...again.names.entities.keys()]).toEqual([asset]);
  });

  it('never offers to undo an export (REQ-STOR-198)', async () => {
    const { test, session } = await started();
    const before = session.getSnapshot().model.history;
    expectSuccess(
      await session.recordExport({
        id: test.ids.next<'ExportRecordId'>(),
        at: 1,
        stateFingerprint: await sessionFingerprint(session),
        engineVersions: new Map(),
        output: { container: 'wav', settings: new Map() },
        destination: { kind: ExportDestinationKind.Directory, label: 'Sounds' },
        status: ExportStatus.Partial,
        problems: ['One file could not be written.'],
      }),
    );
    expect(session.getSnapshot().model.history).toBe(before);
    expect(session.getSnapshot().model.exports).toHaveLength(1);
  });

  it('keeps the list’s name in step with the project’s own', async () => {
    const { test, tree, session } = await started();
    expectSuccess(await session.run(setName('Renamed')));
    const listed = [];
    for await (const entry of test.repository(tree).list()) listed.push(entry);
    expect(listed).toMatchObject([{ kind: 'project', header: { name: 'Renamed' } }]);
  });

  it('closes by checkpointing, and reopens where it closed', async () => {
    const { test, tree, header, session } = await started();
    expectSuccess(await session.run(setName('Before closing')));
    expectSuccess(await session.close());
    expect(session.getSnapshot().access.kind).toBe('closed');
    expect(expectFailureCode(await session.run(setName('After')))).toBe('storage.not-writable');

    const reopened = await openToWrite(test, tree, header.id);
    const { model } = reopened.getSnapshot();
    expect(model.state.project.displayName).toBe('Before closing');
    expect(model.history.nodes.size).toBe(2);
  });

  it('lets the lease go when an opening to write is abandoned once it holds it', async () => {
    const test = harness();
    const tree = new SignalledTree();
    const header = await madeProject(test, tree);
    const controller = new AbortController();
    const reason = new Error('Closed.');
    // Abandoned as the lease is taken, so the opening stops on its next read.
    test.coordinator.watchOwnership(header.id, (event) => {
      if (event.kind === 'acquired') controller.abort(reason);
    });

    const opening = openProject(
      { project: header.id, access: 'write', signal: controller.signal },
      test.services(tree),
    );

    await expect(opening).rejects.toBe(reason);
    expect(await test.coordinator.ownerOf(header.id)).toBeUndefined();
  });
});

/** A tree in memory whose reads stop once their signal aborts, as a platform's do. */
class SignalledTree extends MemoryStorageTree {
  override async readFile(
    path: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer> | undefined> {
    signal?.throwIfAborted();
    return await super.readFile(path);
  }
}

async function sessionFingerprint(session: ProjectSession): Promise<StateFingerprint> {
  return await stateFingerprintOf(session.getSnapshot().model.state, nodeDigest);
}
