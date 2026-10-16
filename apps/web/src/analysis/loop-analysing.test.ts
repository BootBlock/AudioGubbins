import { describe, expect, it } from 'vitest';

import {
  anchorResolver,
  regionPlan,
  type EditPlan,
  type QualityMode,
  type RegionId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { DetectionHost, type LoopOutcome } from '@audiogubbins/detection-runtime';
import { LocalDetectionWorker } from '@audiogubbins/detection-runtime/testing';
import type { LoopAnalysis, LoopAnalysisRequest } from '@audiogubbins/loop-analysis';
import { sine } from '@audiogubbins/test-fixtures';

import { planContextOf } from '../assets/project-assets.js';
import { regionEntryId } from '../assets/project-entry.js';
import { holdPlatformFiles, windowWithAudio, type AudioWindow } from '../testing/project-audio.js';
import { regionLoopOf, type RegionLoop } from './loop-analysing.js';

holdPlatformFiles();

/** A search measures hundreds of pairs, three times over here. */
const SEARCHING = { timeout: 120_000 };

/**
 * A second of a 480 Hz sine, 100 frames a period, in a region of all of it,
 * looped from 4,800 a quarter period short of 24,000 frames on, with a
 * crossfade of 480 frames: heard, the crossfade smooths the seam; plain, the
 * head arrives 90° early.
 */
async function loopedSine(): Promise<{ readonly audio: AudioWindow; readonly region: RegionId }> {
  const audio = await windowWithAudio({
    fixture: sine(480, { length: 48_000 }),
    regions: [{ name: 'Hum', start: 0, end: 48_000 }],
  });
  const { window } = audio;
  const [placed] = audio.asset().regions;
  if (placed === undefined) throw new Error('The region was not added.');
  window.context.editorViews.open('editor', audio.asset());
  window.context.editorViews.focus('editor');
  window.run('region.open', { region: placed.id });
  window.run('editor.select-time', { start: 4_800, end: 28_775 });
  await window.runAndHear('region.loop', { crossfade: 480 });
  await expect
    .poll(() => window.context.assets.find(regionEntryId(placed.id))?.regions, { timeout: 5000 })
    .toBeDefined();
  return { audio, region: placed.id };
}

/** The region's loop as an analysis reads it now. */
function loopOf(audio: AudioWindow, region: RegionId): RegionLoop {
  const sound = audio.window.context.assets.find(regionEntryId(region));
  if (sound === undefined) throw new Error('The region is not open.');
  const looped = regionLoopOf(sound, audio.session.getSnapshot().model.state);
  if (typeof looped === 'string') throw new Error(looped);
  return looped;
}

/** The analysis of `request` over the region heard as `heard` and read plain as `plain`, at `quality`. */
async function analysedAs(
  looped: RegionLoop,
  asked: { readonly request: LoopAnalysisRequest; readonly quality: QualityMode },
  heard: EditPlan,
  plain: EditPlan,
  name: string,
): Promise<LoopAnalysis> {
  const host = new DetectionHost({ createWorker: () => new LocalDetectionWorker() });
  const outcome: LoopOutcome = await host.analyseLoop({
    target: name,
    identity: name,
    channels: 1,
    describe: () => ({ heard: looped.describedWith(heard), plain: looped.describedWith(plain) }),
    quality: asked.quality,
    request: asked.request,
  });
  host.dispose();
  if (outcome.kind !== 'done') throw new Error(`The reference analysis ${outcome.kind}.`);
  return outcome.analysis;
}

describe('a looped region as a loop analysis reads it (ADR-0103)', () => {
  it('is the region’s own plan, heard with its loop’s crossfade and plain without it', async () => {
    const { audio, region } = await loopedSine();
    const looped = loopOf(audio, region);
    const { state } = audio.session.getSnapshot().model;
    const asset = state.project.assets.get(audio.assetId);
    const kept = state.project.regions.get(looped.region.id);
    if (asset === undefined || kept === undefined) throw new Error('The region is not kept.');

    expect(looped.loop).toMatchObject({ loopStart: 4_800, loopEnd: 28_775, crossfadeLength: 480 });
    expect(looped.heard).toEqual(expectSuccess(regionPlan(asset, kept, planContextOf(state))));
    expect(looped.plain).toEqual(
      expectSuccess(
        regionPlan(asset, kept, planContextOf(state), anchorResolver(asset), {
          loopCrossfade: false,
        }),
      ),
    );
    // The crossfade is a stream of its own in the plan heard.
    expect(looped.heard).not.toEqual(looped.plain);
  });

  it(
    'measures the loop as heard, and its crossfade and every candidate without the crossfade',
    SEARCHING,
    async () => {
      const { audio, region } = await loopedSine();
      const { context } = audio.window;
      const looped = loopOf(audio, region);

      audio.window.run('loop.find-candidates', { region });
      await expect
        .poll(() => context.loopAnalysis.analyses.of(region)?.kind, { timeout: 60_000 })
        .toBe('done');
      const record = context.loopAnalysis.analyses.of(region);
      if (record?.kind !== 'done') throw new Error('The analysis did not answer.');
      const { analysis, request } = record;

      const asked = { request, quality: context.audioSettings.get().renderQuality };
      const heardOnly = await analysedAs(looped, asked, looped.heard, looped.heard, 'heard');
      const plainOnly = await analysedAs(looped, asked, looped.plain, looped.plain, 'plain');

      // The two readings differ where it matters, so agreeing with one is a
      // finding: the seam heard is crossfaded, the plain one a quarter period
      // out, and the crossfade's spans and the search read other audio.
      expect(heardOnly.current.discontinuity).not.toEqual(plainOnly.current.discontinuity);
      expect(heardOnly.current.crossfade).not.toEqual(plainOnly.current.crossfade);
      expect(heardOnly.candidates).not.toEqual(plainOnly.candidates);

      const { crossfade: heardFade, ...heardSeam } = heardOnly.current;
      const { crossfade, ...seam } = analysis.current;
      expect(seam).toEqual(heardSeam);
      expect(heardFade).toBeDefined();
      expect(crossfade).toEqual(plainOnly.current.crossfade);
      expect(analysis.candidates).toEqual(plainOnly.candidates);
      expect(analysis.seam).toEqual(heardOnly.seam);
    },
  );
});
