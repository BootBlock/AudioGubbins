import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { shellCommands } from '../../commands/shell-commands.js';
import { HistoryRowOrders } from '../../state/history-row-orders.js';
import { observable } from '../../state/observable.js';
import type { OpenProjectState } from '../../state/open-project-store.js';
import { countedHistory, longHistory } from '../../testing/long-history.js';
import { addLinkedAsset, linkedFile } from '../../testing/linked-assets.js';
import { projectWorld, type ProjectWindow } from '../../testing/project-context.js';
import { DESCRIPTORS } from '../../testing/shell-context.js';
import { HistoryPanel } from './history-panel.js';

/** Each command's label, by its identifier, as the registry gives it. */
const LABELS: ReadonlyMap<string, string> = new Map(
  shellCommands(DESCRIPTORS).map((command) => [String(command.id), command.label]),
);

/** What a command is called, as the menus call it. */
const labelFor = (id: string): string => LABELS.get(id) ?? id;

/** A project made as A, renamed B then C, undone once and renamed D: a branch after B. */
async function branched(): Promise<ProjectWindow> {
  const window = await projectWorld().window();
  await window.runAndHear('file.create-project', { name: 'A' });
  await window.runAndHear('file.rename-project', { name: 'B' });
  await window.runAndHear('file.rename-project', { name: 'C' });
  await window.runAndHear('edit.undo');
  await window.runAndHear('file.rename-project', { name: 'D' });
  return window;
}

/** Draws the panel over a window's stores, and what it runs. */
function panelOver(
  window: ProjectWindow,
  unavailableReason = (_id: string): string | undefined => undefined,
) {
  const run = vi.fn((_id: string, _args?: unknown) => true);
  render(
    <HistoryPanel
      title="History"
      project={window.projects.project}
      review={window.projects.review}
      rowOrders={window.projects.rowOrders}
      run={run}
      unavailableReason={unavailableReason}
      labelFor={labelFor}
    />,
  );
  return { run, list: () => screen.getByRole('listbox', { name: 'Points in the history' }) };
}

/** The identifier of the change described as `described`. */
function nodeOf(window: ProjectWindow, described: string): string {
  const open = window.projects.project.get();
  if (open.kind !== 'open') throw new Error('No project is open.');
  const node = [...open.snapshot.model.history.nodes.values()].find(
    (one) => one.kind === 'change' && one.description === described,
  );
  return node?.id ?? '';
}

