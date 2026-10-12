import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { HintProvider } from '@audiogubbins/design-system';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { ToolId, newViewState } from '@audiogubbins/editor-view';
import { SpectralCombination } from '@audiogubbins/timeline';

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

describe('the combination mode', () => {
  it('is offered beside a spectral tool, each mode pressed while in use and chosen in this view', () => {
    const run = vi.fn();
    const state = {
      ...newViewState(TONES.length, 1000),
      tool: ToolId.SpectralBrush,
    };
    render(
      <HintProvider>
        <EditorToolbar
          panel="editor"
          asset={TONES}
          state={{
            ...state,
            spectralTools: { ...state.spectralTools, combination: SpectralCombination.Add },
          }}
          commands={{ run, shortcutFor: () => undefined }}
        />
      </HintProvider>,
    );
    const modes = screen.getByRole('toolbar', { name: 'Combination mode' });

    expect(within(modes).getByRole('button', { name: 'Add' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(modes).getByRole('button', { name: 'Replace' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    within(modes).getByRole('button', { name: 'Take away' }).click();
    expect(run).toHaveBeenLastCalledWith('editor.spectral-combination-subtract', {
      view: 'editor',
    });
  });

  it('is not offered while a tool that draws no spectral shape is in use', () => {
    render(
      <HintProvider>
        <EditorToolbar
          panel="editor"
          asset={TONES}
          state={newViewState(TONES.length, 1000)}
          commands={{ run: vi.fn(), shortcutFor: () => undefined }}
        />
      </HintProvider>,
    );
    expect(screen.queryByRole('toolbar', { name: 'Combination mode' })).toBeNull();
  });
});
