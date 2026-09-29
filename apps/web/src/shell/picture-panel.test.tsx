import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { sampleCount } from '@audiogubbins/domain';

import type { EditorPanelParts } from '../editor/panel-parts.js';
import { fakePanelParts } from '../testing/editor-fakes.js';
import { buildShellContext } from '../testing/shell-context.js';
import { PicturePanel } from './picture-panel.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor');

/** The panel's parts over a picture opened and bound to the loop test, whose commands say `reasons`. */
function openedPicture(reasons: Readonly<Record<string, string>> = {}) {
  const { context } = buildShellContext();
  const loop = context.assets.find('test:loop');
  if (loop === undefined) throw new Error('No loop test.');
  context.picture.open(new File([], 'reference.webm'), loop);
  context.picture.element.dispatchEvent(new Event('loadeddata'));
  const parts: EditorPanelParts = {
    ...fakePanelParts(context, logger),
    unavailableReason: (id) => reasons[id],
  };
  return { context, parts, loop };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Picture panel', () => {
  it('follows a parked playhead when it moves, and asks for no display frame while idle', () => {
    const frames = vi.spyOn(window, 'requestAnimationFrame');
    const { context, parts, loop } = openedPicture();
    render(<PicturePanel title="Picture" parts={parts} />);

    const position = sampleCount(50_000);
    if (!position.ok) throw new Error('No position.');
    act(() => {
      context.cues.park(loop.id, position.value);
    });

    // 50,000 at 48 kHz is in frame 26 at 25 frames a second, whose middle is 1.06 s.
    expect(context.picture.element.currentTime).toBeCloseTo(1.06, 9);
    expect(frames).not.toHaveBeenCalled();
  });

  it('keeps an action it cannot run in the tab order, with the reason written above it', () => {
    const { parts } = openedPicture({
      'picture.full-screen': 'This browser cannot show an element full screen.',
    });
    render(<PicturePanel title="Picture" parts={parts} />);

    const button = screen.getByRole('button', { name: 'Full screen' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('This browser cannot show an element full screen.');
    expect(screen.getByText('This browser cannot show an element full screen.')).toBeVisible();
  });
});
