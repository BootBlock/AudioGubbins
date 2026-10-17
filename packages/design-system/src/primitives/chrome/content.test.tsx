/**
 * The parts that hold a panel's content: property grids, lists, tables and
 * their verdicts.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { List, ListRow } from './list.js';
import { PropertyGrid } from './property-grid.js';
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
    expect(chosen).toHaveClass('ag-lit-edge');
    expect(other).not.toHaveAttribute('aria-current');
    expect(other).not.toHaveClass('ag-lit-edge');
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
});

describe('Verdict', () => {
  it('shows a spinner while the check runs, and its own glyph once it has a verdict', () => {
    const view = render(<Verdict kind="running">Checking</Verdict>);
    expect(document.querySelector('.ag-verdict .ag-spinner')).not.toBeNull();

    view.rerender(<Verdict kind="fails">Too loud</Verdict>);
    expect(document.querySelector('.ag-verdict .ag-spinner')).toBeNull();
    expect(document.querySelector('.ag-verdict svg[data-icon="check-fails"]')).not.toBeNull();
  });
});
