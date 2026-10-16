import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FadeShape } from '@audiogubbins/domain';
import type { GameAssetGroup } from '@audiogubbins/game-audio';
import { addGroupInvocation, assignMemberInvocation } from '@audiogubbins/project-commands';
import { sine } from '@audiogubbins/test-fixtures';

import { WorkflowCommand } from '../../commands/workflow-command-ids.js';
import { renderInTheShell } from '../../testing/in-the-shell.js';
import { holdPlatformFiles, windowWithAudio } from '../../testing/project-audio.js';
import { WorkflowDialog } from './workflow-dialog.js';

holdPlatformFiles();

/**
 * `workflow` open over a group of two regions nobody has analysed, neither
 * looped, and the commands the dialog ran.
 */
async function shown(workflow = 'workflow.prepare-one-shot') {
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
  window.run(workflow, { group: group.id });
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
  return { ran, window, regions };
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

  it(
    'analyses the whole of a region that does not loop as the loop Create Seamless Loop asks for',
    { timeout: 180_000 },
    async () => {
      // The workflow asks for the whole region where it has no loop; read as
      // the Loop panel reads a region, one that does not loop could not be
      // analysed.
      const { window, regions } = await shown('workflow.create-seamless-loop');
      const dialog = screen.getByRole('dialog', { name: 'Create Seamless Loop' });
      expect(dialog).not.toHaveTextContent('does not loop');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Analyse' }));

      // The regions are analysed one at a time, the first at once.
      expect(dialog).toHaveTextContent('Analysing “Ding”, 1 of 2.');
      const [first] = regions;
      expect(first && window.context.loopAnalysis.analyses.of(first.id)?.request.loop).toEqual({
        start: 0,
        end: 24_000,
        crossfadeLength: 0,
        crossfadeShape: FadeShape.EqualPower,
      });
      // And the worker measures it, rather than refusing a loop as long as the region.
      await expect
        .poll(() => first && window.context.loopAnalysis.analyses.of(first.id)?.kind, {
          timeout: 120_000,
        })
        .toBe('done');
    },
  );
});
