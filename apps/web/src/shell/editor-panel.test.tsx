import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCES,
  ThemeProvider,
  UNKNOWN_SYSTEM_APPEARANCE,
  fixedSystemAppearance,
} from '@audiogubbins/design-system';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { DisplayMode } from '@audiogubbins/editor-view';
import type { SpectrogramWorkerPort } from '@audiogubbins/spectral-analysis';
import { LocalSpectrogramWorker } from '@audiogubbins/spectral-analysis/testing';

import { fakePanelParts } from '../testing/editor-fakes.js';
import type { ShellContext } from '../commands/shell-context.js';
import { holdPlatformFiles, windowWithAudio } from '../testing/project-audio.js';
import { buildShellContext } from '../testing/shell-context.js';
import { EditorPanel } from './editor-panel.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('editor');

holdPlatformFiles();

/** The Editor panel of `context`, drawn, its spectrogram made by `spectrogramWorker` where given. */
function drawn(context: ShellContext, spectrogramWorker?: () => SpectrogramWorkerPort): void {
  render(
    <ThemeProvider
      preferences={DEFAULT_THEME_PREFERENCES}
      system={fixedSystemAppearance(UNKNOWN_SYSTEM_APPEARANCE)}
    >
      <EditorPanel
        panel="editor"
        title="Editor"
        parts={fakePanelParts(context, logger, spectrogramWorker)}
      />
    </ThemeProvider>,
  );
}

describe('the Editor panel', () => {
  it('says of a test sound that no project holds it, so it cannot be marked or edited', () => {
    const { context } = buildShellContext();
    const tones = context.assets.find('test:tone-bursts');
    if (tones === undefined) throw new Error('No tone bursts.');
    context.editorViews.open('editor', tones);

    drawn(context);

    expect(
      screen.getByText(
        'Test sounds are not part of a project, so they cannot be marked or edited. Import audio to mark and edit it.',
      ),
    ).toBeVisible();
  });

  it('shows an asset of the project with no such note', async () => {
    const audio = await windowWithAudio();
    audio.window.context.editorViews.open('editor', audio.asset());

    drawn(audio.window.context);

    expect(screen.getByText('Loop')).toBeVisible();
    expect(screen.queryByText(/not part of a project/)).toBeNull();
  });

  it('raises the spectrogram’s failure as an alert, which the canvas alone says only in pixels', async () => {
    const { context } = buildShellContext();
    const tones = context.assets.find('test:tone-bursts');
    if (tones === undefined) throw new Error('No tone bursts.');
    context.editorViews.open('editor', tones);
    context.editorViews.change('editor', (state) => ({
      ...state,
      displayMode: DisplayMode.Spectrogram,
    }));
    const workers: LocalSpectrogramWorker[] = [];

    drawn(context, () => {
      const worker = new LocalSpectrogramWorker();
      workers.push(worker);
      return worker;
    });
    await vi.waitFor(() => {
      expect(workers).toHaveLength(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      workers[0]?.fault('It ran out of memory.');
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The spectrogram could not be made: The spectrogram worker stopped: It ran out of memory.',
    );
  });

  it('says why an asset of the project cannot be shown yet, where its file is not held', () => {
    const { context } = buildShellContext();
    const tones = context.assets.find('test:tone-bursts');
    if (tones === undefined) throw new Error('No tone bursts.');
    context.editorViews.open('editor', { ...tones, id: 'asset:kick' });
    context.assets.showProject(
      new Map([
        [
          'asset:kick',
          {
            kind: 'unavailable',
            id: 'asset:kick',
            name: 'Kick',
            reason: 'The file it is linked to could not be found.',
          },
        ],
      ]),
    );

    drawn(context);

    expect(
      screen.getByText('Kick cannot be shown yet. The file it is linked to could not be found.'),
    ).toBeVisible();
  });
});
