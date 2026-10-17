import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { CachePurpose, RenderPhase, type RenderReport } from '@audiogubbins/audio-engine';

import { createAudioSettingsStore } from '../state/audio-settings-store.js';
import { createAudioViewStore, type AudioViewStore } from '../state/audio-view-store.js';
import { createStateStorage } from '../state/state-storage.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { PlaybackModes } from './playback-modes.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('audio');

const CANNOT = 'Loudness normalisation measures the whole of its input before it plays anything.';

function draw(audio: AudioViewStore): void {
  render(
    <PlaybackModes
      audio={audio}
      settings={createAudioSettingsStore(
        createStateStorage(ephemeralStorage(), logger, () => undefined),
        logger,
      )}
    />,
  );
}

function reading(term: string): string {
  return screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent ?? '';
}

/** What the hint named `label` explains, opened as a person opens it, then closed again. */
async function hinted(label: string): Promise<string> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: label }));
  const text = screen.getByRole('dialog', { name: label }).textContent;
  await user.keyboard('{Escape}');
  return text;
}

function report(overrides: Partial<RenderReport>): RenderReport {
  return {
    id: 1,
    phase: RenderPhase.Making,
    reached: 40_000,
    length: 100_000,
    purposes: [CachePurpose.Playback],
    reason: CANNOT,
    failure: undefined,
    ...overrides,
  };
}

describe('playback heard from a cached preview', () => {
  it('shows the cached mode, why, and how far the preview has been made', async () => {
    const audio = createAudioViewStore();
    draw(audio);
    act(() => {
      audio.showPreviews({ renders: [report({})], begun: 1 });
    });

    expect(reading('Playback')).toBe('Cached preview');
    expect(await hinted('Why playback runs so')).toBe(`Playing from a cached preview. ${CANNOT}`);
    expect(reading('Preview')).toBe('Making');
    expect(await hinted('About the cached preview')).toBe('It is being made: 40% so far.');
    const progress = screen.getByRole('progressbar', { name: 'Cached preview made' });
    // The design system's bar counts to a hundred: 40,000 of 100,000 frames made.
    expect(progress).toHaveAttribute('aria-valuenow', '40');
    expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByRole('status')).toHaveTextContent('Making the preview: 40%');

    act(() => {
      audio.showPreviews({
        renders: [report({ phase: RenderPhase.Made, reached: 100_000 })],
        begun: 1,
      });
    });
    expect(reading('Preview')).toBe('Cached');
    expect(await hinted('About the cached preview')).toBe('It is made, and plays from memory.');
  });

  it('says why a preview could not be made', async () => {
    const audio = createAudioViewStore();
    draw(audio);
    act(() => {
      audio.showPreviews({
        renders: [report({ phase: RenderPhase.Failed, failure: 'The model was refused.' })],
        begun: 1,
      });
    });
    expect(reading('Preview')).toBe('Not made');
    expect(await hinted('About the cached preview')).toBe(
      'It could not be made: The model was refused.',
    );
  });

  it('plays live while only a waveform or an analysis reads a render', () => {
    const audio = createAudioViewStore();
    draw(audio);
    act(() => {
      audio.showPreviews({
        renders: [report({ purposes: [CachePurpose.Waveform, CachePurpose.Analysis] })],
        begun: 1,
      });
    });
    expect(reading('Playback')).toBe('Real-time processing');
    expect(screen.queryByText('Preview', { selector: 'dt' })).toBeNull();
    expect(screen.queryByRole('progressbar', { name: 'Cached preview made' })).toBeNull();
  });
});
