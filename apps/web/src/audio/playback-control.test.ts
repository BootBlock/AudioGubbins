import { describe, expect, it, vi } from 'vitest';

import { FailureKind, fail, failure } from '@audiogubbins/domain';
import { PerformanceProfile, TransportMode } from '@audiogubbins/audio-engine';
import { PlaybackPhase } from '@audiogubbins/audio-runtime';

import { createAudioViewStore } from '../state/audio-view-store.js';
import { FAKE_CONTEXT_RATE, FakePlayback, playbackSettled } from '../testing/audio-fakes.js';
import { PlaybackControl } from './playback-control.js';

/** A control over fake parts, and what it reports. */
function rig() {
  const view = createAudioViewStore();
  const parts = new FakePlayback();
  const announce = vi.fn<(text: string) => void>();
  const control = new PlaybackControl({ view, open: parts.open, announce });
  const settled = () => playbackSettled(view);
  return { view, parts, announce, control, settled };
}

describe('playing the test signal', () => {
  it('makes nothing until Play is pressed', () => {
    const { parts } = rig();
    expect(parts.opened).toEqual([]);
  });

  it('starts the context inside the Play itself, before anything is awaited', () => {
    // A browser starts audio only from inside the gesture, so a context
    // started after the first await could be refused.
    const { control, parts, view } = rig();

    control.play();

    expect(parts.opened).toHaveLength(1);
    expect(parts.opened[0]?.contextStarts).toBe(1);
    expect(view.get().starting).toBe(true);
  });

  it('loads the test signal at the context’s rate and plays it, and says so', async () => {
    const { control, parts, view, announce, settled } = rig();

    control.play();
    await settled();

    const session = parts.latest();
    expect(session.loads).toHaveLength(1);
    const [source] = session.loads[0]?.sources.values() ?? [];
    expect(source?.sampleRate).toBe(FAKE_CONTEXT_RATE);
    expect(view.get().playback?.transport.mode).toBe(TransportMode.Playing);
    expect(view.get()).toMatchObject({ starting: false, problems: [] });
    expect(announce).toHaveBeenCalledWith('The test signal is playing.');
  });

  it('plays the loaded graph again without loading it twice', async () => {
    const { control, parts, settled } = rig();
    control.play();
    await settled();
    control.pause();

    control.play();
    await settled();

    expect(parts.opened).toHaveLength(1);
    expect(parts.latest().loads).toHaveLength(1);
    expect(parts.latest().status.transport.mode).toBe(TransportMode.Playing);
  });

  it('loads the signal again after the processor refused it', async () => {
    const { control, parts, settled } = rig();
    control.play();
    await settled();
    const session = parts.latest();
    session.show({ ...session.status, phase: PlaybackPhase.Faulted, problems: ['It stopped.'] });

    control.play();
    await settled();

    expect(session.loads).toHaveLength(2);
  });

  it('pauses and stops the session, and refuses both with nothing made', async () => {
    const { control, parts, settled } = rig();
    expect(control.pause()).toEqual(['Nothing is playing.']);
    expect(control.stop()).toEqual(['Nothing is playing.']);

    control.play();
    await settled();
    expect(control.pause()).toBeUndefined();
    expect(parts.latest().status.transport.mode).toBe(TransportMode.Paused);
    expect(control.stop()).toBeUndefined();
    expect(parts.latest().status.transport.mode).toBe(TransportMode.Stopped);
  });

  it('shows why the browser would not start the audio, and says it', async () => {
    const { control, parts, view, announce, settled } = rig();
    parts.playRefusal = fail(
      failure('audio.context-resume-refused', FailureKind.Retryable, 'Press Play again.'),
    );

    control.play();
    await settled();

    expect(view.get()).toMatchObject({ starting: false, problems: ['Press Play again.'] });
    expect(announce).toHaveBeenCalledWith('Press Play again.');
  });

  it('reports an engine that could not be loaded, and tries again on the next Play', async () => {
    const { control, parts, view, settled } = rig();
    parts.loadingFails = new Error('The chunk could not be fetched.');

    control.play();
    await settled();

    expect(view.get().problems).toEqual([
      'The audio engine could not be started: The chunk could not be fetched.',
    ]);
    expect(parts.opened[0]?.closed).toBe(true);

    parts.loadingFails = undefined;
    control.play();
    await settled();
    expect(parts.opened).toHaveLength(2);
    expect(view.get().playback?.transport.mode).toBe(TransportMode.Playing);
  });

  it('reads the audible position from the session, and none before there is one', async () => {
    const { control, parts, settled } = rig();
    expect(control.audiblePosition()).toBeUndefined();

    control.play();
    await settled();
    parts.latest().contextFrame = 4_800;

    expect(control.audiblePosition()).toBe(4_800);
  });
});

describe('changing the performance profile', () => {
  it('only records the choice while nothing has been made', () => {
    const { control, parts, view } = rig();

    control.useProfile(PerformanceProfile.LowLatency);

    expect(view.get().profile).toBe(PerformanceProfile.LowLatency);
    expect(parts.opened).toEqual([]);
  });

  it('makes the next Play with the profile chosen', async () => {
    const { control, parts, settled } = rig();
    control.useProfile(PerformanceProfile.MaximumStability);

    control.play();
    await settled();

    expect(parts.opened[0]?.profile).toBe(PerformanceProfile.MaximumStability);
  });

  it('closes a playing context and goes on from the same place in a new one', async () => {
    const { control, parts, view, settled } = rig();
    control.play();
    await settled();
    const first = parts.latest();
    first.contextFrame = 9_600;

    control.useProfile(PerformanceProfile.LowLatency);
    await settled();

    expect(parts.opened[0]?.closed).toBe(true);
    expect(first.disposed).toBe(true);
    expect(parts.opened[1]).toMatchObject({
      profile: PerformanceProfile.LowLatency,
      contextStarts: 1,
    });
    expect(parts.latest().seeks).toEqual([9_600]);
    expect(view.get().playback?.transport.mode).toBe(TransportMode.Playing);
  });

  it('keeps where a paused transport was for the next Play, and makes nothing until then', async () => {
    const { control, parts, settled } = rig();
    control.play();
    await settled();
    parts.latest().contextFrame = 4_800;
    control.pause();

    control.useProfile(PerformanceProfile.LowLatency);
    expect(parts.opened).toHaveLength(1);
    expect(parts.opened[0]?.closed).toBe(true);

    control.play();
    await settled();
    expect(parts.latest().seeks).toEqual([4_800]);
  });

  it('closes what it made when disposed, and shows no playback', async () => {
    const { control, parts, view, settled } = rig();
    control.play();
    await settled();

    control.dispose();

    expect(parts.opened[0]?.closed).toBe(true);
    expect(parts.latest().disposed).toBe(true);
    expect(view.get().playback).toBeUndefined();
  });
});
