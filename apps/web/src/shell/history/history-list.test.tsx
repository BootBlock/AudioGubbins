import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { commandId } from '@audiogubbins/commands';
import { createDeterministicIdGenerator, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  changeNodeOf,
  historyRows,
  recordChange,
  startHistory,
  type History,
} from '@audiogubbins/history';
import type { HistoryNodeId } from '@audiogubbins/project-format';

import { HistoryList } from './history-list.js';

/** A history of `changes` changes in one line, each renaming the project. */
function longHistory(changes: number): History {
  const ids = createDeterministicIdGenerator(5);
  let history = startHistory(unsafeBrandId<'ProjectId'>('00000000-0000-4000-8000-00000000a0a0'), {
    kind: 'origin',
    id: ids.next<'HistoryNodeId'>(),
    at: 1_790_000_000_000,
    origin: { kind: 'new' },
  });
  for (let step = 1; step <= changes; step += 1) {
    const invocation = { commandId: commandId('project.rename'), arguments: { name: 'x' } };
    const node = changeNodeOf(history, {
      id: ids.next<'HistoryNodeId'>(),
      at: 1_790_000_000_000 + step,
      entry: {
        description: `Change ${String(step)}`,
        forward: [invocation],
        inverse: [invocation],
      },
      affects: {
        assets: [],
        tracks: [],
        buses: [],
        clips: [],
        regions: [],
        markers: [],
        effectChains: [],
        project: true,
      },
    });
    history = expectSuccess(recordChange(history, node));
  }
  return history;
}

const HISTORY = longHistory(5_000);
const ROWS = historyRows(HISTORY);

/** The identifier of the row at `index`. */
function nodeAt(index: number): HistoryNodeId {
  const row = ROWS[index];
  if (row === undefined) throw new Error(`No row ${String(index)}.`);
  return row.node.id;
}

/** Draws the list of every row, `chosen` chosen. */
function listOf(chosen: HistoryNodeId) {
  return (
    <HistoryList
      rows={ROWS}
      names={() => undefined}
      chosen={chosen}
      onChoose={() => undefined}
      onGo={() => undefined}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the list of points in the history', () => {
  it('draws a bounded number of a long history’s rows, the chosen among them, each placed in the whole', () => {
    render(listOf(nodeAt(4_000)));

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.length).toBeLessThan(40);
    const chosen = options.find((option) => option.getAttribute('aria-selected') === 'true');
    expect(chosen).toHaveAttribute('aria-posinset', '4001');
    expect(chosen).toHaveAttribute('aria-setsize', '5001');
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-activedescendant', chosen?.id);
  });

  it('brings the chosen point into view once each time the choice moves, and not as it draws again', () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { rerender } = render(listOf(nodeAt(10)));
    rerender(listOf(nodeAt(10)));
    rerender(listOf(nodeAt(10)));
    expect(scrolled).toHaveBeenCalledTimes(1);

    rerender(listOf(nodeAt(11)));
    rerender(listOf(nodeAt(11)));
    expect(scrolled).toHaveBeenCalledTimes(2);
  });
});
