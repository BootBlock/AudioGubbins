import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import { CacheCategory, type CleanupPlan, type StorageUsage } from '@audiogubbins/storage';

import { observable } from '../../state/observable.js';
import type { LibraryState } from '../../state/project-library-store.js';
import type { StorageUsageState } from '../../state/storage-usage-store.js';
import { StoragePanel } from './storage-panel.js';

const USAGE: StorageUsage = {
  journal: 2_048,
  namedSnapshots: 0,
  alternativeBranches: 1_024,
  recoveryCheckpoints: 4_096,
  sourceMedia: 3 * 2 ** 20,
  retainedDeletedMedia: {
    namedSnapshots: 2 ** 20,
    undo: 2 * 2 ** 20,
    alternativeBranches: 4_096,
    elsewhere: 256,
  },
  unreferencedMedia: 512,
  caches: new Map([[CacheCategory.Waveform, 10_240]]),
  backups: 8_192,
  unreadable: [],
};

/** A plan of a cache, which is made again, and of media nothing uses, which is not. */
const PLAN: CleanupPlan = {
  steps: [
    { kind: 'cache', category: CacheCategory.Waveform, bytes: 10_240, loses: 'nothing' },
    {
      kind: 'unreferenced-media',
      bytes: 512,
      loses: 'unreferenced-media',
      collection: { unreachable: [], reclaimableBytes: 512 },
    },
  ],
  confirmationBytes: 512,
};

/** A project the library lists, which a cleanup's steps name. */
const HARBOUR = unsafeBrandId<'ProjectId'>('00000000-0000-4000-8000-00000000b0b0');

/** A plan letting history of the project go, and backups of it. */
const HISTORY_PLAN: CleanupPlan = {
  steps: [
    {
      kind: 'expired-backups',
      bytes: 4_096,
      loses: 'backup-generations',
      generations: new Map([[HARBOUR, [1, 2]]]),
      at: 1_790_000_000_000,
    },
    {
      kind: 'expired-history',
      bytes: 8_192,
      loses: 'history',
      compactions: new Map([
        [
          HARBOUR,
          {
            project: HARBOUR,
            removable: [],
            reclaimableBytes: 8_192,
            remainingBytes: 0,
            withinBudget: true,
            lost: [
              {
                kind: 'branch',
                first: unsafeBrandId<'HistoryNodeId'>('n1'),
                forkPoint: unsafeBrandId<'HistoryNodeId'>('n0'),
                changes: 3,
                latestAt: 1_790_000_000_000,
              },
            ],
          },
        ],
      ]),
    },
  ],
  confirmationBytes: 12_288,
};

/** Draws the panel over the usage given, and what it runs. */
function panelOver(usage: StorageUsageState, unavailable?: string) {
  const run = vi.fn((_id: string, _args?: unknown) => true);
  const library = observable<LibraryState>({
    entries: [
      { kind: 'project', header: { generation: 1, id: HARBOUR, name: 'Harbour', created: 1 } },
    ],
    loaded: true,
  });
  render(
    <StoragePanel
      title="Storage"
      usage={observable(usage)}
      library={library}
      run={run}
      unavailable={unavailable}
    />,
  );
  return { run };
}

