import { describe, expect, it, vi } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import type { YieldToHost } from '@audiogubbins/project-format';
import { MemoryLeaseCoordinator } from '@audiogubbins/storage/testing';

import { memoryStorage, type MemoryStorage } from '../testing/memory-storage.js';
import { madeProject, opened, readOnly, rename, writable } from '../testing/project-scene.js';
import type { RemoteProjectSession, RemoteReadOnlyProject } from './remote-project.js';

/** Waits for a later task, by which a message posted now has arrived. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Two tabs of one profile, each a page with its own storage worker, over one storage. */
function twoTabs(): readonly [MemoryStorage, MemoryStorage] {
  const tree = new MemoryStorageTree();
  const coordinator = new MemoryLeaseCoordinator();
  return [
    memoryStorage({ tree, coordinator, tab: { name: 'first', seed: 29 } }),
    memoryStorage({ tree, coordinator, tab: { name: 'second', seed: 41 } }),
  ];
}

function nameOf(project: RemoteProjectSession | RemoteReadOnlyProject): string {
  return project.getSnapshot().model.state.project.displayName;
}

/**
 * Opens a project to write, abandoning the opening once `abandoning` calls
 * the function it is given, and settles once the opening has rejected with
 * why. `abandoning` gives back how to stop waiting to abandon it.
 */
async function abandonedOpening(
  storage: MemoryStorage,
  project: ProjectId,
  abandoning: (abandon: () => void) => () => void,
): Promise<void> {
  const controller = new AbortController();
  const reason = new Error('Closed.');
  const stop = abandoning(() => {
    controller.abort(reason);
  });
  const opening = storage.client.projects.open({
    project,
    access: 'write',
    signal: controller.signal,
  });
  await expect(opening).rejects.toBe(reason);
  stop();
}

/** Abandons an opening as the worker takes the project's lease, part of the way through. */
function asTheLeaseIsTaken(storage: MemoryStorage, project: ProjectId) {
  return (abandon: () => void): (() => void) =>
    storage.coordinator.watchOwnership(project, (event) => {
      if (event.kind === 'acquired') abandon();
    });
}

/**
 * Abandons an opening as the worker sends its answer, which the page then
 * finds no call waiting for, and the worker finds its cancel too late.
 */
function asTheWorkerAnswers(storage: MemoryStorage) {
  return (abandon: () => void): (() => void) => {
    const { worker } = storage.pair;
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (message, options) => {
      if (typeof message === 'object' && message !== null && 'outcome' in message) abandon();
      post(message, options);
    };
    return () => {
      worker.postMessage = post;
    };
  };
}

describe('a project open to read in the storage worker, as the page holds it', () => {
  it('shows who writes it and their checkpoints, and is handed over when it asks', async () => {
    const [first, second] = twoTabs();
    const project = await madeProject(first);
    const writer = writable(await opened(first, project));
    const view = readOnly(await opened(second, project));
    expect(view.getSnapshot().access).toEqual({
      kind: 'read-only',
      reason: { kind: 'busy', owner: { instance: 'first', label: 'the window called first' } },
    });

    expectSuccess(await writer.run(rename('Written by the first')));
    expectSuccess(await writer.checkpoint());
    await vi.waitFor(() => {
      expect(nameOf(view)).toBe('Written by the first');
    });

    const asked = view.requestTransfer();
    const request = await vi.waitFor(() => {
      const { access } = writer.getSnapshot();
      const [waiting] = access.kind === 'writable' ? access.transferRequests : [];
      if (waiting === undefined) throw new Error('No request has arrived.');
      return waiting;
    });
    expect(request.from.instance).toBe('second');
    expectSuccess(await writer.answerTransfer(request, 'granted'));
    expect(expectSuccess(await asked)).toBe('granted');
    expect(writer.getSnapshot().access).toEqual({ kind: 'handed-over' });
    await vi.waitFor(() => {
      expect(view.getSnapshot().access).toEqual({
        kind: 'read-only',
        reason: { kind: 'released' },
      });
    });

    await view.close();
    const taken = writable(await opened(second, project));
    expect(nameOf(taken)).toBe('Written by the first');
    expect(expectSuccess(await taken.run(rename('Written by the second'))).kind).toBe('applied');
  });

  it('hears no answer once its signal aborts, and is refused once it is closed', async () => {
    const [first, second] = twoTabs();
    const project = await madeProject(first);
    writable(await opened(first, project));
    const view = readOnly(await opened(second, project));
    const controller = new AbortController();

    const asked = view.requestTransfer(controller.signal);
    await nextTask();
    controller.abort(new Error('Gave up.'));
    expect(expectSuccess(await asked)).toBe('unreachable');

    await view.close();
    await expect(view.requestTransfer()).rejects.toThrow(/No project is open to read as handle 0/);
  });
});

describe('opening a project in the storage worker, abandoned', () => {
  it('lets the project go where the worker hears so as it opens it', async () => {
    let turning = false;
    // A turn lets the messages waiting be read, as the worker's host does.
    const yieldToHost: YieldToHost = async () => {
      if (turning) await nextTask();
    };
    const storage = memoryStorage({ yieldToHost });
    const project = await madeProject(storage);
    turning = true;

    await abandonedOpening(storage, project, asTheLeaseIsTaken(storage, project));

    await vi.waitFor(() => {
      expect(storage.pair.toPage).toContainEqual(
        expect.objectContaining({ type: 'answer', outcome: { kind: 'cancelled' } }),
      );
    });
    expect(await storage.coordinator.ownerOf(project)).toBeUndefined();
    expect(writable(await opened(storage, project)).project).toBe(project);
  });

  it('lets the project go where the worker opened it before it heard so', async () => {
    const storage = memoryStorage();
    const project = await madeProject(storage);

    await abandonedOpening(storage, project, asTheWorkerAnswers(storage));

    // The worker answered the opening rather than hearing it was abandoned.
    expect(storage.pair.toPage).not.toContainEqual(
      expect.objectContaining({ outcome: { kind: 'cancelled' } }),
    );
    await vi.waitFor(async () => {
      expect(await storage.coordinator.ownerOf(project)).toBeUndefined();
    });
    expect(writable(await opened(storage, project)).project).toBe(project);
  });
});
