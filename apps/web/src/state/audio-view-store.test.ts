import { describe, expect, it, vi } from 'vitest';

import { DspImplementation, PerformanceProfile } from '@audiogubbins/audio-engine';

import { UNLOADED } from '../testing/audio-fakes.js';
import { RenderStage, createAudioViewStore, type RenderResult } from './audio-view-store.js';

const RESULT: RenderResult = {
  frames: 480_000,
  sampleRate: 48_000,
  milliseconds: 812,
  dsp: DspImplementation.WebAssembly,
  fallbackReason: undefined,
  fingerprint: 0x0123_4567_89ab_cdefn,
};

describe('the audio engine view', () => {
  it('starts Balanced, with nothing played and nothing rendered', () => {
    const view = createAudioViewStore().get();

    expect(view.profile).toBe(PerformanceProfile.Balanced);
    expect(view.playback).toBeUndefined();
    expect(view.starting).toBe(false);
    expect(view.problems).toEqual([]);
    expect(view.render).toEqual({ stage: RenderStage.Idle });
  });

  it('keeps the profile chosen, and tells nobody when it is chosen again', () => {
    const store = createAudioViewStore();
    const heard = vi.fn();
    store.subscribe(heard);

    store.chooseProfile(PerformanceProfile.MaximumStability);
    store.chooseProfile(PerformanceProfile.MaximumStability);

    expect(store.get().profile).toBe(PerformanceProfile.MaximumStability);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('clears what the last Play reported when another is asked for', () => {
    const store = createAudioViewStore();
    store.playbackStarting();
    store.playbackSettled(['The browser would not start audio.']);
    expect(store.get()).toMatchObject({
      starting: false,
      problems: ['The browser would not start audio.'],
    });

    store.playbackStarting();

    expect(store.get()).toMatchObject({ starting: true, problems: [] });
  });

  it('shows the session’s status, and none once the session has gone', () => {
    const store = createAudioViewStore();

    store.showPlayback(UNLOADED);
    expect(store.get().playback).toBe(UNLOADED);

    store.showPlayback(undefined);
    expect(store.get().playback).toBeUndefined();
  });

  it('follows a render from its progress to its result, or to its reasons', () => {
    const store = createAudioViewStore();

    store.renderProgressed(24_000, 480_000);
    expect(store.get().render).toEqual({
      stage: RenderStage.Running,
      framesRendered: 24_000,
      framesTotal: 480_000,
    });

    store.renderFinished(RESULT);
    expect(store.get().render).toEqual({ stage: RenderStage.Finished, result: RESULT });

    store.renderFailed(['The render worker stopped.']);
    expect(store.get().render).toEqual({
      stage: RenderStage.Failed,
      reasons: ['The render worker stopped.'],
    });
  });
});
