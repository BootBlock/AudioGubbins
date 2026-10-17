import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { Check } from './check.js';

describe('Check', () => {
  it('is a check named by its label, reporting its state', () => {
    renderThemed(<Check label="Include markers" checked onCheckedChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Include markers' })).toBeChecked();
  });

  it('is made from the keyboard', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <Check label="Include markers" checked={false} onCheckedChange={onCheckedChange} />,
    );

    await userEvent.tab();
    await userEvent.keyboard(' ');

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('is made by a press on its words, as a native check is', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(<Check label="Include markers" checked onCheckedChange={onCheckedChange} />);

    await userEvent.click(screen.getByText('Include markers'));

    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('is described by its description', () => {
    renderThemed(
      <Check
        label="Include markers"
        description="Markers are written into the file as cue points."
        checked={false}
        onCheckedChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(
      'Markers are written into the file as cue points.',
    );
  });

  it('keeps its focus while unavailable and changes nothing', async () => {
    const onCheckedChange = vi.fn();
    renderThemed(
      <Check
        label="Include markers"
        checked={false}
        onCheckedChange={onCheckedChange}
        unavailableReason="This format has no markers."
      />,
    );

    await userEvent.tab();
    const check = screen.getByRole('checkbox', { name: 'Include markers' });
    expect(check).toHaveFocus();
    await userEvent.keyboard(' ');

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(check).toHaveAccessibleDescription('This format has no markers.');
  });
});
