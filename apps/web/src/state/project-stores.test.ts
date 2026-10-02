import { describe, expect, it } from 'vitest';

import { CacheCategory } from '@audiogubbins/storage';
import { MemoryStorageTree } from '@audiogubbins/media-store/testing';
import {
  TreeFailure,
  TreeFailureKind,
  type ByteSink,
  type StorageTree,
} from '@audiogubbins/project-format';

import { olderStorage, projectWorld } from '../testing/project-context.js';
import { isAbandoned } from './abandoning.js';
import { startProjects } from './project-stores.js';

/**
 * A storage that is full, refusing every write but the caches' own removal,
 * until a cache is given up, as a browser's quota is met and then relieved.
 */
class FullUntilCachesGo extends MemoryStorageTree implements StorageTree {
  full = false;

  override async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.refuseWhileFull();
    await super.writeFile(path, bytes);
  }

  override async createFile(path: string): Promise<ByteSink> {
    this.refuseWhileFull();
    return await super.createFile(path);
  }

  override async remove(path: string): Promise<void> {
    if (path.startsWith('cache/')) this.full = false;
    await super.remove(path);
  }

  private refuseWhileFull(): void {
    if (this.full) throw new TreeFailure(TreeFailureKind.Quota, 'The storage is full.');
  }
}

describe('starting the project system', () => {
  it('opens the storage root, reads the list, and opens the project last open again', async () => {
    const world = projectWorld();
    const first = await world.window();
    await first.runAndHear('file.create-project', { name: 'Harbour' });
    const last = first.projects.preferences.get().lastProject;
    await first.runAndHear('file.close-project');

    const next = await world.window();
    if (last !== undefined) next.projects.preferences.remember(last);
    await startProjects(next.root, next.projects, next.services.logger);

    const open = next.projects.project.get();
    expect(open.kind === 'open' && open.snapshot.model.state.project.displayName).toBe('Harbour');
    expect(next.projects.library.get().loaded).toBe(true);
  });

  it('forgets a project last open that cannot be opened now, rather than trying it at every start', async () => {
    const world = projectWorld();
    const first = await world.window();
    await first.runAndHear('file.create-project', { name: 'Harbour' });
    const last = first.projects.preferences.get().lastProject;
    await first.runAndHear('file.delete-project');

    const next = await world.window();
    if (last !== undefined) next.projects.preferences.remember(last);
    await startProjects(next.root, next.projects, next.services.logger);

    expect(next.projects.project.get().kind).toBe('none');
    expect(next.projects.preferences.get().lastProject).toBeUndefined();
  });

  it('reads nothing of project storage while the stored data is of another version', async () => {
    const window = await projectWorld(await olderStorage()).window();
    window.projects.preferences.remember(window.storage.ids.next<'ProjectId'>());

    await startProjects(window.root, window.projects, window.services.logger);

    expect(window.context.storageRoot.get().kind).toBe('blocked');
    expect(window.projects.project.get().kind).toBe('none');
  });
});

describe('taking the project system down', () => {
  it('gives up the work it started in the storage worker', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });

    const measuring = window.projects.usage.measure();
    window.takeDown();

    await expect(measuring).rejects.toSatisfy(isAbandoned);
  });
});

describe('making room when the storage is full', () => {
  it('gives up the caches and saves what was waiting, without the person', async () => {
    const tree = new FullUntilCachesGo();
    const window = await projectWorld(tree).window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const open = window.projects.project.get();
    const project = open.kind === 'open' ? open.snapshot.project : undefined;
    if (project === undefined) throw new Error('No project opened.');
    await window.storage.caches.put(
      { category: CacheCategory.Waveform, scope: { kind: 'project', project }, name: 'peaks' },
      new Uint8Array(512),
    );

    tree.full = true;
    window.run('file.rename-project', { name: 'Harbour, renamed' });

    // The rename arrives from the worker with the saving it met, so the
    // project is saved once it shows the new name as saved.
    await expect
      .poll(() => {
        const now = window.projects.project.get();
        return now.kind === 'open'
          ? [now.snapshot.model.state.project.displayName, now.snapshot.save.kind]
          : undefined;
      })
      .toEqual(['Harbour, renamed', 'saved']);
    expect(tree.full).toBe(false);
    const usage = await window.storage.caches.usage();
    expect(usage.ok && [...usage.value.values()].reduce((sum, bytes) => sum + bytes, 0)).toBe(0);
  });

  it('leaves the project unsaved, and says why, where no cache can be given up', async () => {
    const tree = new FullUntilCachesGo();
    const window = await projectWorld(tree).window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });

    tree.full = true;
    window.run('file.rename-project', { name: 'Harbour, renamed' });

    await expect
      .poll(() => {
        const now = window.projects.project.get();
        return now.kind === 'open' ? now.snapshot.save : undefined;
      })
      .toMatchObject({ kind: 'not-saved', cause: { code: 'storage.full' } });
  });
});
