import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { historyDelta } from '@audiogubbins/history';

import { readPortMessage } from '../protocol/port-messages.js';
import { projectStream } from '../protocol/project-operations.js';
import type { PortPair } from '../testing/port-pair.js';
import { projectScene, rename } from '../testing/project-scene.js';

/** Every update the worker sent the page on the first project's stream, in order. */
function updatesSent(pair: PortPair): unknown[] {
  return pair.toPage.flatMap((data) => {
    const read = readPortMessage(data);
    const message = read.ok ? read.value : undefined;
    return message?.type === 'event' && message.stream === projectStream(0) ? [message.value] : [];
  });
}

/** The updates `work` made the worker send on the first project's stream. */
async function updatesOf(pair: PortPair, work: () => Promise<unknown>): Promise<unknown[]> {
  const before = updatesSent(pair).length;
  await work();
  return updatesSent(pair).slice(before);
}

/** Whether a value sent has a member. */
function has(member: string): (value: unknown) => boolean {
  return (value) => typeof value === 'object' && value !== null && member in value;
}

describe("the page's copy of an open project", () => {
  it('is one snapshot between updates, and a new one after each', async () => {
    const { session } = await projectScene();
    let heard = 0;
    session.subscribe(() => {
      heard += 1;
    });
    const opening = session.getSnapshot();

    expectSuccess(await session.planCompaction({ kind: 'policy', policy: { kind: 'unlimited' } }));
    expect(session.getSnapshot()).toBe(opening);
    expect(heard).toBe(0);

    expectSuccess(await session.run(rename('Renamed')));
    const changed = session.getSnapshot();
    expect(changed).not.toBe(opening);
    expect(heard).toBeGreaterThan(0);
    expect(session.getSnapshot()).toBe(changed);
    expect(changed.model.history.nodes.get(opening.model.history.cursor)).toBe(
      opening.model.history.nodes.get(opening.model.history.cursor),
    );
  });

  it('is sent the save, the access and the history, and only what else changed', async () => {
    const { storage, session } = await projectScene();

    const renaming = await updatesOf(storage.pair, () => session.run(rename('Renamed')));
    expect(renaming.filter(has('state'))).toHaveLength(1);
    expect(renaming.every(has('save')) && renaming.every(has('access'))).toBe(true);
    expect(renaming.every(has('history'))).toBe(true);
    for (const unchanged of ['exports', 'retention', 'backup', 'comparison']) {
      expect(renaming.filter(has(unchanged))).toEqual([]);
    }

    const policy = await updatesOf(storage.pair, () => session.setBackupPolicy({ kind: 'off' }));
    expect(policy.filter(has('backup'))).toEqual([
      expect.objectContaining({ backup: { kind: 'off' } }),
    ]);
    expect(policy.filter(has('state'))).toEqual([]);
  });

  it('is told when a comparison closes', async () => {
    const { storage, session } = await projectScene();
    expectSuccess(await session.run(rename('Loop B')));
    const { root, cursor } = session.getSnapshot().model.history;
    expectSuccess(
      await session.compare({ kind: 'node', node: root }, { kind: 'node', node: cursor }),
    );

    const closing = await updatesOf(storage.pair, () => session.closeComparison());

    expect(closing.filter(has('comparison'))).toEqual([
      expect.objectContaining({ comparison: { kind: 'closed' } }),
    ]);
    expect(session.getSnapshot().model.comparison).toBeUndefined();
  });

  it('stops hearing the project once it is closed, whose handle the worker then refuses', async () => {
    const { storage, session } = await projectScene();
    expectSuccess(await session.close());
    const closed = session.getSnapshot();
    expect(closed.access).toEqual({ kind: 'closed' });

    const { history } = closed.model;
    storage.pair.sendToPage({
      type: 'event',
      stream: projectStream(0),
      value: { save: closed.save, access: closed.access, history: historyDelta(history, history) },
    });
    await expect(session.run(rename('After closing'))).rejects.toThrow(
      /No project is open to write as handle 0/,
    );
    expect(session.getSnapshot()).toBe(closed);
  });
});
