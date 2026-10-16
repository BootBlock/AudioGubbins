import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PREVIEW_PANEL } from '../../input/use-shortcuts.js';
import { panelCommandsOver } from '../../testing/command-availability.js';
import { buildShellContext } from '../../testing/shell-context.js';
import { GamePreviewPanel } from './preview-panel.js';

describe('the Game preview panel', () => {
  it('marks itself as the place its hand trigger’s key is its own', () => {
    // The hand trigger's T runs only within the element so marked
    // (`use-shortcuts.ts`); a panel drawn without it would never hear T.
    const { context } = buildShellContext();
    render(
      <GamePreviewPanel
        title="Game preview"
        context={{
          ...panelCommandsOver(context),
          gamePreview: context.gamePreview,
          projects: undefined,
          audioSettings: context.audioSettings,
          ids: context.ids,
        }}
      />,
    );

    const heading = screen.getByRole('heading', { name: 'Game preview' });
    expect(heading.closest(`[${PREVIEW_PANEL}]`)).not.toBeNull();
  });
});
