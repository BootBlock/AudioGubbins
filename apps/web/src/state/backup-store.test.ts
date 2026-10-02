import { describe, expect, it } from 'vitest';

import { projectWorld } from '../testing/project-context.js';
import { BackupStore } from './backup-store.js';

describe('the backups of the project open in a window', () => {
  it('makes and lists a backup through the backups client alone', async () => {
    const window = await projectWorld().window();
    const { projects, services } = window;
    const backups = new BackupStore(
      services.client.backups,
      services.logger,
      new AbortController().signal,
      projects.project,
      projects.library,
      projects.backupFolder.target,
    );
    await window.runAndHear('file.create-project', { name: 'Harbour' });

    const made = await backups.backUpNow();

    expect(made.ok && made.value.kind).toBe('made');
    expect(backups.get().generations).toMatchObject([{ reason: 'manual', protected: true }]);
  });
});
