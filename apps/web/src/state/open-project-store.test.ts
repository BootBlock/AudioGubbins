import { describe, expect, it } from 'vitest';

import type { ProjectId } from '@audiogubbins/domain';

import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { isAbandoned } from './abandoning.js';

/** Makes a project in `window` and closes it again, answering its identifier. */
async function madeAndClosed(window: ProjectWindow, name: string): Promise<ProjectId> {
  await window.runAndHear('file.create-project', { name });
  const session = window.projects.project.session();
  if (session === undefined) throw new Error('No project is open.');
  await window.runAndHear('file.close-project');
  return session.project;
}

/** The name of the project open in `window`, where one is. */
function openName(window: ProjectWindow): string | undefined {
  const open = window.projects.project.get();
  return open.kind === 'open' ? open.snapshot.model.state.project.displayName : undefined;
}

describe('the project open in a window, held in its storage worker', () => {
  it('gives up an opening a newer one replaces, and the worker lets that project go', async () => {
    const world = projectWorld();
    const window = await world.window();
    const harbour = await madeAndClosed(window, 'Harbour');
    const bay = await madeAndClosed(window, 'Bay');

    const replaced = window.projects.project.open(harbour);
    const replacing = window.projects.project.open(bay);

    await expect(replaced).rejects.toSatisfy(isAbandoned);
    expect(await replacing).toEqual({ ok: true, value: 'writable' });
    expect(openName(window)).toBe('Bay');
    await expect.poll(() => world.coordinator.ownerOf(harbour)).toBeUndefined();
  });
});
