import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { projectWorld } from '../testing/project-context.js';
import { BackupStatus } from './backup-status.js';

/** Room for opening the project and one change, and too little for any backup. */
const ROOM = 2_000;

/** What else the storage holds, which a test removes to make room for a backup. */
const HELD = new Uint8Array(8_000);
const HELD_PATH = 'held.bin';

/** The bytes a storage holds, counted as its quota counts them. */
function bytesIn(files: ReadonlyMap<string, Uint8Array>): number {
  let bytes = 0;
  for (const body of files.values()) bytes += body.byteLength;
  return bytes;
}

/**
 * A window with a project whose policy makes a backup after each change, over
 * a storage with room for the project's own writes and none for a backup.
 */
async function fullWhenBackingUp() {
  const first = projectWorld();
  const making = await first.window();
  await making.runAndHear('file.create-project', { name: 'Harbour' });
  await making.runAndHear('backup.set-policy', { kind: 'automatic', everyChanges: 1 });
  await making.runAndHear('file.close-project');
  const [entry] = making.projects.library.get().entries;
  const project = entry?.kind === 'project' ? entry.header.id : undefined;
  if (project === undefined) throw new Error('No project was made.');

  const tree = first.tree.restarted({
    quotaBytes: bytesIn(first.tree.snapshot()) + ROOM + HELD.byteLength,
  });
  await tree.writeFile(HELD_PATH, HELD);
  // The second window of the world over it, whose identifiers are drawn from
  // another seed than the window that made the project.
  const full = projectWorld(tree);
  await full.window();
  const window = await full.window();
  await window.runAndHear('file.open', { project });
  await window.runAndHear('file.rename-project', { name: 'Harbour at dusk' });
  return { window, makeRoom: () => tree.remove(HELD_PATH) };
}

describe('whether the backups the policy asks for are made', () => {
  it('says a scheduled backup was not made, aloud once, until one is', async () => {
    const { window, makeRoom } = await fullWhenBackingUp();
    const run = vi.fn((_id: string, _args?: unknown) => true);
    const announce = vi.fn();
    render(<BackupStatus backups={window.projects.backups} run={run} announce={announce} />);
    expect(screen.queryByText(/^Backup not made\./u)).toBeNull();

    await act(async () => {
      await window.projects.backups.tick();
      await window.projects.backups.tick();
    });

    const { missed } = window.projects.backups.get();
    expect(missed).toBeDefined();
    expect(screen.getByText(`Backup not made. ${missed ?? ''}`)).toBeVisible();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(`A backup was not made. ${missed ?? ''}`, true);
    await userEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(run).toHaveBeenCalledWith('file.back-up-now');

    await makeRoom();
    await window.runAndHear('file.rename-project', { name: 'Harbour at night' });
    await act(async () => {
      await window.projects.backups.tick();
    });
    expect(window.projects.backups.get().generations).toHaveLength(1);
    expect(screen.queryByText(/^Backup not made\./u)).toBeNull();
  });
});
