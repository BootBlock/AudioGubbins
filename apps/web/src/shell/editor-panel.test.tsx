import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

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

/** The width every observed element is laid out at, reported as the browser does when it starts watching one. */
const LAID_OUT = 800;

/**
 * Puts a `ResizeObserver` in place of the suite's own that reports each
 * element it is given at {@link LAID_OUT} wide as it starts watching it, as a
 * browser reports an element's first size, and never again, since nothing
 * here is resized.
 */
function laidOutOnce(): void {
  const standIn = window.ResizeObserver;
  window.ResizeObserver = class {
    readonly #callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }

    observe(target: Element): void {
      const contentRect = new DOMRectReadOnly(0, 0, LAID_OUT, 200);
      // Every box a browser reports, as it reports them: a control that reads
      // its border box, as a slider's thumb does, finds one.
      const size: ResizeObserverSize = { inlineSize: LAID_OUT, blockSize: 200 };
      const entry: ResizeObserverEntry = {
        target,
        contentRect,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
      };
      this.#callback([entry], this);
    }

    unobserve(): void {
      return undefined;
    }

    disconnect(): void {
      return undefined;
    }
  };
  onTestFinished(() => {
    window.ResizeObserver = standIn;
  });
}

describe('the Editor panel', () => {
  it('fits an asset opened in a view already laid out to its width, as it fitted the first', () => {
    laidOutOnce();
    const { context } = buildShellContext();
    const tones = context.assets.find('test:tone-bursts');
    const loop = context.assets.find('test:loop');
    if (tones === undefined || loop === undefined) throw new Error('No test sounds.');
    context.editorViews.open('editor', tones);
    drawn(context);
    expect(context.editorViews.entry('editor')?.state.viewport.width).toBe(LAID_OUT);

    act(() => {
      context.editorViews.open('editor', loop);
    });

    const entry = context.editorViews.entry('editor');
    expect(entry).toMatchObject({ asset: loop.id, fitting: false });
    expect(entry?.state.viewport.width).toBe(LAID_OUT);
  });

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

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The spectrogram could not be made');
    expect(alert).toHaveTextContent('The spectrogram worker stopped: It ran out of memory.');
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
