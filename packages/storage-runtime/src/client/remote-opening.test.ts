import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';
import { applyHistoryDelta, historyDelta, type History } from '@audiogubbins/history';

import { SLICE_ENTRIES, historySlices } from '../host/project-updates.js';
import { readPortMessage } from '../protocol/port-messages.js';
import { openingStream } from '../protocol/project-operations.js';
import type { PortPair } from '../testing/port-pair.js';
import {
  opened,
  projectScene,
  rename,
  storedModel,
  writable,
  type ProjectScene,
} from '../testing/project-scene.js';

/** Runs `count` renames, `batch` at a time, as a person working quickly would. */
async function renamed(scene: ProjectScene, count: number, batch = 500): Promise<void> {
  for (let start = 0; start < count; start += batch) {
    const runs = [];
    for (let at = start; at < Math.min(count, start + batch); at += 1) {
      runs.push(scene.session.run(rename(`Take ${String(at)}`)));
    }
    for (const ran of await Promise.all(runs)) expectSuccess(ran);
  }
}

/** The slices the worker sent on an opening stream, in order. */
function slicesSent(pair: PortPair, stream: string): unknown[] {
  return pair.toPage.flatMap((data) => {
    const read = readPortMessage(data);
    return read.ok && read.value.type === 'event' && read.value.stream === stream
      ? [read.value.value]
      : [];
  });
}

/** Applies each slice in turn to `earlier`. */
function applied(earlier: History | undefined, slices: ReturnType<typeof historySlices>): History {
  let history = earlier;
  for (const slice of slices) history = applyHistoryDelta(history, slice);
  if (history === undefined) throw new Error('No slice was applied.');
  return history;
}

/** A history's entries, for comparing two made apart. */
function entriesOf(history: History) {
  return {
    root: history.root,
    cursor: history.cursor,
    nodes: new Map(history.nodes.entries()),
    children: new Map(history.children.entries()),
    preferred: new Map(history.preferred.entries()),
    branchNames: history.branchNames,
    snapshots: history.snapshots,
  };
}

/**
 * How long a test that makes a long history may take: over a thousand changes
 * take about a second alone, which the whole suite's load can stretch past the
 * default.
 */
const LONG_HISTORY_TIMEOUT = 30_000;

describe('a project opening with a long history', { timeout: LONG_HISTORY_TIMEOUT }, () => {
  it('cuts a history into slices that, applied in turn, make it again', async () => {
    const scene = await projectScene();
    await renamed(scene, 5);
    const earlier = scene.session.getSnapshot().model.history;
    await renamed(scene, 12);
    expectSuccess(await scene.session.nameBranch(earlier.cursor, 'Earlier'));
    const later = scene.session.getSnapshot().model.history;

    const whole = historySlices(historyDelta(undefined, later), 3);
    const since = historySlices(historyDelta(earlier, later), 3);

    expect(whole.length).toBeGreaterThan(4);
    expect(whole.every((slice) => slice.nodes.set.length <= 3)).toBe(true);
    expect(whole.slice(1).every((slice) => slice.branchNames === undefined)).toBe(true);
    expect(entriesOf(applied(undefined, whole))).toEqual(entriesOf(later));
    expect(since.length).toBeGreaterThan(1);
    expect(entriesOf(applied(earlier, since))).toEqual(entriesOf(later));
  });

  it('sends a long history over several messages, and opens with all of it', async () => {
    const scene = await projectScene();
    const changes = 2 * SLICE_ENTRIES + 100;
    await renamed(scene, changes);
    expectSuccess(await scene.session.close());

    const session = writable(await opened(scene.storage, scene.project));

    const slices = slicesSent(scene.storage.pair, openingStream(1));
    expect(slices).toHaveLength(2);
    const { model } = session.getSnapshot();
    expect(model.history.nodes.size).toBe(changes + 1);
    const stored = await storedModel(scene.storage, scene.project);
    expect(entriesOf(model.history)).toEqual(entriesOf(stored.history));
    expect(model.state.project.displayName).toBe(`Take ${String(changes - 1)}`);
    const opening = session.getSnapshot();
    expect(session.getSnapshot()).toBe(opening);
    expectSuccess(await session.run(rename('After opening')));
    expect(session.getSnapshot()).not.toBe(opening);
    expect(session.getSnapshot().model.history.nodes.size).toBe(changes + 2);
  });
});
