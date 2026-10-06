import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { CachePurpose, RenderPhase, type RenderReport } from '@audiogubbins/audio-engine';

import { createAudioSettingsStore } from '../state/audio-settings-store.js';
import { createAudioViewStore, type AudioViewStore } from '../state/audio-view-store.js';
import { createRenderStrategyStore } from '../state/render-strategy-store.js';
import { createStateStorage } from '../state/state-storage.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { ProcessingModes } from './processing-modes.js';

const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('audio');

const CANNOT = 'Loudness normalisation measures the whole of its input before it plays anything.';

function draw(audio: AudioViewStore): void {
  render(
    <ProcessingModes
      audio={audio}
      settings={createAudioSettingsStore(
        createStateStorage(ephemeralStorage(), logger, () => undefined),
        logger,
      )}
      strategy={createRenderStrategyStore()}
      run={vi.fn()}
      unavailableReason={() => undefined}
    />,
  );
}

function reading(term: string): string {
  return screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent ?? '';
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
  it('shows the cached mode, why, and how far the preview has been made', () => {
    const audio = createAudioViewStore();
    draw(audio);
    act(() => {
      audio.showPreviews({ renders: [report({})], begun: 1 });
    });

    expect(reading('Playback')).toBe(
      `Cached previewPlaying from a cached preview. ${CANNOT} It is being made: 40% so far.`,
    );
    const progress = screen.getByRole('progressbar', { name: 'Cached preview made' });
    expect(progress).toHaveAttribute('value', '40000');
    expect(progress).toHaveAttribute('max', '100000');
    expect(screen.getByRole('status')).toHaveTextContent('Making the preview: 40%');

    act(() => {
      audio.showPreviews({
        renders: [report({ phase: RenderPhase.Made, reached: 100_000 })],
        begun: 1,
      });
    });
    expect(reading('Playback')).toBe(
      `Cached previewPlaying from a cached preview. ${CANNOT} It is made, and plays from memory.`,
    );
  });

  it('says why a preview could not be made', () => {
    const audio = createAudioViewStore();
    draw(audio);
    act(() => {
      audio.showPreviews({
        renders: [report({ phase: RenderPhase.Failed, failure: 'The model was refused.' })],
        begun: 1,
      });
    });
    expect(reading('Playback')).toContain('It could not be made: The model was refused.');
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
    expect(reading('Playback')).toMatch(/^Real-time processing/);
    expect(screen.queryByRole('progressbar', { name: 'Cached preview made' })).toBeNull();
  });
});
