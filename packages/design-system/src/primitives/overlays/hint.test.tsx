import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderThemed } from '../../testing/render-themed.js';
import { Button } from '../button.js';
import { Hint, HintTone } from './hint.js';
import { Tooltip } from './tooltips.js';

describe('Hint', () => {
  it('opens the explanation behind its (i), titled, and gives focus back on Escape', async () => {
    renderThemed(
      <Hint label="About monitoring" title="Monitoring">
        <p>What is monitored is never recorded.</p>
      </Hint>,
    );
    const button = screen.getByRole('button', { name: 'About monitoring' });

    button.focus();
    await userEvent.keyboard('{Enter}');

    const popover = await screen.findByRole('dialog', { name: 'About monitoring' });
    expect(popover).toHaveTextContent('Monitoring');
    expect(popover).toHaveTextContent('What is monitored is never recorded.');

    await userEvent.keyboard('{Escape}');
    expect(button).toHaveFocus();
  });

  it.each([
    [HintTone.Warning, 'warning'],
    [HintTone.Error, 'error'],
  ] as const)('marks a %s behind it, on the (i) and on what it opens', async (tone, drawn) => {
    // Every hint drew the same (i), so a caution about a loop that clicks
    // looked like a note about how loops are found until it was opened.
    renderThemed(
      <Hint label="About the seam" title="The seam clicks" tone={tone}>
        <p>The waveform jumps where the loop starts again.</p>
      </Hint>,
    );
    const button = screen.getByRole('button', { name: 'About the seam' });
    expect(button).toHaveAttribute('data-ag-tone', drawn);

    await userEvent.click(button);

    const popover = await screen.findByRole('dialog', { name: 'About the seam' });
    expect(popover).toHaveAttribute('data-ag-tone', drawn);
    expect(popover.querySelector('.ag-popover-title .ag-icon')).not.toBeNull();
  });
});

describe('Tooltip', () => {
  it('shows a name, what it does and its shortcut in key caps when its control takes focus', async () => {
    renderThemed(
      <Tooltip label="Hand" detail="Drags the view along the timeline." shortcut="H">
        <Button>Hand tool</Button>
      </Tooltip>,
    );

    await userEvent.tab();

    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Hand');
    expect(tip).toHaveTextContent('Drags the view along the timeline.');
    expect(tip).toHaveTextContent('H');
    expect(document.querySelector('.ag-tooltip kbd')).toHaveTextContent('H');
  });
});
