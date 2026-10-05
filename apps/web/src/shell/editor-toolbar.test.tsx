import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HintProvider } from '@audiogubbins/design-system';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { ToolId, newViewState } from '@audiogubbins/editor-view';

import { testAssets } from '../assets/test-assets.js';
import { TOOLS } from '../commands/editor-presentation-commands.js';
import { EditorToolbar } from './editor-toolbar.js';

const TONES = (() => {
  const [first] = expectSuccess(testAssets());
  if (first === undefined) throw new Error('No test asset.');
  return first;
})();

describe('the channel buttons', () => {
  it('are named by their channel alone, and pressed while it is shown', () => {
    // Named "Hide Left" and pressed, a button read "Hide Left, pressed", and a
    // reader could not tell whether the channel was shown or had been hidden.
    render(
      <HintProvider>
        <EditorToolbar
          panel="editor"
          asset={TONES}
          state={{ ...newViewState(TONES.length, 1000), hiddenChannels: [1] }}
          commands={{ run: vi.fn(), shortcutFor: () => undefined }}
        />
      </HintProvider>,
    );
    const channels = screen.getByRole('toolbar', { name: 'Channels shown' });

    expect(within(channels).getByRole('button', { name: 'Left' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(channels).getByRole('button', { name: 'Right' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('the tool buttons', () => {
  it('offer every tool, each choosing it in this view', () => {
    const run = vi.fn();
    render(
      <HintProvider>
        <EditorToolbar
          panel="editor"
          asset={TONES}
          state={newViewState(TONES.length, 1000)}
          commands={{ run, shortcutFor: () => undefined }}
        />
      </HintProvider>,
    );

    const tools = screen.getByRole('toolbar', { name: 'Tools' });

    for (const tool of Object.values(ToolId)) {
      within(tools).getByRole('button', { name: TOOLS[tool].name }).click();
      expect(run).toHaveBeenLastCalledWith(`editor.tool-${tool}`, { view: 'editor' });
    }
  });
});
