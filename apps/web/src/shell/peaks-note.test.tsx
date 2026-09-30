import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PeaksNote } from './peaks-note.js';

describe('what the waveform is waiting for', () => {
  it('says its progress in a status region that is there before it has anything to say', () => {
    // A plain paragraph, drawn only once there was progress, which no screen
    // reader was told of.
    const { rerender } = render(<PeaksNote status={undefined} />);
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    rerender(<PeaksNote status={{ kind: 'generating', progress: 0.37 }} />);

    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Making the waveform: 37%');
  });

  it('raises its failure as an alert', () => {
    render(<PeaksNote status={{ kind: 'failed', reason: 'The worker stopped.' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The waveform could not be made: The worker stopped.',
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
