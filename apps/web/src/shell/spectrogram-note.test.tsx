import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SpectrogramNote } from './spectrogram-note.js';

describe('why the spectrogram is not drawn', () => {
  it('raises a failure as an alert, since the lane then shows only its reason drawn in', () => {
    render(
      <SpectrogramNote
        status={{ kind: 'failed', reason: 'The spectrogram worker stopped: It ran out of memory.' }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The spectrogram could not be made: The spectrogram worker stopped: It ran out of memory.',
    );
  });

  it('says nothing while the spectrogram is made, or where the view shows none', () => {
    const { rerender } = render(<SpectrogramNote status={{ kind: 'running' }} />);
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<SpectrogramNote status={undefined} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
