import { describe, expect, it, vi } from 'vitest';

import {
  FailureKind,
  QualityLevel,
  fail,
  failure,
  namedQualityMode,
  sampleCount,
  sampleRate,
  unsafeBrandId,
  type EffectChain,
  type QualityMode,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { PerformanceProfile, TransportMode } from '@audiogubbins/audio-engine';
import { rackedPlan } from '@audiogubbins/audio-engine/testing';
import { PlaybackPhase } from '@audiogubbins/audio-runtime';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { createAudioSettingsStore, previewQualityOf } from '../state/audio-settings-store.js';
import { createAudioViewStore } from '../state/audio-view-store.js';
import { createStateStorage } from '../state/state-storage.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { FAKE_CONTEXT_RATE, FakePlayback, playbackSettled } from '../testing/audio-fakes.js';
import { PlaybackControl } from './playback-control.js';
import type { Programme } from './programme.js';
import { TEST_SIGNAL_PROGRAMME } from './test-signal.js';

/** A control over fake parts, and what it reports. */
function rig() {
  const view = createAudioViewStore();
  const parts = new FakePlayback();
  const announce = vi.fn<(text: string) => void>();
  const store = createLogStore();
  const logger = createDiagnosticCentre(store, { now: () => 0 }).loggerFor('audio');
  const settings = createAudioSettingsStore(
    createStateStorage(ephemeralStorage(), logger, () => undefined),
    logger,
  );
  const control = new PlaybackControl({
    view,
    open: parts.open,
    profile: () => settings.get().chosen,
    quality: () => previewQualityOf(settings.get()),
    announce,
    logger,
  });
  /** What the control recorded in the diagnostic log. */
  const logged = (): readonly string[] => store.snapshot().map((record) => record.message);
  const settled = () => playbackSettled(view);
  /** Chooses a profile as its command does: in the settings, and then for playback. */
  const choose = (profile: PerformanceProfile) => {
    settings.chooseProfile(profile);
    control.useProfile(settings.get().chosen);
  };
  /** Chooses a preview quality as its command does: in the settings, and then for playback. */
  const preview = (mode: QualityMode | undefined) => {
    settings.choosePreviewQuality(mode);
    control.usePreviewQuality();
  };
  return { view, parts, announce, control, settled, settings, choose, preview, logged };
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

    control.play(TEST_SIGNAL_PROGRAMME);

    expect(parts.opened).toHaveLength(1);
    expect(parts.opened[0]?.contextStarts).toBe(1);
    expect(view.get().starting).toBe(true);
  });

  it('loads the test signal at the context’s rate and plays it, and says so', async () => {
    const { control, parts, view, announce, settled } = rig();

    control.play(TEST_SIGNAL_PROGRAMME);
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
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    control.pause();

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    expect(parts.opened).toHaveLength(1);
    expect(parts.latest().loads).toHaveLength(1);
    expect(parts.latest().status.transport.mode).toBe(TransportMode.Playing);
  });

  it('loads the signal again after the processor refused it', async () => {
    const { control, parts, settled } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    const session = parts.latest();
    session.show({ ...session.status, phase: PlaybackPhase.Faulted, problems: ['It stopped.'] });

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    expect(session.loads).toHaveLength(2);
  });

  it('pauses and stops the session, and refuses both with nothing made', async () => {
    const { control, parts, settled } = rig();
    expect(control.pause()).toEqual(['Nothing is playing.']);
    expect(control.stop()).toEqual(['Nothing is playing.']);

    control.play(TEST_SIGNAL_PROGRAMME);
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

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    expect(view.get()).toMatchObject({ starting: false, problems: ['Press Play again.'] });
    expect(announce).toHaveBeenCalledWith('Press Play again.');
  });

  it('reports an engine that could not be loaded, and tries again on the next Play', async () => {
    const { control, parts, view, settled } = rig();
    parts.loadingFails = new Error('The chunk could not be fetched.');

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    expect(view.get().problems).toEqual([
      'The audio engine could not be started: The chunk could not be fetched.',
    ]);
    expect(parts.opened[0]?.closed).toBe(true);

    parts.loadingFails = undefined;
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    expect(parts.opened).toHaveLength(2);
    expect(view.get().playback?.transport.mode).toBe(TransportMode.Playing);
  });

  it('reports a context the browser would not make as the Play’s refusal', async () => {
    const { control, parts, view, announce, settled } = rig();
    const reason = 'The browser would not start audio: The sample rate is not supported.';
    parts.contextRefusal = fail(
      failure('audio.context-unavailable', FailureKind.Unrecoverable, reason),
    );

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    expect(view.get()).toMatchObject({ starting: false, problems: [reason] });
    expect(announce).toHaveBeenCalledWith(reason);
    expect(parts.latest().loads).toEqual([]);
  });

  it('ends a Play that met a fault with the reason, and records it', async () => {
    const { control, parts, view, settled, logged } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    const fault = new TypeError('Cannot read properties of undefined.');
    vi.spyOn(parts.latest(), 'load').mockRejectedValueOnce(fault);
    await settled();

    expect(view.get()).toMatchObject({
      starting: false,
      problems: ['Playback stopped on a fault: Cannot read properties of undefined.'],
    });
    expect(logged()).toContain('Playback stopped on a fault.');
    expect(parts.opened[0]?.closed).toBe(true);
  });

  it('records a context that could not be closed', async () => {
    const { control, parts, settled, logged } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    parts.closeFails = new TypeError('Illegal invocation.');

    control.dispose();
    await Promise.resolve();
    await Promise.resolve();

    expect(logged()).toContain('The audio context could not be closed.');
  });

  it('reads the audible position from the session, and none before there is one', async () => {
    const { control, parts, settled } = rig();
    expect(control.audiblePosition()).toBeUndefined();

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    parts.latest().contextFrame = 4_800;

    expect(control.audiblePosition()).toBe(4_800);
  });
});

