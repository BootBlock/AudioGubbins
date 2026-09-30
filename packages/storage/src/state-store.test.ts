import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  emptyProjectState,
  stateFingerprintOf,
  type ProjectState,
} from '@audiogubbins/project-format';
import { emptyProject } from '@audiogubbins/test-fixtures';

import { SnapshotStore } from './state-store.js';
import { nodeDigest } from './testing/node-services.js';

const STATE: ProjectState = emptyProjectState(emptyProject());
const RENAMED: ProjectState = { ...STATE, project: { ...STATE.project, displayName: 'Renamed' } };

function store(tree = new MemoryStorageTree()) {
  return {
    tree,
    states: new SnapshotStore(tree, nodeDigest, `projects/${STATE.project.id}/states`),
  };
}

describe('the states a project keeps whole (REQ-STOR-101)', () => {
  it('keeps a state under the fingerprint of its document, and reads it back', async () => {
    const { states } = store();
    const fingerprint = await states.put(STATE);
    expect(fingerprint).toBe(await stateFingerprintOf(STATE, nodeDigest));
    expect(expectSuccess(await states.get(fingerprint))).toEqual(STATE);
    expect([...(await states.list())]).toEqual([fingerprint]);
  });

  it('writes a state already whole never again, so nothing sound is rewritten in place', async () => {
    const { tree, states } = store();
    await states.put(STATE);
    const before = tree.operations;
    await states.put(STATE);
    // One look at the file, and no write.
    expect(tree.operations - before).toBe(1);
  });

  it('writes a torn state again', async () => {
    const { tree, states } = store();
    const fingerprint = await states.put(STATE);
    const path = `projects/${STATE.project.id}/states/${fingerprint}.json`;
    const bytes = await tree.readFile(path);
    await tree.writeFile(path, (bytes ?? new Uint8Array()).subarray(0, 20));
    expect(expectFailureCode(await states.get(fingerprint))).toBe('storage.state-unreadable');
    await states.put(STATE);
    expect(expectSuccess(await states.get(fingerprint))).toEqual(STATE);
  });

  it('writes again a state torn at its full length, as a write sized before it lands leaves one', async () => {
    const { tree, states } = store();
    const fingerprint = await states.put(STATE);
    const path = `projects/${STATE.project.id}/states/${fingerprint}.json`;
    const whole = (await tree.readFile(path)) ?? new Uint8Array();
    const torn = new Uint8Array(whole.length);
    torn.set(whole.subarray(0, whole.length >> 1));
    await tree.writeFile(path, torn);
    await states.put(STATE);
    expect(expectSuccess(await states.get(fingerprint))).toEqual(STATE);
  });

  it('refuses a file that holds another state than its name promises', async () => {
    const { tree, states } = store();
    const fingerprint = await states.put(STATE);
    const other = await states.put(RENAMED);
    const base = `projects/${STATE.project.id}/states`;
    await tree.writeFile(
      `${base}/${fingerprint}.json`,
      (await tree.readFile(`${base}/${other}.json`)) ?? new Uint8Array(),
    );
    expect(expectFailureCode(await states.get(fingerprint))).toBe('storage.state-mismatch');
  });

  it('says a state is missing', async () => {
    const { states } = store();
    const fingerprint = await stateFingerprintOf(STATE, nodeDigest);
    expect(expectFailureCode(await states.get(fingerprint))).toBe('storage.state-missing');
  });
});
