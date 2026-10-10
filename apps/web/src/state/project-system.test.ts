import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { libraryChannel } from '../io/library-channel.js';
import { olderStorage, projectWorld, scriptedFiles } from '../testing/project-context.js';
import { ScriptedLinkedFiles } from '../testing/scripted-linked-files.js';
import { buildShellContext } from '../testing/shell-context.js';
import type { PageVisibility } from './layout-map-watch.js';
import { projectSystemOver } from './project-system.js';

/**
 * The peak cache the project system hands the editor keeps to a storage root
 * that is ready: stored data of another schema waits for the person's decision
 * untouched, so not a byte of peaks is read from or written into it until then.
 */

/** A page that stays visible, so nothing asks for a checkpoint. */
const VISIBLE_PAGE: PageVisibility = {
  isVisible: () => true,
  listen: () => () => undefined,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the peak cache the project system keeps', () => {
  it('asks the storage nothing while the stored data blocks every project, and keeps peaks once the root is ready', async () => {
    const world = projectWorld(await olderStorage());
    const built = buildShellContext();
    const services = world.page(built.context);
    const read = vi.spyOn(services.client.caches, 'read');
    const put = vi.spyOn(services.client.caches, 'put');
    const system = projectSystemOver(
      services,
      {
        files: scriptedFiles(),
        canLink: true,
        backupFolder: undefined,
        linkedFiles: new ScriptedLinkedFiles(),
        libraryChanges: libraryChannel(undefined, built.context.diagnostics.loggerFor('projects')),
      },
      { diagnostics: built.context.diagnostics, storage: built.storage, page: VISIBLE_PAGE },
    );
    await expect.poll(() => system.storageRoot.get().kind).toBe('blocked');

    const peaks = new Uint8Array([1, 2, 3, 4]);
    expect(await system.peakCache.read('test-tone', 'r1')).toBeUndefined();
    await expect(system.peakCache.write('test-tone', 'r1', peaks)).rejects.toThrow(
      /cannot be written to now/u,
    );
    expect(read).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();

    expectSuccess(await system.storageRoot.wipe());
    expect(system.storageRoot.get().kind).toBe('ready');
    await system.peakCache.write('test-tone', 'r1', peaks);
    // Compared by value: the bytes came back across the worker's port.
    const kept = await system.peakCache.read('test-tone', 'r1');
    expect(kept === undefined ? undefined : [...kept]).toEqual([...peaks]);
    expect(put).toHaveBeenCalledTimes(1);
    system.dispose();
  });
});
