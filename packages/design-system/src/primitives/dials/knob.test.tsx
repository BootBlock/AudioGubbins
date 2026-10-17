import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { Knob, type KnobProps } from './knob.js';

/**
 * The knob is a slider to the keyboard and a screen reader, a drag to a
 * pointer, and its value a field a number is typed into; unavailable, it keeps
 * its focus and its reason and changes nothing.
 */

/** The size the knob is laid out at here: a drag of four times it sweeps the travel. */
const KNOB_SIZE = 50;

function knob(overrides: Partial<KnobProps> = {}) {
  const props = {
    label: 'Threshold',
    value: 0,
    minimum: -60,
    maximum: 0,
    step: 1,
    onValueChange: vi.fn(),
    onValueCommit: vi.fn(),
    describeValue: (value: number) => `${String(value)} decibels`,
    displayValue: '0 dB',
    ...overrides,
  } as KnobProps;
  renderThemed(<Knob {...props} />);
  return { props, dial: screen.getByRole('slider', { name: 'Threshold' }) };
}

describe('Knob', () => {
  beforeEach(() => {
    // jsdom lays nothing out and has no pointer capture: the knob is given a
    // size and a capture that does nothing, so its real drag path runs.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: KNOB_SIZE, height: KNOB_SIZE }),
    );
    HTMLElement.prototype.setPointerCapture = () => undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a slider named by its label, saying its value in its caller’s words', () => {
    const { dial } = knob({ value: -18 });

    expect(dial).toHaveAttribute('aria-valuetext', '-18 decibels');
    expect(dial).toHaveAttribute('aria-valuemin', '-60');
    expect(dial).toHaveAttribute('aria-valuemax', '0');
  });

  it('moves a step for an arrow, ten for a Page key or a Shift arrow, and to its ends for Home and End', async () => {
    const { props, dial } = knob({ value: -30 });
    dial.focus();

    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{PageUp}');
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await userEvent.keyboard('{Home}');
    await userEvent.keyboard('{End}');

    expect(props.onValueChange).toHaveBeenNthCalledWith(1, -29);
    expect(props.onValueChange).toHaveBeenNthCalledWith(2, -31);
    expect(props.onValueChange).toHaveBeenNthCalledWith(3, -20);
    expect(props.onValueChange).toHaveBeenNthCalledWith(4, -40);
    expect(props.onValueChange).toHaveBeenNthCalledWith(5, -60);
    expect(props.onValueChange).toHaveBeenNthCalledWith(6, 0);
    // Each keyboard step is a value settled on.
    expect(props.onValueCommit).toHaveBeenCalledTimes(6);
  });

  it('moves along its caller’s scale, a key a step of it', async () => {
    const decades = {
      steps: 30,
      positionOf: (value: number) => Math.log10(value / 10) / 3,
      valueAt: (position: number) => 10 * 1000 ** position,
    };
    const onValueChange = vi.fn();
    const { dial } = knob({
      value: 100,
      minimum: 10,
      maximum: 10_000,
      step: undefined,
      scale: decades,
      onValueChange,
    });
    dial.focus();

    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange.mock.calls[0]?.[0]).toBeCloseTo(125.89, 2);
  });

  it('follows a drag up as it moves, and settles on the value the drag ends at', () => {
    const { props, dial } = knob({ value: -60 });

    fireEvent.pointerDown(dial, { pointerId: 1, button: 0, clientX: 0, clientY: 300 });
    // A quarter of the reach, four times the knob's size: a quarter of 60 dB.
    fireEvent.pointerMove(dial, { pointerId: 1, clientX: 0, clientY: 250 });
    expect(props.onValueChange).toHaveBeenLastCalledWith(-45);
    expect(props.onValueCommit).not.toHaveBeenCalled();

    fireEvent.pointerMove(dial, { pointerId: 1, clientX: 0, clientY: 200 });
    fireEvent.pointerUp(dial, { pointerId: 1, clientX: 0, clientY: 200 });
    expect(props.onValueChange).toHaveBeenLastCalledWith(-30);
    expect(props.onValueCommit).toHaveBeenCalledOnce();
    expect(props.onValueCommit).toHaveBeenCalledWith(-30);
  });

  it('can still be turned while what it sets is bypassed', async () => {
    const { props, dial } = knob({ value: -30, bypassed: true });
    dial.focus();

    await userEvent.keyboard('{ArrowUp}');

    expect(props.onValueChange).toHaveBeenCalledWith(-29);
  });

  it('keeps its focus and its reason while unavailable, and changes nothing', async () => {
    const { props, dial } = knob({ unavailableReason: 'Turn the processor on first' });

    await userEvent.tab();
    expect(dial).toHaveFocus();
    expect(dial).toHaveAttribute('aria-disabled', 'true');
    expect(dial).toHaveAccessibleDescription('Turn the processor on first');

    await userEvent.keyboard('{ArrowUp}{Home}');
    fireEvent.pointerDown(dial, { pointerId: 1, button: 0, clientX: 0, clientY: 300 });
    fireEvent.pointerMove(dial, { pointerId: 1, clientX: 0, clientY: 100 });
    fireEvent.pointerUp(dial, { pointerId: 1, clientX: 0, clientY: 100 });
    expect(props.onValueChange).not.toHaveBeenCalled();
    expect(props.onValueCommit).not.toHaveBeenCalled();
  });

  it('opens its value for typing on a click, and sends what is typed on Enter', async () => {
    const onSubmit = vi.fn();
    knob({ typing: { label: 'Threshold in dB, typed', text: '-18', onSubmit } });

    await userEvent.click(screen.getByRole('button', { name: 'Threshold in dB, typed' }));
    const field = screen.getByRole('textbox', { name: 'Threshold in dB, typed' });
    expect(field).toHaveFocus();
    expect(field).toHaveValue('-18');

    // The text is chosen as the field opens, so typing replaces it.
    await userEvent.keyboard('-12{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('-12');
    expect(screen.getByRole('button', { name: 'Threshold in dB, typed' })).toHaveFocus();
  });

  it('puts the typing away on Escape, sending nothing', async () => {
    const onSubmit = vi.fn();
    knob({ typing: { label: 'Threshold in dB, typed', text: '-18', onSubmit } });

    screen.getByRole('button', { name: 'Threshold in dB, typed' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('-3{Escape}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Threshold in dB, typed' })).toHaveTextContent(
      '0 dB',
    );
  });
});
