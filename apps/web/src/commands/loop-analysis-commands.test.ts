import type { RegionId } from '@audiogubbins/domain';
import { describe, expect, it } from 'vitest';

import { sine } from '@audiogubbins/test-fixtures';

import { regionEntryId } from '../assets/project-entry.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';

holdPlatformFiles();

/** A search measures hundreds of pairs in the worker's core, run in the test's thread. */
const SEARCHING = { timeout: 120_000 };

/** Half a second of a 480 Hz sine, in a region of all of it, open in a view of its own. */
async function sineRegion(): Promise<{ readonly audio: AudioWindow; readonly region: RegionId }> {
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
  return { audio, region: placed.id };
}

/** The region as the project keeps it now. */
function kept(audio: AudioWindow, region: RegionId) {
  return [...audio.session.getSnapshot().model.state.project.regions.values()].find(
    (one) => one.id === region,
  );
}

/** Loops the region over `range`, or all of it, with `crossfade`, and waits for its sound to follow. */
async function looped(
  audio: AudioWindow,
  region: RegionId,
  range?: { readonly start: number; readonly end: number },
  crossfade = 0,
): Promise<void> {
  if (range !== undefined) audio.window.run('editor.select-time', range);
  else audio.window.run('editor.clear-selection');
  const before = audio.window.context.assets.find(regionEntryId(region));
  await audio.window.runAndHear('region.loop', { crossfade });
  await expect
    .poll(() => audio.window.context.assets.find(regionEntryId(region)) !== before, {
      timeout: 5000,
    })
    .toBe(true);
}

/** Waits for the analysis of `region` to end, and answers its record. */
async function answered(audio: AudioWindow, region: RegionId) {
  const { loopAnalysis } = audio.window.context;
  await expect
    .poll(() => loopAnalysis.analyses.of(region)?.kind, { timeout: 60_000 })
    .not.toBe('running');
  return loopAnalysis.analyses.of(region);
}

describe('analysing a region’s loop', () => {
  it(
    'measures it, says how it is judged and changes nothing of the project',
    SEARCHING,
    async () => {
      const { audio, region } = await sineRegion();
      await looped(audio, region, { start: 4_800, end: 19_200 });
      const state = audio.session.getSnapshot().model.state;

      expect(audio.window.run('loop.analyse').kind).toBe('applied');
      const record = await answered(audio, region);

      expect(record?.kind).toBe('done');
      expect(audio.window.said).toContain('The loop of “Hum” passes every check.');
      expect(audio.session.getSnapshot().model.state).toBe(state);
      // Asked again of the same sound, it is current.
      expect(audio.window.run('loop.analyse')).toMatchObject({ kind: 'unchanged' });
    },
  );

  it('refuses a region that does not loop, saying how to loop it', async () => {
    const { audio } = await sineRegion();

    expect(audio.window.run('loop.analyse')).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            '“Hum” does not loop. Loop part of it first, with “Loop the selection of the region”.',
        },
      ],
    });
  });

  it('keeps a refused analysis as failed, saying why, and leaves the loop as it was', async () => {
    const { audio, region } = await sineRegion();
    // Shorter than the sixteen frames a loop is measured with.
    await looped(audio, region, { start: 4_800, end: 4_810 });
    const loop = kept(audio, region)?.loop;
    const state = audio.session.getSnapshot().model.state;

    audio.window.run('loop.analyse');
    const record = await answered(audio, region);

    expect(record).toMatchObject({ kind: 'failed' });
    expect(audio.window.said.at(-1)).toMatch(/^The loop of “Hum” could not be analysed\. /);
    expect(kept(audio, region)?.loop).toEqual(loop);
    expect(audio.session.getSnapshot().model.state).toBe(state);
  });

  it(
    'stops an analysis, keeping what the region had before and its loop as it was',
    SEARCHING,
    async () => {
      const { audio, region } = await sineRegion();
      await looped(audio, region, { start: 4_800, end: 19_200 });
      audio.window.run('loop.analyse');
      const measured = await answered(audio, region);
      const state = audio.session.getSnapshot().model.state;

      expect(audio.window.run('loop.find-candidates').kind).toBe('applied');
      expect(audio.window.context.loopAnalysis.analyses.of(region)?.kind).toBe('running');
      expect(audio.window.run('loop.cancel-analysis').kind).toBe('applied');

      expect(audio.window.context.loopAnalysis.analyses.of(region)).toBe(measured);
      expect(audio.window.said.at(-1)).toBe(
        'Stopped analysing the loop of “Hum”. Its loop is unchanged.',
      );
      expect(audio.window.run('loop.cancel-analysis')).toMatchObject({ kind: 'refused' });
      expect(audio.session.getSnapshot().model.state).toBe(state);
    },
  );

  it.each([
    [{ radius: 'wide' }, 'Give the search radius in milliseconds.'],
    [
      { radius: 2_001 },
      'A search moves each loop point by at least one frame and at most two seconds.',
    ],
    [{ candidates: 17 }, 'A search lists from 1 to 16 candidates.'],
    [{ candidates: '2.5' }, 'A search lists from 1 to 16 candidates.'],
  ])('refuses a search of %j', async (args, refusal) => {
    const { audio, region } = await sineRegion();
    await looped(audio, region, { start: 4_800, end: 19_200 });

    expect(audio.window.run('loop.find-candidates', args)).toMatchObject({
      kind: 'refused',
      failures: [{ summary: refusal }],
    });
  });
});

