import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TabSet } from './tab-set.js';

describe('TabSet', () => {
  it('names its tab list and shows only the selected panel', () => {
    render(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={vi.fn()}
        tabs={[
          { value: 'appearance', label: 'Appearance', content: <p>Appearance settings</p> },
          { value: 'shortcuts', label: 'Shortcuts', content: <p>Shortcut settings</p> },
        ]}
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByText('Appearance settings')).toBeInTheDocument();
    expect(screen.queryByText('Shortcut settings')).not.toBeInTheDocument();
  });

  it('moves between tabs with the arrow keys', async () => {
    const onValueChange = vi.fn();
    render(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={onValueChange}
        tabs={[
          { value: 'appearance', label: 'Appearance', content: <p>A</p> },
          { value: 'shortcuts', label: 'Shortcuts', content: <p>B</p> },
        ]}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledWith('shortcuts');
  });

  it('names each tab by its label alone, with its glyph hidden from a screen reader', () => {
    // A glyph announced beside the label would read every tab's name twice
    // over, once as an image with no name.
    render(
      <TabSet
        label="Settings sections"
        value="appearance"
        onValueChange={vi.fn()}
        tabs={[
          {
            value: 'appearance',
            label: 'Appearance',
            icon: 'appearance',
            content: <p>Appearance settings</p>,
          },
        ]}
      />,
    );

    const tab = screen.getByRole('tab', { name: 'Appearance' });
    expect(tab.querySelector('svg[data-icon="appearance"]')).toHaveAttribute('aria-hidden', 'true');
  });
});
