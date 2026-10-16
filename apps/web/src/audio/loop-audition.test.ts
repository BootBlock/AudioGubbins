import { describe, expect, it } from 'vitest';

import { PcmDescriptionKind, TransportMode } from '@audiogubbins/audio-engine';
import type { PlaybackRequest } from '@audiogubbins/audio-runtime';
import { streamLength, type EditPlan } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { loopAuditionPlan, type LoopAuditionMode } from '@audiogubbins/loop-analysis';
import { sine } from '@audiogubbins/test-fixtures';

import { regionLoopOf, type RegionLoop } from '../analysis/loop-analysing.js';
import { regionEntryId } from '../assets/project-entry.js';
import { playbackSettled } from '../testing/audio-fakes.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { ManualSchedule } from '../testing/shell-context.js';
import { LoopAuditioning, type AuditionRequest } from './loop-audition.js';

holdPlatformFiles();

const CYCLES: LoopAuditionMode = { kind: 'cycles', leadInFrames: 48_000 };

/**
 * Half a second of a 480 Hz sine in a region of all of it, looped over 0.3 s
 * with a crossfade of 480 frames, and an audition of it over the window's
 * transport, its watch of the feeder run when the test says.
 */
async function auditioned(): Promise<{
  readonly audio: AudioWindow;
  readonly looped: RegionLoop;
  readonly auditions: LoopAuditioning;
  readonly timers: ManualSchedule;
  readonly request: AuditionRequest;
}> {
  const audio = await windowWithAudio({
    fixture: sine(480, { length: 24_000 }),
    regions: [{ name: 'Hum', start: 0, end: 24_000 }],
  });
  const { context } = audio.window;
  const [placed] = audio.asset().regions;
  if (placed === undefined) throw new Error('The region was not added.');
  context.editorViews.open('editor', audio.asset());
  context.editorViews.focus('editor');
  audio.window.run('region.open', { region: placed.id });
  audio.window.run('editor.select-time', { start: 4_800, end: 19_200 });
  await audio.window.runAndHear('region.loop', { crossfade: 480 });
  await expect
    .poll(() => context.assets.find(regionEntryId(placed.id))?.owner, { timeout: 5000 })
    .toMatchObject({ region: { loop: { crossfadeLength: 480 } } });
  const sound = context.assets.find(regionEntryId(placed.id));
  if (sound === undefined) throw new Error('The region is not open.');
  const looped = regionLoopOf(sound, audio.session.getSnapshot().model.state);
  if (typeof looped === 'string') throw new Error(looped);
  const timers = new ManualSchedule();
  const auditions = new LoopAuditioning({
    playback: context.playback,
    audio: context.audio,
    schedule: timers.schedule,
  });
  const request: AuditionRequest = {
    region: placed.id,
    name: 'Hum',
    sound,
    describedWith: looped.describedWith,
    heard: looped.heard,
    loop: looped.loop,
    mode: CYCLES,
  };
  return { audio, looped, auditions, timers, request };
}

/** The plan a playback request plays. */
function planOf(request: PlaybackRequest | undefined): EditPlan {
  const [source] = request?.sources ?? [];
  if (source?.kind !== PcmDescriptionKind.Edited) throw new Error('No edited sound was asked for.');
  return source.plan;
}

describe('hearing a loop by cycling it (ADR-0103)', () => {
  it('plays cycles of the region as it is heard, its loop’s crossfade realised', async () => {
    const { audio, looped, auditions, request } = await auditioned();

    expect(auditions.start(request)).toBeUndefined();
    await playbackSettled(audio.window.context.audio);

    const plan = planOf(audio.window.audio.playback.latest().loads[0]);
    const heard = expectSuccess(loopAuditionPlan(looped.heard, looped.loop, CYCLES, 1)).plan;
    const plain = expectSuccess(loopAuditionPlan(looped.plain, looped.loop, CYCLES, 1)).plan;
    // Every stream after the audition's own is the region's plan as heard.
    expect(plan.streams.slice(1)).toEqual(heard.streams.slice(1));
    expect(plan.streams.slice(1)).not.toEqual(plain.streams.slice(1));
    // At least four seconds of cycles after the second's lead-in.
    expect(streamLength(plan.streams[0])).toBeGreaterThanOrEqual(4_800 + 4 * 48_000);
    expect(auditions.get()).toEqual({ region: request.region, name: 'Hum', mode: 'cycles' });
  });

  it('goes on into more cycles before the feeder reaches the end, every frame before it unchanged', async () => {
    const { audio, auditions, timers, request } = await auditioned();
    auditions.start(request);
    await playbackSettled(audio.window.context.audio);
    const session = audio.window.audio.playback.latest();
    const first = planOf(session.loads[0]);
    const end = streamLength(first.streams[0]);

    // Still more than two seconds ahead of the feeder: nothing to do.
    session.readAhead = end - 3 * 48_000;
    timers.runDue();
    expect(session.continuations).toEqual([]);

    session.readAhead = end - 48_000;
    timers.runDue();
    await expect.poll(() => session.continuations.length).toBe(1);

    const [continued] = session.continuations;
    expect(continued?.from).toBe(end);
    const longer = planOf(continued?.request);
    expect(streamLength(longer.streams[0])).toBeGreaterThan(end);
    expect(longer.streams[0].segments.slice(0, first.streams[0].segments.length)).toEqual(
      first.streams[0].segments,
    );
    expect(longer.streams.slice(1)).toEqual(first.streams.slice(1));
    expect(session.loads).toHaveLength(1);
  });

  it('ends when the transport stops, extending nothing more', async () => {
    const { audio, auditions, timers, request } = await auditioned();
    auditions.start(request);
    await playbackSettled(audio.window.context.audio);
    const session = audio.window.audio.playback.latest();

    audio.window.context.playback.stop();
    session.readAhead = 1_000_000;
    timers.runDue();

    expect(auditions.get()).toBeUndefined();
    timers.runDue();
    expect(session.continuations).toEqual([]);
  });

  it('is stopped, the transport with it, once', async () => {
    const { audio, auditions, request } = await auditioned();
    auditions.start(request);
    await playbackSettled(audio.window.context.audio);

    expect(auditions.stop()).toBe(true);
    expect(auditions.get()).toBeUndefined();
    expect(audio.window.context.audio.get().playback?.transport.mode).toBe(TransportMode.Stopped);
    expect(auditions.stop()).toBe(false);
  });

  it('refuses a seam with nothing either side', async () => {
    const { auditions, request } = await auditioned();

    expect(auditions.start({ ...request, mode: { kind: 'seam', sideFrames: 0 } })).toBe(
      'A seam audition plays at least one frame each side.',
    );
    expect(auditions.get()).toBeUndefined();
  });
});
