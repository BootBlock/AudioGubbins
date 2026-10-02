import { describe, expect, it } from 'vitest';

import { fail, failure, FailureKind, type IdGenerator } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { changeNodeOf, recordChange, type History } from '@audiogubbins/history';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  stateFingerprintFrom,
  type AffectedEntities,
  type ProjectState,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import { arriveAt, type KeptStates } from './history-moves.js';
import { harness } from './testing/node-services.js';
import { silentLogger } from './testing/silent-logger.js';
import { madeProject, openToWrite } from './testing/storage-harness.js';
import { setName, testBus } from './testing/test-commands.js';

const PROJECT_AFFECTED: AffectedEntities = {
  project: true,
  assets: [],
  tracks: [],
  buses: [],
  clips: [],
  regions: [],
  markers: [],
  effectChains: [],
};

/** A fingerprint for the state after `step` changes, which storage never holds. */
function fingerprintOf(step: number): StateFingerprint {
  return expectSuccess(stateFingerprintFrom(`s1-${step.toString(16).padStart(64, '0')}`));
}

/** `history` grown by `depth` renamings, each node naming a state, and the state at its end. */
function renamed(
  history: History,
  state: ProjectState,
  depth: number,
  ids: IdGenerator,
): { readonly history: History; readonly state: ProjectState } {
  let grown = history;
  let previous = state.project.displayName;
  for (let step = 0; step < depth; step += 1) {
    const name = `Name ${String(step)}`;
    const node = changeNodeOf(grown, {
      id: ids.next<'HistoryNodeId'>(),
      at: step,
      entry: { description: name, forward: [setName(name)], inverse: [setName(previous)] },
      affects: PROJECT_AFFECTED,
      stateFingerprint: fingerprintOf(step),
    });
    grown = expectSuccess(recordChange(grown, node));
    previous = name;
  }
  const last = testBus().execute(state, setName(previous));
  if (last.kind !== 'applied') throw new Error('The last name was not applied.');
  return { history: grown, state: last.next };
}

/** How many kept states one undo asks about, at the end of a line `depth` deep. */
async function keptStatesAskedForOneUndo(depth: number): Promise<number> {
  const test = harness();
  const tree = new MemoryStorageTree();
  const header = await madeProject(test, tree);
  const session = await openToWrite(test, tree, header.id);
  const { model } = session.getSnapshot();
  const line = renamed(model.history, model.state, depth, test.ids);
  let asked = 0;
  const states: KeptStates = {
    isKept: () => {
      asked += 1;
      return false;
    },
    load: () => Promise.resolve(fail(failure('test.not-kept', FailureKind.Conflict, 'Not kept.'))),
  };
  const cursor = line.history.nodes.get(line.history.cursor);
  const parent = cursor?.kind === 'change' ? cursor.parent : undefined;
  if (parent === undefined) throw new Error('The line has no change at its end.');
  const arrival = expectSuccess(
    await arriveAt(line.history, line.state, parent, {
      bus: testBus(),
      states,
      logger: silentLogger(),
    }),
  );
  expect(arrival.state.project.displayName).toBe(`Name ${String(depth - 2)}`);
  return asked;
}

describe('one undo through storage', () => {
  it('looks for a kept state no further up than the move is long, however deep the history', async () => {
    expect(await keptStatesAskedForOneUndo(5_000)).toBe(await keptStatesAskedForOneUndo(10));
  });
});
