import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { unsafeBrandId } from '@audiogubbins/domain';
import type { ProjectHeader } from '@audiogubbins/storage';

import { renderInTheShell } from '../../testing/in-the-shell.js';
import { DeletedProjects } from './deleted-projects.js';

const CUT_SHORT: ProjectHeader = {
  generation: 3,
  id: unsafeBrandId('0000aaaa-0000-4000-8000-000000000001'),
  name: 'Old tide',
  created: 1_000,
  deleted: 2_000,
  purging: 3_000,
};

describe('a deleted project whose purge was cut short', () => {
  it('offers no restoring, only finishing the purge the person confirmed', async () => {
    const run = vi.fn((_id: string, _args?: unknown) => true);
    renderInTheShell(<DeletedProjects headers={[CUT_SHORT]} run={run} />);

    expect(screen.queryByRole('button', { name: 'Restore “Old tide”' })).toBeNull();
    expect(
      screen.getByText('Purging was cut short, so it can no longer be restored.'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Finish purging “Old tide”' }));
    expect(run).toHaveBeenCalledWith('file.purge-project', {
      project: CUT_SHORT.id,
      deletedAt: CUT_SHORT.deleted,
    });
  });
});
