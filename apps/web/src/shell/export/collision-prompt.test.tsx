import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { exportBatch, plannedExport } from '@audiogubbins/import-export';

import { ExportCommand } from '../../commands/import-export-ids.js';
import type { ExportRunState } from '../../export/export-types.js';
import { observable } from '../../state/observable.js';
import { renderInTheShell } from '../../testing/in-the-shell.js';
import { shownRun } from '../../testing/export-states.js';
import { CollisionPrompt } from './collision-prompt.js';

/** A batch of `files` files, the first asking about a taken name. */
function asking(files: number): ExportRunState {
  const jobs = Array.from({ length: files }, (_, index) =>
    plannedExport(`export-${String(index + 1)}`, 48_000),
  );
  return { kind: 'running', ...shownRun(exportBatch(jobs)), asking: 'Loop.wav' };
}

function promptOver(state: ExportRunState) {
  const run = vi.fn((_id: string, _args?: unknown) => true);
  renderInTheShell(<CollisionPrompt exports={observable(state)} run={run} />);
  return { run };
}

describe('the question about a taken name (ADR-0092)', () => {
  it('is not asked while nothing is', () => {
    promptOver({ kind: 'idle' });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the file, offers keeping both first, and replaces nothing by default', () => {
    promptOver(asking(1));
    const dialog = screen.getByRole('dialog', { name: 'File already exists' });

    expect(dialog).toHaveAccessibleDescription('A file named “Loop.wav” is there already.');
    expect(
      within(dialog)
        .getAllByRole('button')
        .filter((button) => button.getAttribute('aria-label') !== 'Close')
        .map((button) => button.textContent),
    ).toEqual(['Keep both', 'Replace', 'Skip']);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });

  it('answers for the rest of the batch where the person ticks it, from the keyboard', async () => {
    const user = userEvent.setup();
    const { run } = promptOver(asking(3));
    const dialog = screen.getByRole('dialog');
    const rest = within(dialog).getByRole('checkbox', { name: 'Do the same for the rest' });

    rest.focus();
    await user.keyboard(' ');
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Keep both' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(run).toHaveBeenCalledWith(ExportCommand.AnswerCollision, {
      answer: 'rename',
      applyToAll: true,
    });
  });

  it('skips the file where the question is closed', async () => {
    const user = userEvent.setup();
    const { run } = promptOver(asking(2));

    await user.keyboard('{Escape}');

    expect(run).toHaveBeenCalledWith(ExportCommand.AnswerCollision);
  });
});
