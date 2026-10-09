import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { failure, FailureKind, unsafeBrandId } from '@audiogubbins/domain';
import type { ProjectAccess, ProjectRecoveryReport, ProjectSnapshot } from '@audiogubbins/storage';

import { observable, type Observable } from '../state/observable.js';
import type { OpenProjectState } from '../state/open-project-store.js';
import type { QuickEditSession } from '../state/quick-edit-store.js';
import type { StorageRootState } from '../state/storage-root-store.js';
import { projectWorld } from '../testing/project-context.js';
import { ProjectBanner } from './project-banner.js';

/** A snapshot of a real project, made once, whose access each test sets. */
let made: ProjectSnapshot;

beforeAll(async () => {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'Harbour' });
  const open = window.projects.project.get();
  if (open.kind !== 'open') throw new Error('No project opened.');
  made = open.snapshot;
});

const OTHER = { instance: 'window-2', label: 'the tab opened at 10:02:00' };

/** Draws the banner over the root and the open project given, and what it runs and says. */
function banner(
  root: StorageRootState,
  open: OpenProjectState,
  quickEdit?: Observable<QuickEditSession | undefined>,
) {
  const project = observable(open);
  const run = vi.fn((_id: string, _args?: unknown) => true);
  const announce = vi.fn();
  render(
    <ProjectBanner
      root={observable(root)}
      project={project}
      quickEdit={quickEdit}
      run={run}
      announce={announce}
    />,
  );
  return { project, run, announce, strip: screen.getByRole('region', { name: 'Project' }) };
}

/** The open project, with this window's access to it. */
function openWith(
  access: ProjectAccess,
  report?: ProjectRecoveryReport,
): Extract<OpenProjectState, { kind: 'open' }> {
  return {
    kind: 'open',
    snapshot: { ...made, access },
    ...(report === undefined ? {} : { report }),
  };
}

describe('the project strip, where projects cannot be reached', () => {
  it('says why the browser keeps none, and opens the panel that says more', async () => {
    const { run, strip } = banner(
      { kind: 'unavailable', reason: 'This browser cannot keep projects.' },
      { kind: 'none' },
    );

    expect(within(strip).getByText('This browser cannot keep projects.')).toBeVisible();
    await userEvent.click(
      within(strip).getByRole('button', { name: 'Show the Capabilities panel' }),
    );
    expect(run).toHaveBeenCalledWith('workspace.show-capabilities');
  });

  it('says the stored data waits for a decision once it is set aside, and brings the screen back', async () => {
    const { run, strip } = banner(
      {
        kind: 'blocked',
        data: { kind: 'incompatible', schema: 'projectStorage', found: 0, current: 2 },
        shown: false,
      },
      { kind: 'none' },
    );

    expect(within(strip).getByText(/made by another version of AudioGubbins/)).toBeVisible();
    await userEvent.click(within(strip).getByRole('button', { name: 'Decide now' }));
    expect(run).toHaveBeenCalledWith('storage.review');
  });

  it('says why the storage could not be read', () => {
    const cause = failure(
      'storage.unavailable',
      FailureKind.Retryable,
      'The storage cannot be reached.',
    );
    const { strip } = banner({ kind: 'failed', cause }, { kind: 'none' });

    expect(
      within(strip).getByText('Your projects could not be read. The storage cannot be reached.'),
    ).toBeVisible();
  });
});

