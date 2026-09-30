import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { observable } from '../state/observable.js';
import { renderInTheShell } from '../testing/in-the-shell.js';
import type { StorageRootState } from '../state/storage-root-store.js';
import { CompatibilityScreen } from './compatibility-screen.js';

const BLOCKED: StorageRootState = {
  kind: 'blocked',
  data: { kind: 'incompatible', schema: 'projectStorage', found: 0, current: 1 },
  shown: true,
};

/** Draws the screen over the root given, and what it runs. */
function screenOver(state: StorageRootState) {
  const root = observable(state);
  const run = vi.fn((_id: string, _args?: unknown) => true);
  renderInTheShell(<CompatibilityScreen root={root} run={run} />);
  return { root, run };
}

describe('the compatibility screen', () => {
  it('blocks the page with what was found, while the stored data waits for a decision', () => {
    screenOver(BLOCKED);

    const dialogue = screen.getByRole('dialog', { name: 'Your stored projects need a decision' });
    expect(
      within(dialogue).getByText(
        'The projects stored in this browser were saved in storage format 0, and this version of AudioGubbins reads storage format 1.',
      ),
    ).toBeVisible();
  });

  it('says so where the schema of the stored data cannot be told', () => {
    screenOver({
      kind: 'blocked',
      data: { kind: 'unreadable', fault: { kind: 'missing' } },
      shown: true,
    });

    expect(
      screen.getByText(/in a format this version of AudioGubbins cannot recognise/),
    ).toBeVisible();
  });

  it('is not shown once the decision is set aside, nor where nothing blocks', () => {
    const { root } = screenOver({ ...BLOCKED, shown: false });
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      root.set({ kind: 'ready' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('saves a copy of the data, or sets the decision aside, each by its command', async () => {
    const { run } = screenOver(BLOCKED);

    await userEvent.click(screen.getByRole('button', { name: 'Save a copy of the stored data' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decide later' }));
    expect(run.mock.calls).toEqual([['storage.export-raw'], ['storage.set-aside']]);
  });

  it('sets the decision aside when it is closed with Escape', async () => {
    const { run } = screenOver(BLOCKED);

    await userEvent.keyboard('{Escape}');
    expect(run).toHaveBeenCalledWith('storage.set-aside');
  });

  it('removes the data only from its second confirmation, which puts focus on keeping it', async () => {
    const { run } = screenOver(BLOCKED);

    await userEvent.click(screen.getByRole('button', { name: 'Remove the stored data…' }));
    expect(run).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /deletes every project, backup and piece of media kept in this browser for good/,
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Remove the stored data…' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Remove the stored data…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove everything for good' }));
    expect(run).toHaveBeenCalledWith('storage.wipe', { confirmed: 'yes' });
  });

  it('says what is being done while it is', () => {
    screenOver({ ...BLOCKED, working: 'wiping' });

    expect(screen.getByText('Removing the stored data…')).toHaveAttribute('role', 'status');
  });
});
