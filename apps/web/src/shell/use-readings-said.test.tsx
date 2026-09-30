import { act, render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReadingsSaid, type Readings } from './use-readings-said.js';

/**
 * What a key pressed in an editor's surface changed, said once the keys stop:
 * the surface is an application region, so a screen reader passes its keys
 * through, and the readings beside it changed in silence.
 */

const AT_START: Readings = {
  playhead: '0:00.000',
  zoom: '480 samples a pixel',
  showing: '0:00.000 to 0:10.000',
};

let said: string[];

beforeEach(() => {
  vi.useFakeTimers();
  said = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function Surface({ readings }: { readonly readings: Readings }): ReactNode {
  const surface = useRef<HTMLDivElement>(null);
  useReadingsSaid(surface, readings, (text) => {
    said.push(text);
  });
  return <div ref={surface} aria-label="Waveform" />;
}

/** A key pressed in the surface, as the browser sends it before the shortcut runs. */
function press(surface: Element): void {
  surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
}

describe('what the keys changed', () => {
  it('is said once, politely, when a run of keys settles', () => {
    const { container, rerender } = render(<Surface readings={AT_START} />);
    const surface = container.firstElementChild;
    if (surface === null) throw new Error('No surface.');

    press(surface);
    rerender(<Surface readings={{ ...AT_START, playhead: '0:00.010' }} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    press(surface);
    rerender(<Surface readings={{ ...AT_START, playhead: '0:00.020' }} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(said).toEqual(['Playhead at 0:00.020.']);
  });

  it('is nothing where no key was pressed, as while the asset plays', () => {
    const { rerender } = render(<Surface readings={AT_START} />);

    rerender(<Surface readings={{ ...AT_START, playhead: '0:03.000' }} />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(said).toEqual([]);
  });
});

describe('the sentence', () => {
  /** What is said of a key that changed the readings to `to`. */
  function saidOf(to: Readings): readonly string[] {
    said = [];
    const { container, rerender, unmount } = render(<Surface readings={AT_START} />);
    const surface = container.firstElementChild;
    if (surface === null) throw new Error('No surface.');
    press(surface);
    rerender(<Surface readings={to} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    unmount();
    return said;
  }

  it('says the zoom with what it shows, and a scroll by what it shows', () => {
    expect(
      saidOf({ ...AT_START, zoom: '240 samples a pixel', showing: '0:02.500 to 0:07.500' }),
    ).toEqual(['Zoom 240 samples a pixel, showing 0:02.500 to 0:07.500.']);
    expect(saidOf({ ...AT_START, showing: '0:10.000 to 0:20.000' })).toEqual([
      'Showing 0:10.000 to 0:20.000.',
    ]);
    expect(saidOf(AT_START)).toEqual([]);
  });
});
