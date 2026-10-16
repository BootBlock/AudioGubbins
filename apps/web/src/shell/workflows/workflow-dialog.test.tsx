import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { GameAssetGroup } from '@audiogubbins/game-audio';
import { addGroupInvocation, assignMemberInvocation } from '@audiogubbins/project-commands';
import { sine } from '@audiogubbins/test-fixtures';

import { WorkflowCommand } from '../../commands/workflow-command-ids.js';
import { renderInTheShell } from '../../testing/in-the-shell.js';
import { holdPlatformFiles, windowWithAudio } from '../../testing/project-audio.js';
import { WorkflowDialog } from './workflow-dialog.js';

holdPlatformFiles();

/** Prepare One-Shot open over a group of two regions nobody has analysed, and the commands the dialog ran. */
async function shown() {
  const audio = await windowWithAudio({
    fixture: sine(440, { length: 48_000 }),
    name: 'Bell',
    regions: [
      { name: 'Ding', start: 0, end: 24_000 },
      { name: 'Dong', start: 24_000, end: 48_000 },
    ],
  });
  const { window, session } = audio;
  const group: GameAssetGroup = {
    id: window.storage.ids.next<'GameAssetGroupId'>(),
    name: 'Bells',
    policy: {},
  };
  const regions = [...session.getSnapshot().model.state.project.regions.values()];
  await session.runGroup('Group the bells', [
    addGroupInvocation(group),
    ...regions.map((region) =>
      assignMemberInvocation({ kind: 'region', region: region.id }, group.id, 'inherit'),
    ),
  ]);
  window.run('workflow.prepare-one-shot', { group: group.id });
  const ran: string[] = [];
  renderInTheShell(
    <WorkflowDialog
      context={window.context}
      stores={window.projects}
      run={(id, args) => {
        ran.push(id);
        return window.run(id, args).kind !== 'refused';
      }}
      unavailableReason={() => undefined}
    />,
  );
  return { ran, window };
}

describe('a guided workflow’s dialog', () => {
  it('shows what it runs on, each option’s source, and every item before anything runs', async () => {
    await shown();

    const dialog = screen.getByRole('dialog', { name: 'Prepare One-Shot' });
    expect(within(dialog).getByRole('combobox', { name: 'Run it on' })).toHaveTextContent(
      'The group “Bells”, 2 sounds',
    );
    expect(within(dialog).getAllByText('The workflow’s default').length).toBeGreaterThan(0);
    const items = within(dialog)
      .getAllByRole('listitem')
      .filter((item) => item.classList.contains('ag-workflow-item'));
    expect(items.map((item) => item.querySelector('.ag-workflow-item-name')?.textContent)).toEqual([
      '“Ding”',
      '“Dong”',
    ]);
    for (const item of items) {
      expect(item).toHaveTextContent('Refused');
      expect(item).toHaveTextContent('has not been analysed yet');
    }
    expect(within(dialog).getByText('0 items to change, 2 refused.')).toBeInTheDocument();
  });

  it('leaves refused items out and analyses through its commands', async () => {
    const { ran } = await shown();
    const dialog = screen.getByRole('dialog', { name: 'Prepare One-Shot' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave these out' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Analyse' }));

    expect(ran).toEqual([WorkflowCommand.LeaveOutRefused, WorkflowCommand.Analyse]);
    expect(within(dialog).getAllByText('Skipped')).toHaveLength(2);
  });
});
