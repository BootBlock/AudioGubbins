/**
 * The states a panel or an operation is in: empty, warning and error, loading
 * and under way, and the banners and chips that say so.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Banner } from './banner.js';
import { EmptyState } from './empty-state.js';
import { ProgressBar } from './progress-bar.js';
import { Skeleton } from './skeleton.js';
import { Spinner } from './spinner.js';
import { StatusChip } from './status-chip.js';

describe('ProgressBar', () => {
  it('says how far it has come, in words where it is given them', () => {
    render(
      <ProgressBar
        label="Copying Harbour bell.wav"
        value={0.25}
        valueText={(value) => `${String(value * 100)} per cent`}
      />,
    );

    const bar = screen.getByRole('progressbar', { name: 'Copying Harbour bell.wav' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(bar).toHaveAttribute('aria-valuetext', '25 per cent');
    expect(
      bar
        .querySelector<HTMLElement>('.ag-progress-fill')
        ?.style.getPropertyValue('--ag-progress-value'),
    ).toBe('0.25');
  });

  it('holds a value outside the bar to its ends, so the fill never overflows the track', () => {
    render(<ProgressBar label="Exporting" value={1.4} />);

    const bar = screen.getByRole('progressbar', { name: 'Exporting' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(
      bar
        .querySelector<HTMLElement>('.ag-progress-fill')
        ?.style.getPropertyValue('--ag-progress-value'),
    ).toBe('1');
  });

  it('claims no value while it does not know one', () => {
    render(<ProgressBar label="Making the waveform" value={null} />);

    const bar = screen.getByRole('progressbar', { name: 'Making the waveform' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('data-state', 'indeterminate');
  });
});

describe('Spinner', () => {
  it('is named where it says what is being waited for, and hidden where words beside it do', () => {
    const view = render(<Spinner label="Opening the project" />);
    expect(screen.getByRole('progressbar', { name: 'Opening the project' })).toBeInTheDocument();

    view.rerender(<Spinner />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(document.querySelector('.ag-spinner')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Skeleton', () => {
  it('says what is loading, and draws one line for each entry of its shape', () => {
    render(<Skeleton label="Loading the history" lines={[1, 0.6, 0.8]} />);

    expect(screen.getByText('Loading the history')).toBeInTheDocument();
    const lines = [...document.querySelectorAll<HTMLElement>('.ag-skeleton-line')];
    expect(lines.map((line) => line.style.getPropertyValue('--ag-skeleton-width'))).toEqual([
      '1',
      '0.6',
      '0.8',
    ]);
    expect(document.querySelector('.ag-skeleton')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('EmptyState', () => {
  it('shows its title, its one line and its actions', () => {
    render(
      <EmptyState
        icon="waveform"
        title="No audio yet"
        text="Import audio files to add some."
        actions={<button type="button">Import audio…</button>}
      />,
    );

    expect(screen.getByText('No audio yet')).toBeInTheDocument();
    expect(screen.getByText('Import audio files to add some.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import audio…' })).toBeInTheDocument();
  });

  it('draws an error in the error colour, as the empty state is drawn in the accent', () => {
    render(<EmptyState tone="error" icon="waveform" title="The waveform could not be made" />);

    expect(document.querySelector('.ag-empty-state')).toHaveAttribute('data-ag-tone', 'error');
  });
});

describe('Banner', () => {
  it('shows a spinner in place of its glyph while what it describes is under way', () => {
    render(<Banner icon="busy" title="Opening the project…" />);

    expect(document.querySelector('.ag-banner .ag-spinner')).not.toBeNull();
    expect(document.querySelector('.ag-banner svg')).toBeNull();
    expect(screen.getByText('Opening the project…')).toBeInTheDocument();
  });
});

describe('StatusChip', () => {
  it('leads a recording chip with its lamp rather than a glyph', () => {
    const view = render(
      <StatusChip tone="recording" icon="recorder">
        USB microphone: recording
      </StatusChip>,
    );
    expect(document.querySelector('.ag-status-chip-lamp')).not.toBeNull();
    expect(document.querySelector('.ag-status-chip svg')).toBeNull();

    view.rerender(
      <StatusChip tone="warning" icon="warning">
        Backup not made
      </StatusChip>,
    );
    expect(document.querySelector('.ag-status-chip-lamp')).toBeNull();
    expect(document.querySelector('.ag-status-chip svg[data-icon="warning"]')).not.toBeNull();
  });
});
