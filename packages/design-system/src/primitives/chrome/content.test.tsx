/**
 * The parts that hold a panel's content: property grids, lists, tables and
 * their verdicts.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { List, ListRow } from './list.js';
import { PropertyGrid } from './property-grid.js';
import { SourceChip, ValueSource } from './source-chip.js';
import { Table } from './table.js';
import { Verdict } from './verdict.js';

describe('PropertyGrid', () => {
  it('pairs each label with its value, and says where a value comes from', () => {
    render(
      <PropertyGrid
        rows={[
          { id: 'format', label: 'Format', value: 'WAV, 24-bit' },
          {
            id: 'loudness',
            label: 'Loudness target',
            value: '−16 LUFS within 1 LU',
            source: { kind: 'inherited', label: 'Inherited from Footsteps' },
          },
        ]}
      />,
    );

    const terms = screen.getAllByRole('term');
    const values = screen.getAllByRole('definition');
    expect(terms.map((term) => term.textContent)).toEqual(['Format', 'Loudness target']);
    expect(values[0]).toHaveTextContent('WAV, 24-bit');
    expect(values[1]).toHaveTextContent('−16 LUFS within 1 LU');
    const chip = screen.getByText('Inherited from Footsteps');
    expect(chip).toHaveAttribute('data-ag-source', 'inherited');
    expect(chip.closest('dd')).toBe(values[1]);
  });
});

describe('SourceChip', () => {
  it('draws an up arrow before an inherited value, and none before a set or an unset one', () => {
    // The language tells an inherited value by its glyph as well as by its
    // quiet fill, which a reader in forced colours or with low colour vision
    // may not see.
    const glyphIn = (source: ValueSource): Element | null => {
      const { container, unmount } = render(<SourceChip source={source}>Value</SourceChip>);
      const glyph = container.querySelector('.ag-source-chip > svg.ag-icon');
      unmount();
      return glyph;
    };

    expect(glyphIn(ValueSource.Inherited)).not.toBeNull();
    expect(glyphIn(ValueSource.Set)).toBeNull();
    expect(glyphIn(ValueSource.Unset)).toBeNull();
  });
});

describe('ListRow', () => {
  it('tells a screen reader which row is chosen, as well as drawing it lit', () => {
    // The lit edge is light alone; without a state a screen reader could read,
    // the chosen asset would be told by colour and nothing else.
    render(
      <List label="Sounds">
        <ListRow name="Tone bursts" detail="0:10.0 · Stereo · 48 kHz" chosen />
        <ListRow name="Intro hit" />
      </List>,
    );

    const [chosen, other] = within(screen.getByRole('list', { name: 'Sounds' })).getAllByRole(
      'listitem',
    );
    expect(chosen).toHaveAttribute('aria-current', 'true');
    expect(chosen).toHaveClass('ag-lit-row');
    expect(chosen).toHaveAttribute('data-ag-lit');
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).not.toHaveAttribute('data-ag-lit');
  });

  it('is a two-line row where it has a second line, and a one-line row where it has not', () => {
    render(
      <List>
        <ListRow name="Gulls 02.flac" detail="Waiting its turn" />
        <ListRow name="notes.txt" />
      </List>,
    );

    const [two, one] = screen.getAllByRole('listitem');
    expect(two).toHaveAttribute('data-ag-lines', 'two');
    expect(one).toHaveAttribute('data-ag-lines', 'one');
  });

  it('is pressed by pointer and by keyboard where it is itself a button, its actions apart', async () => {
    // A project to open is a row that is pressed: drawn as a plain row with a
    // click handler, a keyboard could not reach it at all.
    const onPress = vi.fn();
    const onRemove = vi.fn();
    render(
      <List label="Projects">
        <ListRow
          name="Harbour ambience"
          detail="Opened today"
          chosen
          onPress={onPress}
          actions={
            <button type="button" onClick={onRemove}>
              Remove
            </button>
          }
        />
      </List>,
    );

    const row = screen.getByRole('button', { name: 'Harbour ambience' });
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(row).toHaveAccessibleDescription('Opened today');
    expect(row).not.toContainElement(remove);
    expect(row).toHaveAttribute('aria-current', 'true');

    await userEvent.click(row);
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(onPress).toHaveBeenCalledTimes(2);

    await userEvent.click(remove);
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe('Table', () => {
  it('reads each cell with its column head', () => {
    render(
      <Table
        label="Members"
        columns={[
          { id: 'name', header: 'Name' },
          { id: 'peak', header: 'Peak', kind: 'numeric' },
          { id: 'check', header: 'Check', kind: 'verdict' },
        ]}
        rows={[
          {
            id: 'gravel-01',
            cells: {
              name: 'gravel_01',
              peak: '−1.2 dB',
              check: <Verdict kind="passes">Within the target</Verdict>,
            },
          },
        ]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Members' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['Name', 'Peak', 'Check']);
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['gravel_01', '−1.2 dB', 'Within the target']);
  });

  it('heads each row with the cell of a row-header column', () => {
    // A check's name heads its verdict and its value: as a plain cell, a
    // screen reader read "Fails" with its column's head and never said which
    // check failed.
    render(
      <Table
        label="Loop checks"
        columns={[
          { id: 'check', header: 'Check', rowHeader: true },
          { id: 'verdict', header: 'Verdict', kind: 'verdict' },
        ]}
        rows={[
          {
            id: 'seam',
            cells: {
              check: 'Click at the seam',
              verdict: <Verdict kind="fails">Fails</Verdict>,
            },
          },
        ]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Loop checks' });
    expect(within(table).getByRole('rowheader')).toHaveTextContent('Click at the seam');
    expect(within(table).getByRole('rowheader')).toHaveAttribute('scope', 'row');
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Fails']);
  });
});

describe('Verdict', () => {
  it('shows a spinner while the check runs, and its own glyph once it has a verdict', () => {
    const view = render(<Verdict kind="running">Checking</Verdict>);
    expect(document.querySelector('.ag-verdict .ag-spinner')).not.toBeNull();

    view.rerender(<Verdict kind="fails">Too loud</Verdict>);
    expect(document.querySelector('.ag-verdict .ag-spinner')).toBeNull();
    expect(document.querySelector('.ag-verdict svg[data-icon="check-fails"]')).not.toBeNull();
  });

  it('draws a reading out of date apart from a warning, asking for it to be checked again', () => {
    // A loudness measured before an edit was drawn as a warning, the same as
    // one that measured too loud, so a reader could not tell "measure again"
    // from "fix this".
    render(<Verdict kind="stale">Measured before the last edit</Verdict>);

    const verdict = screen.getByText('Measured before the last edit').closest('.ag-verdict');
    expect(verdict).toHaveAttribute('data-ag-verdict', 'stale');
    expect(verdict?.querySelector('svg[data-icon="analyse-again"]')).not.toBeNull();
  });
});