describe('applying a candidate the search found', () => {
  it(
    'loops a whole sound where a crossfade has room, as one change undo reverses',
    SEARCHING,
    async () => {
      const { audio, region } = await sineRegion();
      await looped(audio, region);
      const before = kept(audio, region)?.loop;
      expect(before).toMatchObject({ start: 0, end: 24_000, crossfadeLength: 0 });

      audio.window.run('loop.find-candidates');
      const record = await answered(audio, region);
      if (record?.kind !== 'done') throw new Error('The search did not answer.');
      const room = record.analysis.candidates.find((one) => one.makesRoomForCrossfade);
      if (room?.crossfade === undefined) throw new Error('No candidate made room for a crossfade.');

      // Nothing has moved because an analysis answered.
      expect(kept(audio, region)?.loop).toEqual(before);
      await audio.window.runAndHear('loop.apply-crossfade', { rank: room.rank });

      expect(kept(audio, region)?.loop).toEqual({
        basis: 0,
        start: room.start,
        end: room.end,
        crossfadeLength: room.crossfade.lengthFrames,
        crossfadeShape: room.crossfade.shape,
      });
      // The loop moved, so the analysis is of the loop as it was.
      expect(audio.window.run('loop.apply-crossfade', { rank: room.rank })).toMatchObject({
        kind: 'refused',
        failures: [
          {
            summary:
              'The sound of “Hum” has changed since its loop was analysed. Analyse it again first.',
          },
        ],
      });

      await audio.window.runAndHear('edit.undo');
      expect(kept(audio, region)?.loop).toEqual(before);
    },
  );

  it('loops at a candidate’s points alone, as its checks were measured', SEARCHING, async () => {
    const { audio, region } = await sineRegion();
    // A quarter period short of a whole number of periods.
    await looped(audio, region, { start: 4_800, end: 19_175 });

    audio.window.run('loop.find-candidates', { candidates: 3 });
    const record = await answered(audio, region);
    if (record?.kind !== 'done') throw new Error('The search did not answer.');
    const [best] = record.analysis.candidates;
    if (best === undefined) throw new Error('The search found nothing.');

    expect(await audio.window.runAndHear('loop.apply-candidate')).toBe(
      `“Hum” now loops at candidate 1’s points, frames ${String(best.start)} to ${String(best.end)} of the region.`,
    );
    expect(kept(audio, region)?.loop).toMatchObject({
      start: best.start,
      end: best.end,
      crossfadeLength: 0,
    });
    // Its sound is as it was, a loop without a crossfade heard alike wherever
    // it lies, but its loop moved, so what was found is of the loop before.
    expect(audio.window.run('loop.apply-candidate', { rank: 2 })).toMatchObject({
      kind: 'refused',
      failures: [
        {
          summary:
            'The sound of “Hum” has changed since its loop was analysed. Analyse it again first.',
        },
      ],
    });
  });

  it(
    'refuses a crossfade a candidate is not offered, and an analysis it never had',
    SEARCHING,
    async () => {
      const { audio, region } = await sineRegion();
      await looped(audio, region, { start: 4_800, end: 19_200 });

      expect(audio.window.run('loop.apply-candidate')).toMatchObject({
        kind: 'refused',
        failures: [{ summary: 'The loop of “Hum” has not been analysed this session.' }],
      });
      audio.window.run('loop.find-candidates');
      const record = await answered(audio, region);
      if (record?.kind !== 'done') throw new Error('The search did not answer.');
      const plain = record.analysis.candidates.find((one) => one.crossfade === undefined);
      if (plain === undefined) throw new Error('Every candidate was offered a crossfade.');

      expect(audio.window.run('loop.apply-crossfade', { rank: plain.rank })).toMatchObject({
        kind: 'refused',
        failures: [
          {
            summary: `Candidate ${String(plain.rank)} loops without a crossfade, so none is suggested for it.`,
          },
        ],
      });
    },
  );
});
