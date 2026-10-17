import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Section } from './section.js';

describe('Section', () => {
  it('opens and closes from the keyboard by its header, which says whether it is open', async () => {
    // Advanced settings sit in a closed section rather than being removed
    // (REQ-UX-071), so a section a keyboard could not open would remove them.
    render(
      <Section title="Time and rate" defaultOpen={false}>
        <p>Stretch</p>
      </Section>,
    );
    const header = screen.getByRole('button', { name: 'Time and rate' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Stretch')).not.toBeInTheDocument();

    header.focus();
    await userEvent.keyboard('{Enter}');

    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Stretch')).toBeVisible();
  });

  it('starts open unless told otherwise', () => {
    render(
      <Section title="Level">
        <p>Gain</p>
      </Section>,
    );

    expect(screen.getByRole('button', { name: 'Level' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('describes its header by its summary, so a closed section still says what it holds', () => {
    render(
      <Section title="Time and rate" summary="Silence, Stretch, Rate" defaultOpen={false}>
        <p>Stretch</p>
      </Section>,
    );

    expect(screen.getByRole('button', { name: 'Time and rate' })).toHaveAccessibleDescription(
      'Silence, Stretch, Rate',
    );
  });

  it('follows its caller where the caller holds whether it is open', async () => {
    const changed = vi.fn();
    function Held() {
      const [open, setOpen] = useState(false);
      return (
        <Section
          title="Asset"
          open={open}
          onOpenChange={(next) => {
            changed(next);
            setOpen(next);
          }}
        >
          <p>Format</p>
        </Section>
      );
    }
    render(<Held />);

    await userEvent.click(screen.getByRole('button', { name: 'Asset' }));

    expect(changed).toHaveBeenCalledWith(true);
    expect(screen.getByText('Format')).toBeVisible();
  });

  it('keeps its actions out of the header button, so each is a control of its own', () => {
    render(
      <Section title="Rack" actions={<button type="button">Show</button>}>
        <p>Gain</p>
      </Section>,
    );

    const header = screen.getByRole('button', { name: 'Rack' });
    expect(header).not.toContainElement(screen.getByRole('button', { name: 'Show' }));
  });
});
