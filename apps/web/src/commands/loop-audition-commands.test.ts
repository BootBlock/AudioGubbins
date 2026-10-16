import { describe, expect, it } from 'vitest';

import { PcmDescriptionKind } from '@audiogubbins/audio-engine';
import type { PlaybackRequest } from '@audiogubbins/audio-runtime';
import { derivedSampleCount, regionPlan, type EditPlan, type RegionId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { loopAuditionPlan } from '@audiogubbins/loop-analysis';
import { sine } from '@audiogubbins/test-fixtures';

import { regionLoopOf } from '../analysis/loop-analysing.js';
import { planContextOf } from '../assets/project-assets.js';
import { regionEntryId } from '../assets/project-entry.js';
import { playbackSettled } from '../testing/audio-fakes.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

const SEARCHING = { timeout: 120_000 };

/**
 * Half a second of a 480 Hz sine in a region of all of it, open in a view of
 * its own, looped over `range` with `crossfade`, or over all of it.
 */
async function loopedSine(
  range?: { readonly start: number; readonly end: number },
  crossfade = 0,
): Promise<{ readonly audio: AudioWindow; readonly region: RegionId }> {
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
  if (range !== undefined) audio.window.run('editor.select-time', range);
  await audio.window.runAndHear('region.loop', { crossfade });
  await expect
    .poll(() => context.assets.find(regionEntryId(placed.id))?.owner, { timeout: 5000 })
    .toMatchObject({ region: { loop: { crossfadeLength: crossfade } } });
  return { audio, region: placed.id };
}

/** The plan a playback request plays. */
function planOf(request: PlaybackRequest | undefined): EditPlan {
  const [source] = request?.sources ?? [];
  if (source?.kind !== PcmDescriptionKind.Edited) throw new Error('No edited sound was asked for.');
  return source.plan;
}

/** The region's loop as heard now. */
function loopOf(audio: AudioWindow, region: RegionId) {
  const sound = audio.window.context.assets.find(regionEntryId(region));
  if (sound === undefined) throw new Error('The region is not open.');
  const looped = regionLoopOf(sound, audio.session.getSnapshot().model.state);
  if (typeof looped === 'string') throw new Error(looped);
  return looped;
}

describe('hearing a region’s loop', () => {
  it('cycles the loop as heard, starting it again when asked again', async () => {
    const { audio, region } = await loopedSine({ start: 4_800, end: 19_200 }, 480);
    const { context } = audio.window;
    const looped = loopOf(audio, region);

    expect(audio.window.run('loop.audition-cycles').kind).toBe('applied');
    await playbackSettled(context.audio);
    const first = context.loopAudition.get();
    const session = audio.window.audio.playback.latest();
    const mode = { kind: 'cycles', leadInFrames: 48_000 } as const;
    const heard = expectSuccess(loopAuditionPlan(looped.heard, looped.loop, mode, 1)).plan;
    expect(planOf(session.loads[0]).streams.slice(1)).toEqual(heard.streams.slice(1));
    expect(audio.window.said).toContain('Cycling the loop of “Hum” until you stop it.');

    expect(audio.window.run('loop.audition-cycles').kind).toBe('applied');
    await playbackSettled(context.audio);
    expect(context.loopAudition.get()).not.toBe(first);
    expect(session.loads).toHaveLength(2);
  });

  it('stress-tests the seam, the half second either side of it again and again', async () => {
    const { audio } = await loopedSine({ start: 4_800, end: 19_200 });
    const { context } = audio.window;

    audio.window.run('loop.audition-seam');
    await playbackSettled(context.audio);

    expect(context.loopAudition.get()?.mode).toBe('seam');
    const [own] = planOf(audio.window.audio.playback.latest().loads[0]).streams;
    expect(own.segments.slice(0, 2).map(({ start, length }) => [start, length])).toEqual([
      [19_200 - 14_400, 14_400],
      [4_800, 14_400],
    ]);
  });

  it('stops hearing it once, and refuses with nothing heard', async () => {
    const { audio } = await loopedSine({ start: 4_800, end: 19_200 });
    audio.window.run('loop.audition-cycles');
    await playbackSettled(audio.window.context.audio);

    expect(audio.window.run('loop.stop-audition').kind).toBe('applied');
    expect(audio.window.context.loopAudition.get()).toBeUndefined();
    expect(audio.window.run('loop.stop-audition')).toMatchObject({
      kind: 'refused',
      failures: [{ summary: 'No loop is being heard.' }],
    });
  });

  it(
    'hears a candidate’s loop with its crossfade, writing nothing to the region',
    SEARCHING,
    async () => {
      const { audio, region } = await loopedSine();
      const { context } = audio.window;
      expect(audio.window.run('loop.audition-candidate')).toMatchObject({
        kind: 'refused',
        failures: [{ summary: 'The loop of “Hum” has not been analysed this session.' }],
      });
      audio.window.run('loop.find-candidates');
      await expect
        .poll(() => context.loopAnalysis.analyses.of(region)?.kind, { timeout: 60_000 })
        .toBe('done');
      const record = context.loopAnalysis.analyses.of(region);
      const room =
        record?.kind === 'done'
          ? record.analysis.candidates.find((one) => one.makesRoomForCrossfade)
          : undefined;
      if (room?.crossfade === undefined) throw new Error('No candidate made room for a crossfade.');
      const state = audio.session.getSnapshot().model.state;

      expect(
        audio.window.run('loop.audition-candidate', { rank: room.rank, crossfade: true }).kind,
      ).toBe('applied');
      await playbackSettled(context.audio);

      expect(audio.session.getSnapshot().model.state).toBe(state);
      expect(context.loopAudition.get()).toMatchObject({ candidate: room.rank, mode: 'cycles' });
      const asset = state.project.assets.get(audio.assetId);
      const kept = state.project.regions.get(loopOf(audio, region).region.id);
      if (asset === undefined || kept === undefined) throw new Error('The region is not kept.');
      const withCandidate = expectSuccess(
        regionPlan(
          asset,
          {
            ...kept,
            loop: {
              basis: 0,
              start: derivedSampleCount(room.start),
              end: derivedSampleCount(room.end),
              crossfadeLength: derivedSampleCount(room.crossfade.lengthFrames),
              crossfadeShape: room.crossfade.shape,
            },
          },
          planContextOf(state),
        ),
      );
      const expected = expectSuccess(
        loopAuditionPlan(
          withCandidate,
          {
            loopStart: derivedSampleCount(room.start),
            loopEnd: derivedSampleCount(room.end),
            crossfadeLength: derivedSampleCount(room.crossfade.lengthFrames),
            crossfadeShape: room.crossfade.shape,
          },
          { kind: 'cycles', leadInFrames: 48_000 },
          1,
        ),
      ).plan;
      const played = planOf(audio.window.audio.playback.latest().loads.at(-1));
      expect(played.streams.slice(1)).toEqual(expected.streams.slice(1));
    },
  );
});
