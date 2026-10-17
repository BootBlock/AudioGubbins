import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { SegmentedControl, SegmentedVariant, type SegmentedOption } from './segmented-control.js';

const MODES: readonly SegmentedOption[] = [
  { value: 'waveform', label: 'Waveform', icon: 'waveform' },
  { value: 'spectrogram', label: 'Spectrogram', icon: 'spectrogram' },
  { value: 'both', label: 'Both', icon: 'spectral' },
];

describe('SegmentedControl', () => {
  it('is a radio group named by its label, its chosen choice checked', () => {
    renderThemed(
      <SegmentedControl label="Display" value="both" options={MODES} onValueChange={vi.fn()} />,
    );

    expect(screen.getByRole('radiogroup', { name: 'Display' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Both' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Waveform' })).not.toBeChecked();
  });

  it('chooses the next choice with an arrow key, as radios do', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <SegmentedControl
        label="Display"
        value="waveform"
        options={MODES}
        onValueChange={onValueChange}
      />,
    );

    await userEvent.tab();
    // Held, as a finger holds a key for longer than the roving focus waits to
    // move: the choice is made as focus arrives while the key is down.
    await userEvent.keyboard('{ArrowRight>}');
    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalledWith('spectrogram');
    });
  });

  it('names each glyph choice by its label', () => {
    renderThemed(
      <SegmentedControl
        label="Display"
        value="both"
        options={MODES}
        variant={SegmentedVariant.Icons}
        onValueChange={vi.fn()}
      />,
    );

    const waveform = screen.getByRole('radio', { name: 'Waveform' });
    expect(waveform.querySelector('svg[data-icon="waveform"]')).not.toBeNull();
  });

  it('draws each card’s preview over its label, named by the label alone', () => {
    // A theme's preview is a picture: read out, its parts would be a string of
    // nothing before "Dark".
    renderThemed(
      <SegmentedControl
        label="Theme"
        value="dark"
        variant={SegmentedVariant.Cards}
        options={[
          { value: 'dark', label: 'Dark', preview: <span data-testid="dark-preview">▮▮▮</span> },
          { value: 'light', label: 'Light', preview: <span>▯▯▯</span> },
        ]}
        onValueChange={vi.fn()}
      />,
    );

    const dark = screen.getByRole('radio', { name: 'Dark' });
    expect(dark).toBeChecked();
    expect(dark).toContainElement(screen.getByTestId('dark-preview'));
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toHaveAttribute(
      'data-ag-variant',
      'cards',
    );
  });

  it('changes nothing while unavailable, and says why', async () => {
    const onValueChange = vi.fn();
    renderThemed(
      <SegmentedControl
        label="Display"
        value="waveform"
        options={MODES}
        onValueChange={onValueChange}
        unavailableReason="Open a sound to choose its display."
      />,
    );

    await userEvent.click(screen.getByRole('radio', { name: 'Both' }));

    expect(onValueChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radiogroup')).toHaveAccessibleDescription(
      'Open a sound to choose its display.',
    );
  });
});

describe('the chosen choice’s wash', () => {
  // jsdom lays nothing out, so each choice is given the box a browser would
  // give it: 60 pixels wide, side by side, the well's two-pixel padding before
  // the first.
  const descriptors = (['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'] as const).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );

  beforeEach(() => {
    const index = (element: HTMLElement): number =>
      [...(element.parentElement?.querySelectorAll('.ag-segment') ?? [])].indexOf(element);
    const define = (name: string, read: (element: HTMLElement) => number): void => {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return read(this);
        },
      });
    };
    define('offsetLeft', (element) => 2 + index(element) * 62);
    define('offsetTop', () => 2);
    define('offsetWidth', () => 60);
    define('offsetHeight', () => 22);
  });

  afterEach(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor !== undefined) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    }
  });

  function wash(): HTMLElement {
    const found = document.querySelector<HTMLElement>('.ag-segmented-wash');
    if (found === null) throw new Error('The segmented control drew no wash.');
    return found;
  }

  it('lies over the chosen choice, and moves to the next one chosen', () => {
    const { rerender } = renderThemed(
      <SegmentedControl label="Display" value="waveform" options={MODES} onValueChange={vi.fn()} />,
    );
    expect(wash().style.getPropertyValue('--ag-segment-left')).toBe('2px');
    expect(wash().style.getPropertyValue('--ag-segment-width')).toBe('60px');
    expect(wash()).toHaveAttribute('data-ag-placed');

    rerender(
      <SegmentedControl label="Display" value="both" options={MODES} onValueChange={vi.fn()} />,
    );
    expect(wash().style.getPropertyValue('--ag-segment-left')).toBe('126px');
  });

  it('is not drawn while nothing is chosen', () => {
    renderThemed(
      <SegmentedControl label="Display" value="none" options={MODES} onValueChange={vi.fn()} />,
    );
    expect(wash()).not.toHaveAttribute('data-ag-placed');
  });
});
