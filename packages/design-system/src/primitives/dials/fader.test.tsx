import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { Fader, type FaderProps } from './fader.js';

/**
 * The fader is a slider standing on end: its keys, its name and its spoken
 * value are the slider's; its marks stand where its caller's taper puts their
 * values, and a short fader leaves out the marks its caller calls minor.
 */

/** A gain fader from −60 dB to +10 dB along a taper that gives the top quarter to the boost. */
const TAPER = {
  steps: 140,
  positionOf: (decibels: number) =>
    decibels >= 0 ? 0.75 + (decibels / 10) * 0.25 : 0.75 * (1 + decibels / 60),
  valueAt: (position: number) =>
    position >= 0.75 ? ((position - 0.75) / 0.25) * 10 : (position / 0.75 - 1) * 60,
};

const MARKS = [
  { value: 10, label: '+10' },
  { value: 0, label: '0', emphasised: true },
  { value: -30, label: '−30', minor: true },
  { value: -60, label: '−60' },
];

function fader(overrides: Partial<FaderProps> = {}) {
  const props = {
    label: 'Gain',
    value: 0,
    minimum: -60,
    maximum: 10,
    scale: TAPER,
    marks: MARKS,
    onValueChange: vi.fn(),
    onValueCommit: vi.fn(),
    describeValue: (value: number) => `${value.toFixed(1)} decibels`,
    displayValue: '0.0 dB',
    ...overrides,
  } as FaderProps;
  renderThemed(<Fader {...props} />);
  return { props, cap: screen.getByRole('slider', { name: 'Gain' }) };
}

/** Where a printed mark stands along the travel, as the fader placed it. */
function markAt(label: string): number {
  const mark = screen.getByText(label).closest<HTMLElement>('.ag-fader-mark');
  if (mark === null) throw new Error(`No mark ${label}`);
  return Number(mark.style.getPropertyValue('--ag-fader-at'));
}

function body(): Element {
  const found = document.querySelector('.ag-fader-body');
  if (found === null) throw new Error('The fader drew no body.');
  return found;
}

describe('Fader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a slider named by its label, saying its value in its caller’s words', () => {
    const { cap } = fader({ value: -6 });

    expect(cap).toHaveAttribute('aria-valuetext', '-6.0 decibels');
    expect(cap).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('moves along its taper from the keyboard, settling at each step', async () => {
    const onValueChange = vi.fn();
    const { props } = fader({ value: 0, onValueChange });

    await userEvent.tab();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{End}');

    // One step of 140 up from 0 dB, which stands at 105.
    expect(onValueChange.mock.calls[0]?.[0]).toBeCloseTo(TAPER.valueAt(106 / 140), 6);
    expect(onValueChange).toHaveBeenLastCalledWith(10);
    expect(props.onValueCommit).toHaveBeenCalledTimes(2);
  });

  it('prints each mark where its caller’s taper puts the mark’s value', () => {
    fader();

    expect(markAt('+10')).toBe(1);
    expect(markAt('0')).toBeCloseTo(0.75, 6);
    expect(markAt('−30')).toBeCloseTo(0.375, 6);
    expect(markAt('−60')).toBe(0);
  });

  it('leaves out its minor marks on a travel too short to print them all', () => {
    // 160 pixels tall, less the 30 of the cap: a travel of 130 units.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 64, height: 160 }),
    );
    fader();

    expect(body()).toHaveAttribute('data-ag-short');
  });

  it('prints every mark on a long travel', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 64, height: 260 }),
    );
    fader();

    expect(body()).not.toHaveAttribute('data-ag-short');
  });

  it('keeps its focus and its reason while unavailable, and changes nothing', async () => {
    const { props, cap } = fader({ unavailableReason: 'Turn the processor on first' });

    await userEvent.tab();
    expect(cap).toHaveFocus();
    expect(cap).toHaveAttribute('aria-disabled', 'true');
    expect(cap).toHaveAccessibleDescription('Turn the processor on first');

    await userEvent.keyboard('{ArrowUp}{Home}');
    expect(props.onValueChange).not.toHaveBeenCalled();
    expect(props.onValueCommit).not.toHaveBeenCalled();
  });
});
