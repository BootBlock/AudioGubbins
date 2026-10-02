import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { historyRowModel, historyRowOrder, type HistoryRowModel } from '@audiogubbins/history';
import type { HistoryNodeId } from '@audiogubbins/project-format';

import { longHistory } from '../../testing/long-history.js';
import { HistoryList } from './history-list.js';

const HISTORY = longHistory(5_000);
const ROWS = historyRowModel(historyRowOrder(HISTORY));

/** The identifier of the row at `index`. */
function nodeAt(index: number): HistoryNodeId {
  const row = ROWS.rowAt(index);
  if (row === undefined) throw new Error(`No row ${String(index)}.`);
  return row.node.id;
}

/** Draws the list of every row of `rows`, `chosen` chosen. */
function listOf(chosen: HistoryNodeId, rows: HistoryRowModel = ROWS) {
  return (
    <HistoryList
      rows={rows}
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

  it('reads only the rows it draws of a long history', () => {
    const read = new Set<number>();
    const rows: HistoryRowModel = {
      count: ROWS.count,
      indexOf: ROWS.indexOf,
      rowAt: (index) => {
        read.add(index);
        return ROWS.rowAt(index);
      },
    };
    render(listOf(nodeAt(4_000), rows));

    const drawn = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(read.size).toBe(drawn.length);
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