describe('the playhead of a programme', () => {
  it('is the frame heard while playing, and where the transport stands once it is sought paused', async () => {
    const { control, parts, settled } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    const session = parts.latest();
    session.contextFrame = 4_800;
    session.heard = expectSuccess(sampleCount(4_700));
    expect(control.playheadPosition()).toBe(4_700);

    control.pause();
    expect(control.seek(TEST_SIGNAL_PROGRAMME.key, expectSuccess(sampleCount(1_000)))).toBe(true);
    await Promise.resolve();

    // The audio thread has heard nothing new, and the playhead is where it was put.
    expect(control.audiblePosition()).toBe(4_700);
    expect(control.playheadPosition()).toBe(1_000);
  });

  it('stays where the listener stopped hearing when paused, plays on from there, and stops where the play began', async () => {
    const { control, parts, settled } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    const session = parts.latest();
    session.contextFrame = 4_800;
    session.heard = expectSuccess(sampleCount(3_840));

    control.pause();
    session.heard = undefined;

    expect(control.playheadPosition()).toBe(3_840);
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    expect(control.playheadPosition()).toBe(3_840);

    control.stop();
    expect(control.playheadPosition()).toBe(0);
  });

  it('is moved only where the transport holds the programme named', async () => {
    const { control, settled } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    expect(control.seek('test:loop', expectSuccess(sampleCount(10)))).toBe(false);
    expect(control.programme()).toBe(TEST_SIGNAL_PROGRAMME.key);
  });
});

describe('changing the performance profile', () => {
  it('makes nothing when a profile is chosen before anything has been made', () => {
    const { parts, choose } = rig();

    choose(PerformanceProfile.LowLatency);

    expect(parts.opened).toEqual([]);
  });

  it('makes the next Play with the profile chosen', async () => {
    const { control, parts, settled, choose } = rig();
    choose(PerformanceProfile.MaximumStability);

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    expect(parts.opened[0]?.profile.profile).toBe(PerformanceProfile.MaximumStability);
  });

  it('closes a playing context and goes on from the same place in a new one', async () => {
    const { control, parts, view, settled, choose } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    const first = parts.latest();
    first.contextFrame = 9_600;

    choose(PerformanceProfile.LowLatency);
    await settled();

    expect(parts.opened[0]?.closed).toBe(true);
    expect(first.disposed).toBe(true);
    expect(parts.opened[1]).toMatchObject({
      profile: { profile: PerformanceProfile.LowLatency },
      contextStarts: 1,
    });
    expect(parts.latest().seeks).toEqual([9_600]);
    expect(view.get().playback?.transport.mode).toBe(TransportMode.Playing);
  });

  it('keeps where a paused transport was for the next Play, and makes nothing until then', async () => {
    const { control, parts, settled, choose } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    parts.latest().contextFrame = 4_800;
    control.pause();

    choose(PerformanceProfile.LowLatency);
    expect(parts.opened).toHaveLength(1);
    expect(parts.opened[0]?.closed).toBe(true);

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    expect(parts.latest().seeks).toEqual([4_800]);
  });

  it('closes what it made when disposed, and shows no playback', async () => {
    const { control, parts, view, settled } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    control.dispose();

    expect(parts.opened[0]?.closed).toBe(true);
    expect(parts.latest().disposed).toBe(true);
    expect(view.get().playback).toBeUndefined();
  });
});

