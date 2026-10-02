import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectAccess } from '@audiogubbins/storage';

import { projectWorld, type ProjectWindow } from '../testing/project-context.js';

/** How a window may use the project open in it. */
function accessOf(window: ProjectWindow): ProjectAccess | undefined {
  const open = window.projects.project.get();
  return open.kind === 'open' ? open.snapshot.access : undefined;
}

/** Two windows of one browser, the first writing a project and the second reading it. */
async function twoWindows(): Promise<{
  readonly writer: ProjectWindow;
  readonly reader: ProjectWindow;
}> {
  const world = projectWorld();
  const writer = await world.window();
  await writer.runAndHear('file.create-project', { name: 'Harbour' });
  const reader = await world.window();
  const [entry] = reader.projects.library.get().entries;
  const project = entry?.kind === 'project' ? entry.header.id : '';
  expect(await reader.runAndHear('file.open', { project })).toBe('"Harbour" is open to read.');
  return { writer, reader };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a project another window is changing', () => {
  it('opens to read, naming the window changing it', async () => {
    const { reader } = await twoWindows();

    expect(accessOf(reader)).toEqual({
      kind: 'read-only',
      reason: {
        kind: 'busy',
        owner: { instance: 'window-1', label: 'the tab opened at 10:01:00' },
      },
    });
    expect(reader.run('project.request-control').kind).toBe('applied');
    expect(reader.run('project.open-to-change').kind).toBe('refused');
  });

  it('is handed over when asked, and the window that had it reads it, naming the other', async () => {
    const { writer, reader } = await twoWindows();

    const answered = reader.nextSaid();
    reader.run('project.request-control');
    await expect
      .poll(() => accessOf(writer))
      .toMatchObject({
        kind: 'writable',
        transferRequests: [{ from: { label: 'the tab opened at 10:02:00' } }],
      });

    expect(await writer.runAndHear('project.hand-over')).toBe(
      '"Harbour" is handed over, and open to read here.',
    );
    expect(await answered).toBe('You can change "Harbour" now.');
    expect(accessOf(reader)?.kind).toBe('writable');
    await expect
      .poll(() => accessOf(writer))
      .toEqual({
        kind: 'read-only',
        reason: {
          kind: 'busy',
          owner: { instance: 'window-2', label: 'the tab opened at 10:02:00' },
        },
      });
  });

  it('is kept when the window changing it declines, and says so to the window that asked', async () => {
    const { writer, reader } = await twoWindows();

    const answered = reader.nextSaid();
    reader.run('project.request-control');
    await expect.poll(() => writer.run('project.keep').kind).toBe('applied');

    expect(await answered).toBe('The other tab kept "Harbour".');
    expect(accessOf(writer)).toEqual({ kind: 'writable', transferRequests: [] });
    expect(accessOf(reader)?.kind).toBe('read-only');
  });

  it('is not offered to take over while the window changing it may yet answer, or after it kept it', async () => {
    const { writer, reader } = await twoWindows();

    expect(reader.run('project.take-over')).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'Ask the tab changing it first. It can be taken over once a request goes unanswered.',
        },
      ],
    });
    const answered = reader.nextSaid();
    reader.run('project.request-control');
    await expect.poll(() => writer.run('project.keep').kind).toBe('applied');
    await answered;
    expect(reader.run('project.take-over').kind).toBe('refused');
  });

  it('is taken over once a request went unanswered and the decision is made, and the window that lost it is told who took it', async () => {
    const { writer, reader } = await twoWindows();
    // The window changing it does not answer in time.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => AbortSignal.abort());

    expect(await reader.runAndHear('project.request-control')).toBe(
      'The tab changing "Harbour" did not answer. You can take it over instead.',
    );
    expect(await reader.runAndHear('project.take-over')).toBe(
      '"Harbour" is yours to change. The other tab can no longer change it.',
    );
    expect(accessOf(reader)?.kind).toBe('writable');
    expect(accessOf(writer)).toEqual({
      kind: 'lost',
      loss: { kind: 'taken', by: { instance: 'window-2', label: 'the tab opened at 10:02:00' } },
      unsaved: 0,
    });
    expect(writer.run('file.rename-project', { name: 'Mine' }).kind).toBe('refused');

    expect(await writer.runAndHear('project.open-to-read')).toBe('"Harbour" is open to read.');
  });

  it('offers nothing to hand over or keep where nobody asked, and nothing to take where none holds it', async () => {
    const { writer, reader } = await twoWindows();

    expect(writer.run('project.hand-over').kind).toBe('refused');
    expect(writer.run('project.keep').kind).toBe('refused');
    expect(writer.run('project.take-over').kind).toBe('refused');
    expect(writer.run('project.open-to-read').kind).toBe('refused');
    expect(reader.run('project.open-to-read').kind).toBe('refused');
  });
});

describe('a project a window holds that can no longer answer', () => {
  it('is asked for first, and a request gone unanswered no longer stands once the window lets it go', async () => {
    const world = projectWorld();
    const maker = await world.window();
    await maker.runAndHear('file.create-project', { name: 'Harbour' });
    await maker.runAndHear('file.close-project');
    const [entry] = maker.projects.library.get().entries;
    const project = entry?.kind === 'project' ? entry.header.id : undefined;
    if (project === undefined) throw new Error('No project was made.');
    // A window that took the project and stopped: it hears no request.
    const stopped = await world.coordinator.acquire(project, {
      steal: false,
      owner: { instance: 'stopped', label: 'a tab that stopped' },
    });
    const reader = await world.window();
    await reader.runAndHear('file.open', { project });

    expect(reader.run('project.take-over').kind).toBe('refused');
    expect(await reader.runAndHear('project.request-control')).toBe(
      'The tab changing "Harbour" did not answer. You can take it over instead.',
    );
    const open = reader.projects.project.get();
    expect(open.kind === 'open' && open.request).toBe('unanswered');

    if (stopped.kind !== 'held') throw new Error('The stopped window holds no lease.');
    await stopped.lease.release();
    await expect
      .poll(() => accessOf(reader))
      .toEqual({ kind: 'read-only', reason: { kind: 'released' } });
    const after = reader.projects.project.get();
    expect(after.kind === 'open' && after.request).toBeUndefined();
    expect(reader.run('project.take-over').kind).toBe('refused');
  });
});

describe('the open project upkeep', () => {
  it('has no recovery report to dismiss after a clean opening, and nothing to save again', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });

    expect(window.run('project.dismiss-recovery').kind).toBe('refused');
    expect(window.run('project.retry-save').kind).toBe('refused');
  });
});
