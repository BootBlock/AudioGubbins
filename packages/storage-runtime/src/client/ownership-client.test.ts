import { describe, expect, it, vi } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import type { LeaseOwner, OwnershipEvent } from '@audiogubbins/storage';

import { memoryStorage } from '../testing/memory-storage.js';

const PROJECT = unsafeBrandId<'ProjectId'>('p-1');
const OTHER = unsafeBrandId<'ProjectId'>('p-2');
const WINDOW: LeaseOwner = { instance: 'window-b', label: 'the window called B' };

describe('who writes a project, asked of the storage worker', () => {
  it('tells the owner of a project, and that no window writes one unheld', async () => {
    const { client, coordinator } = memoryStorage();

    await expect(client.ownership.ownerOf(PROJECT)).resolves.toBeUndefined();
    await coordinator.acquire(PROJECT, { steal: false, owner: WINDOW });

    await expect(client.ownership.ownerOf(PROJECT)).resolves.toEqual(WINDOW);
  });

  it("sends each change of a project's writer to its own listeners, until they stop", async () => {
    const { client, coordinator } = memoryStorage();
    const heard: OwnershipEvent[] = [];
    const stop = await client.ownership.watch(PROJECT, (event) => heard.push(event));
    const unheard = await client.ownership.watch(OTHER, () => heard.push({ kind: 'released' }));

    const taken = await coordinator.acquire(PROJECT, { steal: false, owner: WINDOW });
    if (taken.kind !== 'held') throw new Error('The project was not taken.');
    await taken.lease.release();
    await vi.waitFor(() => {
      expect(heard).toEqual([{ kind: 'acquired', owner: WINDOW }, { kind: 'released' }]);
    });

    await stop();
    await unheard();
    await coordinator.acquire(PROJECT, { steal: false, owner: WINDOW });
    await client.ownership.ownerOf(PROJECT);
    expect(heard).toHaveLength(2);
  });

  it('keeps watching for a listener after another of the same project stops', async () => {
    const { client, coordinator, pair } = memoryStorage();
    const first: OwnershipEvent[] = [];
    const second: OwnershipEvent[] = [];
    const stopFirst = await client.ownership.watch(PROJECT, (event) => first.push(event));
    await client.ownership.watch(PROJECT, (event) => second.push(event));

    await stopFirst();
    await stopFirst();
    await coordinator.acquire(PROJECT, { steal: false, owner: WINDOW });

    await vi.waitFor(() => {
      expect(second).toEqual([{ kind: 'acquired', owner: WINDOW }]);
    });
    expect(first).toEqual([]);
    expect(
      pair.toWorker.filter((message) => isCallOf(message, 'ownership.unsubscribe')),
    ).toHaveLength(1);
  });
});

/** Whether a message is a call of `operation`. */
function isCallOf(message: unknown, operation: string): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'operation' in message &&
    message.operation === operation
  );
}