describe('the Storage panel', () => {
  it('measures the storage as it is first shown, where it can', () => {
    const { run } = panelOver({});
    expect(run).toHaveBeenCalledWith('storage.measure');
  });

  it('says why and measures nothing where projects cannot be reached', () => {
    const { run } = panelOver({}, 'This browser cannot keep projects.');

    expect(screen.getByText('This browser cannot keep projects.')).toBeVisible();
    expect(run).not.toHaveBeenCalledWith('storage.measure');
  });

  it('lists what each part of the storage takes, as a person calls it', () => {
    panelOver({ usage: USAGE });

    const parts = screen
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextSibling?.textContent]);
    expect(parts).toContainEqual(['Audio in use', '3 MB']);
    expect(parts).toContainEqual(['Recent changes not yet in a save point', '2 kB']);
    expect(parts).toContainEqual(['Audio nothing uses', '512 bytes']);
    expect(parts).toContainEqual(['Waveforms', '10 kB']);
    expect(parts).toContainEqual(['Audio kept for snapshots', '1 MB']);
    expect(parts).toContainEqual(['Audio kept for undo', '2 MB']);
    expect(parts).toContainEqual(['Audio kept only by other branches', '4 kB']);
    expect(parts).toContainEqual(['Audio kept only by backups and recent changes', '256 bytes']);
  });

  it('says what each step of a cleanup takes, item by item', () => {
    panelOver({ usage: USAGE, plan: HISTORY_PLAN });

    const backups = screen.getByRole('list', {
      name: 'What Backups their policy no longer keeps takes',
    });
    expect(within(backups).getByText('2 backups of "Harbour"')).toBeVisible();
    const history = screen.getByRole('list', {
      name: 'What History the retention settings let go takes',
    });
    expect(
      within(history).getByText(/^"Harbour": The branch of 3 changes, last used .*, would go\.$/),
    ).toBeVisible();
  });

  it('shows a cleanup safest first, each step with its cost, and removes for good only from its confirmation', async () => {
    const { run } = panelOver({ usage: USAGE, plan: PLAN });

    const plan = screen.getByRole('group', { name: 'The planned cleanup' });
    const steps = within(plan).getAllByRole('switch');
    expect(steps.map((step) => step.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    expect(
      within(plan).getByText('Made again when it is needed, so nothing is lost.'),
    ).toBeVisible();
    expect(
      within(plan).getByText('The audio itself goes for good. Nothing refers to it any more.'),
    ).toBeVisible();
    expect(
      within(plan).getByText(
        'This frees 10.5 kB, of which 512 bytes cannot be made again and goes for good.',
      ),
    ).toBeVisible();

    await userEvent.click(within(plan).getByRole('button', { name: 'Remove 512 bytes for good' }));
    expect(run).toHaveBeenLastCalledWith('storage.clean-up', { bytes: 512 });
  });

  it('plans again without a step left out, rather than carrying out a plan the storage did not make', async () => {
    const { run } = panelOver({ usage: USAGE, plan: PLAN });

    const plan = screen.getByRole('group', { name: 'The planned cleanup' });
    await userEvent.click(within(plan).getByRole('switch', { name: /^Audio nothing uses/ }));
    expect(within(plan).queryByRole('button', { name: /for good/ })).toBeNull();
    await userEvent.click(
      within(plan).getByRole('button', { name: 'Plan again without what is left out' }),
    );
    expect(run).toHaveBeenLastCalledWith('storage.plan-cleanup', { choices: 'cache:waveform' });
  });

  it('says that leaving every step out plans nothing, and plans again with none chosen', async () => {
    const { run } = panelOver({ usage: USAGE, plan: PLAN });

    const plan = screen.getByRole('group', { name: 'The planned cleanup' });
    for (const step of within(plan).getAllByRole('switch')) await userEvent.click(step);
    expect(
      within(plan).getByText('Every step is left out, so planning again cleans up nothing.'),
    ).toBeVisible();
    await userEvent.click(
      within(plan).getByRole('button', { name: 'Plan again without what is left out' }),
    );
    expect(run).toHaveBeenLastCalledWith('storage.plan-cleanup', { choices: '' });
  });

  it('clears caches at a press, since nothing is lost, and says why media cannot be purged', async () => {
    const [cache] = PLAN.steps;
    const { run } = panelOver({
      usage: USAGE,
      plan: {
        steps: cache === undefined ? [] : [cache],
        confirmationBytes: 0,
        mediaRefused: { kind: 'no-coordination' },
      },
    });

    expect(screen.getByText(/Audio cannot be purged in this browser/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Clear 10 kB' }));
    expect(run).toHaveBeenLastCalledWith('storage.clean-up');
  });
});