describe('the project strip, with projects to reach', () => {
  it('offers to make or open a project, or to Quick Edit a file, where none is open', async () => {
    const { run, strip } = banner({ kind: 'ready' }, { kind: 'none' });

    await userEvent.click(within(strip).getByRole('button', { name: 'New project…' }));
    await userEvent.click(within(strip).getByRole('button', { name: 'Open project…' }));
    await userEvent.click(within(strip).getByRole('button', { name: 'Quick Edit a file…' }));
    expect(run.mock.calls).toEqual([
      ['file.projects', { section: 'new' }],
      ['file.projects', { section: 'open' }],
      ['file.quick-edit'],
    ]);
  });

  it('names the file a Quick Edit is of, and the project it is kept in', () => {
    const quickEdit = observable<QuickEditSession | undefined>(undefined);
    const { strip } = banner(
      { kind: 'ready' },
      openWith({ kind: 'writable', transferRequests: [] }),
      quickEdit,
    );
    expect(within(strip).getByText('“Harbour”')).toBeVisible();

    act(() => {
      quickEdit.set({
        project: made.project,
        asset: unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000a1'),
        fileName: 'Harbour.wav',
      });
    });

    expect(
      within(strip).getByText('Quick Edit of “Harbour.wav”, kept in the project “Harbour”'),
    ).toBeVisible();
  });

  it('names the project open to change, and says nothing more', () => {
    const { strip } = banner(
      { kind: 'ready' },
      openWith({ kind: 'writable', transferRequests: [] }),
    );

    expect(within(strip).getByText('“Harbour”')).toBeVisible();
    expect(within(strip).queryAllByRole('button')).toEqual([]);
  });

  it('names the tab changing a project open to read, and asks for it before anything else', async () => {
    const { run, strip } = banner(
      { kind: 'ready' },
      openWith({ kind: 'read-only', reason: { kind: 'busy', owner: OTHER } }),
    );

    expect(
      within(strip).getByText(
        '“Harbour” is open to read here, because the tab opened at 10:02:00 is changing it.',
      ),
    ).toBeVisible();
    await userEvent.click(within(strip).getByRole('button', { name: 'Ask to change it' }));
    expect(run).toHaveBeenLastCalledWith('project.request-control');
    expect(within(strip).queryByRole('button', { name: 'Take over…' })).toBeNull();
  });

  it('offers to take the project over once a request went unanswered, and only once the cost is read', async () => {
    const { run, strip } = banner(
      { kind: 'ready' },
      {
        ...openWith({ kind: 'read-only', reason: { kind: 'busy', owner: OTHER } }),
        request: 'unanswered',
      },
    );

    expect(
      within(strip).getByText(
        '“Harbour” is open to read here, because the tab opened at 10:02:00 is changing it.',
      ),
    ).toBeVisible();
    expect(
      within(strip).getByText('The tab changing it did not answer, so you can take it over.'),
    ).toBeVisible();
    await userEvent.click(within(strip).getByRole('button', { name: 'Ask again' }));
    expect(run).toHaveBeenLastCalledWith('project.request-control');

    await userEvent.click(within(strip).getByRole('button', { name: 'Take over…' }));
    expect(
      within(strip).getByText(
        /stops the other tab changing it at once\. Anything it has not saved yet is lost\./,
      ),
    ).toBeVisible();
    expect(run).not.toHaveBeenCalledWith('project.take-over');
    // Focus stays in the strip as the button pressed goes.
    await waitFor(() => {
      expect(within(strip).getByRole('button', { name: 'Take over now' })).toHaveFocus();
    });

    await userEvent.click(within(strip).getByRole('button', { name: 'Take over now' }));
    expect(run).toHaveBeenLastCalledWith('project.take-over');
  });

  it('keeps the request button in reach while it waits, doing nothing when pressed', async () => {
    const { run, strip } = banner(
      { kind: 'ready' },
      {
        ...openWith({ kind: 'read-only', reason: { kind: 'busy', owner: OTHER } }),
        request: 'asking',
      },
    );

    const asking = within(strip).getByRole('button', { name: 'Asking…' });
    expect(asking).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(asking);
    expect(run).not.toHaveBeenCalled();
  });

  it("puts another tab's request to the tab changing the project, aloud, and answers it", async () => {
    const { run, announce, strip } = banner(
      { kind: 'ready' },
      openWith({ kind: 'writable', transferRequests: [{ id: 'request-1', from: OTHER }] }),
    );

    expect(announce).toHaveBeenCalledWith(
      'The tab opened at 10:02:00 asks to change “Harbour”. Hand it over, and this tab can only read it until you ask for it back.',
      true,
    );
    await userEvent.click(within(strip).getByRole('button', { name: 'Hand it over' }));
    await userEvent.click(within(strip).getByRole('button', { name: 'Keep it' }));
    expect(run.mock.calls).toEqual([
      ['project.hand-over', { request: 'request-1' }],
      ['project.keep', { request: 'request-1' }],
    ]);
  });

  it('says aloud who took the project over, and what was lost, and offers to read it', async () => {
    const { project, run, announce, strip } = banner(
      { kind: 'ready' },
      openWith({ kind: 'writable', transferRequests: [] }),
    );

    act(() => {
      project.set(openWith({ kind: 'lost', loss: { kind: 'taken', by: OTHER }, unsaved: 2 }));
    });

    const said =
      'The tab opened at 10:02:00 took “Harbour” over, so this tab can no longer change it. 2 changes not yet saved here were lost.';
    expect(within(strip).getByText(said)).toBeVisible();
    expect(announce).toHaveBeenCalledWith(said, true);
    await userEvent.click(within(strip).getByRole('button', { name: 'Open to read' }));
    expect(run).toHaveBeenCalledWith('project.open-to-read');
  });

  it('offers to change a project nobody is changing any more', async () => {
    const { run, strip } = banner(
      { kind: 'ready' },
      openWith({ kind: 'read-only', reason: { kind: 'released' } }),
    );

    expect(within(strip).getByText(/No tab is changing “Harbour” now/)).toBeVisible();
    await userEvent.click(within(strip).getByRole('button', { name: 'Open to change' }));
    expect(run).toHaveBeenCalledWith('project.open-to-change');
  });

  it('says what recovery found in plain words, once, and puts it away when asked', async () => {
    const report: ProjectRecoveryReport = {
      head: { epoch: 2, generation: 3 },
      fallbacks: [{ path: 'heads/x.json', reason: { kind: 'head-fenced' } }],
      replayed: 4,
      fenced: [],
      missingStates: [],
      interruptedRecordings: [],
    };
    const { run, announce, strip } = banner(
      { kind: 'ready' },
      openWith({ kind: 'writable', transferRequests: [] }, report),
    );

    const said =
      'When “Harbour” was opened, some of it had to be recovered. The newest save could not be read, so the project was opened from the one before it.';
    expect(within(strip).getByText(said)).toBeVisible();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(said, false);
    await userEvent.click(within(strip).getByRole('button', { name: 'Dismiss' }));
    expect(run).toHaveBeenCalledWith('project.dismiss-recovery');
  });
});
