import { describe, expect, it } from 'vitest';

import { projectWorld, type ProjectWindow } from '../testing/project-context.js';
import { ScriptedFolderPort } from '../testing/scripted-folder.js';

/**
 * The backups folder (REQ-STOR-105): chosen through the picker, kept by the
 * browser, waiting after a reload for the person's leave to write to it
 * again, and each backup of a policy that asks for it copied there as a
 * bundle, with what became of the copy said beside the backups.
 */

/** A window with a project open, whose policy copies each backup to the folder. */
async function copyingWindow(port: ScriptedFolderPort): Promise<ProjectWindow> {
  const window = await projectWorld().window({ backupFolder: port });
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  await window.runAndHear('backup.set-policy', {
    kind: 'automatic',
    everyMinutes: 30,
    external: true,
  });
  return window;
}

describe('the backups folder', () => {
  it('waits for leave to write after a reload, keeping backups in the browser meanwhile', async () => {
    const port = new ScriptedFolderPort();
    const window = await copyingWindow(port);
    expect(window.projects.backupFolder.get()).toEqual({
      kind: 'chosen',
      name: 'Backups',
      access: 'permission-needed',
    });

    await window.runAndHear('file.back-up-now');
    expect(window.projects.backups.get().generations).toHaveLength(1);
    expect(window.projects.backups.get().copied).toMatchObject({
      kind: 'failed',
      failure: { code: 'storage.unavailable' },
    });
    expect(port.folder.files.size).toBe(0);

    expect(await window.runAndHear('backup.allow-folder')).toBe(
      'Backups are copied to “Backups” as the backup settings ask.',
    );
    await window.runAndHear('file.back-up-now');
    expect(window.projects.backups.get().copied).toEqual({ kind: 'written' });
    const [name] = [...port.folder.files.keys()];
    expect(name).toMatch(
      /^Harbour \([0-9a-f]{8}\), backup of \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.zip$/u,
    );
    expect(port.folder.files.get(name ?? '')).toBeGreaterThan(0);
  });

  it('copies nothing where the policy does not ask, whatever folder is chosen', async () => {
    const port = new ScriptedFolderPort();
    port.kept = 'granted';
    const window = await copyingWindow(port);
    await window.runAndHear('backup.set-policy', { kind: 'automatic', everyMinutes: 30 });

    await window.runAndHear('file.back-up-now');

    expect(window.projects.backups.get().copied).toBeUndefined();
    expect(port.folder.files.size).toBe(0);
  });

  it('says a refusal of leave, and chooses a folder afresh', async () => {
    const port = new ScriptedFolderPort();
    port.answer = 'denied';
    const window = await copyingWindow(port);

    expect(await window.runAndHear('backup.allow-folder')).toBe(
      'The browser refused to let AudioGubbins write to “Backups”, so backups stay in its own storage.',
    );
    expect(await window.runAndHear('backup.choose-folder')).toBe(
      'Backups are copied to “Backups” as the backup settings ask.',
    );
    expect(window.run('backup.allow-folder').kind).toBe('refused');
  });

  it('lets the folder go, leaving what is in it', async () => {
    const port = new ScriptedFolderPort();
    port.kept = 'granted';
    const window = await copyingWindow(port);
    await window.runAndHear('file.back-up-now');

    expect(await window.runAndHear('backup.forget-folder')).toMatch(/no longer copied/u);
    expect(window.projects.backupFolder.get()).toEqual({ kind: 'none' });
    expect(port.folder.files.size).toBe(1);
    expect(window.run('backup.forget-folder').kind).toBe('refused');
  });

  it('offers no folder where the browser gives none, and says backups stay in the browser', async () => {
    const window = await projectWorld().window();

    expect(window.projects.backupFolder.get()).toEqual({ kind: 'unsupported' });
    const refused = window.run('backup.choose-folder');
    expect(refused.kind).toBe('refused');
    expect(refused.kind === 'refused' ? refused.failures[0].summary : '').toMatch(
      /stay in its own storage/u,
    );
  });
});