describe('the History panel', () => {
  it('says so where no project is open', () => {
    render(
      <HistoryPanel
        title="History"
        project={observable({ kind: 'none' })}
        review={observable({})}
        rowOrders={new HistoryRowOrders(observable({ kind: 'none' }))}
        run={() => true}
        unavailableReason={() => undefined}
        labelFor={labelFor}
      />,
    );

    expect(
      screen.getByText('No project is open. Its history appears here once one is.'),
    ).toBeVisible();
  });

  it('lists every point in plain words, the branch a step in, and the current one marked and chosen', async () => {
    const window = await branched();
    const { list } = panelOver(window);

    const options = within(list()).getAllByRole('option');
    expect(
      options.map((option) => option.querySelector('.ag-history-row-description')?.textContent),
    ).toEqual([
      'The project was made',
      'Rename project to “B”',
      'Rename project to “C”',
      'Rename project to “D”',
    ]);
    expect(options[2]).toHaveAttribute('data-ag-depth', '1');
    expect(options[3]).toHaveAttribute('aria-selected', 'true');
    expect(within(options[3] ?? list()).getByText('Current')).toBeVisible();
    expect(screen.getByText('3 changes, 1 other branch and 0 snapshots.')).toBeVisible();
  });

  it('moves between points with the arrow keys and goes to one with Enter', async () => {
    const window = await branched();
    const { run, list } = panelOver(window);

    list().focus();
    await userEvent.keyboard('{ArrowUp}');
    const chosen = within(list()).getAllByRole('option')[2];
    expect(chosen).toHaveAttribute('aria-selected', 'true');
    expect(list()).toHaveAttribute('aria-activedescendant', chosen?.id);

    await userEvent.keyboard('{Enter}');
    expect(run).toHaveBeenCalledWith('history.go-to', {
      node: nodeOf(window, 'Rename project to “C”'),
    });

    await userEvent.keyboard('{Home}');
    expect(within(list()).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('finds points by their words, and filters by scope', async () => {
    const window = await branched();
    panelOver(window);

    await userEvent.type(screen.getByRole('textbox', { name: 'Find' }), '“C”');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1);
    await userEvent.clear(screen.getByRole('textbox', { name: 'Find' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Find' }), 'nothing like it');
    expect(screen.getByText('Nothing in the history matches.')).toBeVisible();
  });

  it('offers what can be done at the point chosen, each by its command', async () => {
    const window = await branched();
    const { run, list } = panelOver(window);
    const c = nodeOf(window, 'Rename project to “C”');

    const at = screen.getByRole('group', { name: 'At the chosen point' });
    expect(
      within(at).getByRole('button', { name: 'Go to this point' }),
    ).toHaveAccessibleDescription('The project is at this point already.');

    await userEvent.click(within(list()).getAllByRole('option')[2] ?? list());
    await userEvent.click(
      within(at).getByRole('button', { name: 'Compare with the current state' }),
    );
    expect(run).toHaveBeenLastCalledWith('history.compare', { node: c });
    await userEvent.type(
      within(at).getByRole('textbox', { name: 'Name of this branch' }),
      'Brighter',
    );
    await userEvent.click(within(at).getByRole('button', { name: 'Name the branch' }));
    expect(run).toHaveBeenLastCalledWith('history.name-branch', { node: c, name: 'Brighter' });
    await userEvent.click(within(at).getByRole('button', { name: 'Remove this branch…' }));
    expect(run).toHaveBeenLastCalledWith('history.plan-compaction', { branch: c });
  });

  it('chooses a side to compare first, then compares another point with it', async () => {
    const window = await branched();
    const { run, list } = panelOver(window);
    const c = nodeOf(window, 'Rename project to “C”');
    const at = screen.getByRole('group', { name: 'At the chosen point' });

    await userEvent.click(within(list()).getAllByRole('option')[2] ?? list());
    await userEvent.click(within(at).getByRole('button', { name: 'Choose this point as side A' }));
    expect(run).toHaveBeenLastCalledWith('history.choose-side', { node: c });

    await window.runAndHear('history.choose-side', { node: c });
    expect(
      within(at).getByRole('button', { name: 'Compare this point with side A' }),
    ).toHaveAccessibleDescription('This is side A already.');
    await userEvent.click(within(list()).getByRole('option', { name: /“B”/ }));
    const b = nodeOf(window, 'Rename project to “B”');
    await userEvent.click(
      within(at).getByRole('button', { name: 'Compare this point with side A' }),
    );
    expect(run).toHaveBeenLastCalledWith('history.compare', { node: b, fromNode: c });
    await userEvent.click(within(at).getByRole('button', { name: 'Forget side A' }));
    expect(run).toHaveBeenLastCalledWith('history.choose-side');
  });

  it('keeps a snapshot of the current state with the name typed', async () => {
    const window = await branched();
    const { run } = panelOver(window);

    await userEvent.type(
      screen.getByRole('textbox', { name: /^Snapshot name/ }),
      'Before the mix{Enter}',
    );
    expect(run).toHaveBeenLastCalledWith('history.snapshot', { name: 'Before the mix' });
    expect(screen.getByRole('textbox', { name: /^Snapshot name/ })).toHaveValue('');
  });

  it('keeps a snapshot with the notes typed', async () => {
    const window = await branched();
    const { run } = panelOver(window);

    await userEvent.type(screen.getByRole('textbox', { name: /^Snapshot name/ }), 'Approved');
    await userEvent.type(screen.getByRole('textbox', { name: /^Notes/ }), 'Signed off{Enter}');
    expect(run).toHaveBeenLastCalledWith('history.snapshot', {
      name: 'Approved',
      notes: 'Signed off',
    });
  });

  it('says what each change affected and a snapshot’s notes, and shows only the changes to one entity', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'A' });
    await addLinkedAsset(window, linkedFile('kick.wav', 'kick'), { name: 'Kick' });
    await window.runAndHear('file.rename-project', { name: 'B' });
    await window.runAndHear('history.snapshot', { name: 'Mixed', notes: 'The kick is too loud.' });
    const { list } = panelOver(window);

    const [, added, renamed] = within(list()).getAllByRole('option');
    expect(within(added ?? list()).getByText('Changed asset “Kick”')).toBeVisible();
    expect(
      within(renamed ?? list()).getByText('Changed the project · The kick is too loud.'),
    ).toBeVisible();
    expect(screen.getByText('The kick is too loud.')).toBeVisible();

    await userEvent.click(added ?? list());
    await userEvent.click(
      screen.getByRole('button', { name: 'Show only the changes to asset “Kick”' }),
    );
    expect(
      within(list())
        .getAllByRole('option')
        .map((option) => option.querySelector('.ag-history-row-description')?.textContent),
    ).toEqual(['Add asset “Kick”']);
    expect(screen.getByText('Showing only the changes to asset “Kick”.')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Show every change' }));
    expect(within(list()).getAllByRole('option')).toHaveLength(3);
  });

  it('shows the comparison open, what differs, and switches, keeps and stops by command', async () => {
    const window = await branched();
    await window.runAndHear('history.compare', { node: nodeOf(window, 'Rename project to “C”') });
    const { run } = panelOver(window);

    const comparison = screen.getByRole('group', { name: 'Comparison' });
    expect(within(comparison).getByText('The project differs in its name.')).toBeVisible();
    expect(within(comparison).getByRole('list', { name: 'What differs' })).toBeVisible();
    expect(within(comparison).getByRole('button', { name: 'Hear A' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(comparison).getByRole('button', { name: 'Hear B' }));
    await userEvent.click(within(comparison).getByRole('button', { name: 'Keep B' }));
    await userEvent.click(within(comparison).getByRole('button', { name: 'Stop comparing' }));
    expect(run.mock.calls).toEqual([
      ['history.switch-side', { side: 'b' }],
      ['history.promote', { side: 'b' }],
      ['history.close-comparison'],
    ]);
  });

  it('says the side heard once, by the command that switches it, and plays it only where playback can', async () => {
    const window = await branched();
    await window.runAndHear('history.compare', { node: nodeOf(window, 'Rename project to “C”') });
    panelOver(window, (id) =>
      id === 'history.audition' ? 'This browser cannot play audio.' : undefined,
    );

    const comparison = screen.getByRole('group', { name: 'Comparison' });
    expect(within(comparison).getByText(/^Side A, .*, is the one heard\.$/u)).toBeVisible();
    // Switching says which side is heard as it is made, so no status says it again.
    expect(
      within(comparison)
        .queryAllByRole('status')
        .filter((status) => status.textContent.includes('heard')),
    ).toEqual([]);
    const play = within(comparison).getByRole('button', { name: 'Play the side heard' });
    expect(play).toHaveAttribute('aria-disabled', 'true');
    expect(play).toHaveAccessibleDescription('This browser cannot play audio.');
  });

  it('shows what a plan to remove history costs before it is confirmed', async () => {
    const window = await branched();
    await window.runAndHear('history.plan-compaction', {
      branch: nodeOf(window, 'Rename project to “C”'),
    });
    const { run } = panelOver(window);

    const cost = screen.getByRole('group', { name: 'What removing history would cost' });
    expect(
      within(cost).getByText(/^This removes 1 point of the history for good, and frees /),
    ).toBeVisible();
    expect(
      within(cost).getByText(/^The branch of 1 change, last used .*, would go\.$/),
    ).toBeVisible();
    await userEvent.click(within(cost).getByRole('button', { name: 'Remove it for good' }));
    await userEvent.click(within(cost).getByRole('button', { name: 'Keep the history' }));
    expect(run.mock.calls).toEqual([['history.confirm-compaction'], ['history.cancel-compaction']]);
  });

  it('opens on a long history reading only the points it shows', async () => {
    const window = await projectWorld().window();
    await window.runAndHear('file.create-project', { name: 'Harbour' });
    const open = window.projects.project.get();
    if (open.kind !== 'open') throw new Error('No project is open.');
    /** How many points the panel reads as it opens on a history of `changes` changes. */
    const readOpening = (changes: number): number => {
      const counted = countedHistory(longHistory(changes));
      const { snapshot } = open;
      const project = observable<OpenProjectState>({
        ...open,
        snapshot: { ...snapshot, model: { ...snapshot.model, history: counted.history } },
      });
      // Ordered as the project opened, before the panel is.
      const rowOrders = new HistoryRowOrders(project);
      counted.restart();
      render(
        <HistoryPanel
          title="History"
          project={project}
          review={window.projects.review}
          rowOrders={rowOrders}
          run={vi.fn()}
          unavailableReason={() => undefined}
          labelFor={labelFor}
        />,
      );
      expect(screen.getByText(`${String(changes)} changes`, { exact: false })).toBeVisible();
      cleanup();
      return counted.reads();
    };

    const few = readOpening(1_000);
    const many = readOpening(16_000);

    expect(many).toBe(few);
    expect(many).toBeLessThan(100);
  });
});