describe('changing the preview quality', () => {
  const HIGH = namedQualityMode(QualityLevel.High);

  /** The quality of each load of the latest session, by level. */
  const loadedLevels = (parts: FakePlayback) =>
    parts.latest().loads.map((request) => request.quality.level);

  it('loads at the quality the profile previews at until one is chosen', async () => {
    const { control, parts, settled } = rig();

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    expect(loadedLevels(parts)).toEqual([QualityLevel.Standard]);
  });

  it('loads again at the new quality in the same context, and plays on from the same place', async () => {
    const { control, parts, view, settled, preview } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    parts.latest().contextFrame = 9_600;

    preview(HIGH);
    await settled();

    expect(parts.opened).toHaveLength(1);
    expect(loadedLevels(parts)).toEqual([QualityLevel.Standard, QualityLevel.High]);
    expect(parts.latest().seeks).toEqual([9_600]);
    expect(view.get().playback?.transport.mode).toBe(TransportMode.Playing);
  });

  it('keeps where a paused transport was, and loads at the new quality on the next Play', async () => {
    const { control, parts, settled, preview } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    parts.latest().contextFrame = 4_800;
    control.pause();

    preview(HIGH);
    expect(parts.latest().loads).toHaveLength(1);

    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();
    expect(loadedLevels(parts)).toEqual([QualityLevel.Standard, QualityLevel.High]);
    expect(parts.latest().seeks).toEqual([4_800]);
  });

  it('loads nothing again when the quality in force has not changed', async () => {
    const { control, parts, settled, preview } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    preview(namedQualityMode(QualityLevel.Standard));
    preview(undefined);
    await settled();

    expect(loadedLevels(parts)).toEqual([QualityLevel.Standard]);
  });

  it('follows the profile while automatic, so a new profile previews at its own quality', async () => {
    const { control, parts, settled, choose } = rig();
    control.play(TEST_SIGNAL_PROGRAMME);
    await settled();

    choose(PerformanceProfile.LowLatency);
    await settled();

    expect(loadedLevels(parts)).toEqual([QualityLevel.Draft]);
  });
});

describe('following a programme the project changed while it plays', () => {
  const PROCESSOR = unsafeBrandId<'ProcessorId'>('00000000-9a1e');
  const LEVEL = unsafeBrandId<'ParameterId'>('9a1e0001-0001');
  const RATE = expectSuccess(sampleRate(48_000));

  /** The asset racked with a gain at `decibels`, bypassed where `bypassed`, as a programme. */
  function racked(decibels: number, bypassed = false): Programme {
    const chain: EffectChain = {
      id: unsafeBrandId<'EffectChainId'>('00000000-c4a1'),
      slots: [
        {
          kind: 'processor',
          id: PROCESSOR,
          typeKey: 'gain',
          enabled: !bypassed,
          soloed: false,
          mix: 1,
          version: { implementation: 1, parameters: 1 },
          values: new Map([[LEVEL, decibels]]),
        },
      ],
    };
    return {
      ...TEST_SIGNAL_PROGRAMME,
      key: 'asset:racked',
      content: `gain ${String(decibels)}${bypassed ? ' bypassed' : ''}`,
      plan: rackedPlan(chain, 48_000, RATE),
    };
  }

  it('gives a changed level to the running chains, loading nothing again', async () => {
    const { control, parts, settled } = rig();
    control.play(racked(-6));
    await settled();

    control.follow(racked(-3));
    await Promise.resolve();

    expect(parts.latest().changes).toEqual([
      [{ stream: 1, processor: PROCESSOR, parameter: LEVEL, value: -3 }],
    ]);
    expect(parts.latest().loads).toHaveLength(1);
    // The next Play of the changed programme plays what is loaded.
    control.pause();
    control.play(racked(-3));
    await settled();
    expect(parts.latest().loads).toHaveLength(1);
  });

  it('loads it again where it plays, and says so, where a chain is heard from a render made before', async () => {
    const { control, parts, settled, announce } = rig();
    control.play(racked(-6));
    await settled();
    const session = parts.latest();
    session.contextFrame = 9_600;
    session.changeResult = fail(
      failure('playback.parameter-rendered', FailureKind.Rejected, 'Made with the value before.'),
    );

    control.follow(racked(-3));
    // The refusal arrives after a turn, and the load it starts after that.
    await Promise.resolve();
    await settled();

    expect(session.loads).toHaveLength(2);
    expect(session.seeks).toEqual([9_600]);
    expect(announce).toHaveBeenCalledWith('The change is heard once its preview is made again.');
  });

  it('plays a programme loaded again while stopped from where the playhead was moved since', async () => {
    // Hearing the original after playing to the end, moving the playhead to
    // the start and pressing Play played on from the end, which is silence.
    const { control, parts, settled } = rig();
    control.play(racked(-6));
    await settled();
    parts.latest().contextFrame = 9_600;
    control.pause();
    control.follow(racked(-6, true));
    await settled();

    expect(control.seek('asset:racked', expectSuccess(sampleCount(0)))).toBe(true);
    control.play(racked(-6, true));
    await settled();

    expect(parts.latest().seeks.at(-1)).toBe(0);
  });

  it('loads anything else again where it plays, and a paused programme at the next Play', async () => {
    const { control, parts, settled } = rig();
    control.play(racked(-6));
    await settled();

    control.follow(racked(-6, true));
    await settled();
    expect(parts.latest().changes).toEqual([]);
    expect(parts.latest().loads).toHaveLength(2);

    control.pause();
    control.follow(racked(-3, true));
    await Promise.resolve();
    expect(parts.latest().loads).toHaveLength(2);
    parts.latest().changeResult = fail(
      failure('playback.parameter-rendered', FailureKind.Rejected, 'Made with the value before.'),
    );
    control.follow(racked(0, true));
    await Promise.resolve();
    await Promise.resolve();
    control.play(racked(0, true));
    await settled();
    expect(parts.latest().loads).toHaveLength(3);
  });
});
