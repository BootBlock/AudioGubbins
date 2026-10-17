import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { ToggleSwitch } from './toggle-switch.js';

describe('ToggleSwitch', () => {
  it('is reachable by its label and reports its state', () => {
    renderThemed(<ToggleSwitch label="Diagnostic mode" checked onCheckedChange={vi.fn()} />);

    expect(screen.getByRole('switch', { name: 'Diagnostic mode' })).toBeChecked();
  });

  it('toggles from the keyboard', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <ToggleSwitch label="Diagnostic mode" checked={false} onCheckedChange={onCheckedChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard(' ');

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('associates its description with the control', () => {
    renderThemed(
      <ToggleSwitch
        label="Diagnostic mode"
        description="Collects more detail for a limited period."
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch', { name: 'Diagnostic mode' })).toHaveAccessibleDescription(
      'Collects more detail for a limited period.',
    );
  });

  it('writes its state where a reader of the page finds it, though its hint shares the element', () => {
    // The hint's trigger is composed onto the switch and writes a state of its
    // own; the browser suite reads the switch's state from this attribute.
    const { rerender } = renderThemed(
      <ToggleSwitch label="Diagnostic mode" checked={false} onCheckedChange={vi.fn()} />,
    );
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'unchecked');

    rerender(<ToggleSwitch label="Diagnostic mode" checked onCheckedChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('data-state', 'checked');
  });

  it('keeps its focus while unavailable, changes nothing, and is described by its reason', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <ToggleSwitch
        label="Diagnostic mode"
        checked={false}
        onCheckedChange={onCheckedChange}
        unavailableReason="Diagnostics are turned off by your organisation."
      />,
    );

    await userEvent.tab();
    const control = screen.getByRole('switch', { name: 'Diagnostic mode' });
    expect(control).toHaveFocus();
    await userEvent.keyboard(' ');
    await userEvent.click(control);

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control).toHaveAccessibleDescription('Diagnostics are turned off by your organisation.');
  });
});
