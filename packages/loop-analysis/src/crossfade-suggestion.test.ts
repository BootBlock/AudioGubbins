import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP, sineOfTurns } from '@audiogubbins/audio-engine';
import { StandardLayouts, createCancellationSource, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { analyseLoop } from './analyse-loop.js';
import { searchCapture } from './candidate-search.js';
import { captureLoop } from './loop-capture.js';
import { defaultLoopSearch, type AnalysedLoop } from './loop-request.js';
import { analysisWindow } from './loop-windows.js';
import { MeasuringKit } from './measuring-kit.js';
import { crossfadeFits, microCrossfadeLengths, suggestCrossfade } from './micro-crossfade.js';
import {
  fixtureSource,
  quarterPeriodShort,
  seamlessSine,
  wholeSoundSine,
  type LoopFixture,
} from './testing/loop-fixtures.js';

/**
 * A search measures hundreds of pairs: a second or two alone, and several
 * under the whole suite's load, past Vitest's five-second default.
 */
const SEARCHING = { timeout: 60_000 };

const RATE = expectSuccess(sampleRate(48_000));

const TOOLS = {
  dsp: REFERENCE_DSP,
  signal: createCancellationSource().signal,
  yieldToHost: () => Promise.resolve(),
  onProgress: () => undefined,
};

/** The shortest crossfade that makes `fixture`'s seam pass, from a search's pass over it. */
async function suggestionFor(fixture: LoopFixture, dominantHertz: number) {
  const source = fixtureSource(fixture);
  const regionLength = fixture.channels[0]?.length ?? 0;
  const { loop } = fixture;
  const capture = await captureLoop(
    source,
    searchCapture(loop, defaultLoopSearch(fixture.sampleRate), regionLength, fixture.sampleRate),
    TOOLS,
    () => undefined,
  );
  const place = {
    start: loop.start,
    end: loop.end,
    regionLength,
    window: analysisWindow(fixture.sampleRate, loop.end - loop.start),
  };
  const kit = new MeasuringKit(REFERENCE_DSP, fixture.sampleRate);
  const lengths = microCrossfadeLengths(fixture.sampleRate, dominantHertz);
  return suggestCrossfade(capture, kit, place, lengths);
}

/** A uniform value in `[−1, 1)`, from a 32-bit counter hash. */
function noiseAt(index: number): number {
  let state = Math.imul(index ^ 0x2545f491, 0x9e3779b1) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
  state = Math.imul(state ^ (state >>> 12), 0x297a2d39) >>> 0;
  return ((state ^ (state >>> 15)) >>> 0) / 2 ** 31 - 1;
}

describe('the micro-crossfade lengths', SEARCHING, () => {
  it('are 2, 5, 10, 20 and 50 ms at the rate', () => {
    expect(microCrossfadeLengths(48_000, undefined)).toEqual([96, 240, 480, 960, 2_400]);
    expect(microCrossfadeLengths(44_100, undefined)).toEqual([88, 221, 441, 882, 2_205]);
  });

  it('span at least two periods of a dominant partial', () => {
    // Two periods of 480 Hz are 200 frames, so 2 ms is too short.
    expect(microCrossfadeLengths(48_000, 480)).toEqual([240, 480, 960, 2_400]);
  });
});

describe('the micro-crossfade a seam is offered', SEARCHING, () => {
  it('is the shortest that makes a sine seam pass, at least two periods long', async () => {
    // A 400 Hz sine, 120 frames a period, its loop 10 frames short: 30° out.
    const samples = Float32Array.from(
      { length: 40_000 },
      (_, n) => 0.5 * sineOfTurns(((400 * n) % 48_000) / 48_000),
    );
    const fixture: LoopFixture = {
      name: 'thirty-degrees',
      sampleRate: RATE,
      layout: StandardLayouts.mono,
      channels: [samples],
      loop: { start: 4_800, end: 28_790, crossfadeLength: 0, crossfadeShape: 'linear' },
    };
    // Of the shapes that pass at 240 frames, linear and s-curve, the s-curve
    // changes the level less.
    expect(await suggestionFor(fixture, 400)).toEqual({
      lengthFrames: 240,
      shape: 's-curve',
    });
  });

  it('is none where no shape both holds the level and joins smoothly: a sine 90° out', async () => {
    // Uncorrelated spans hold their level only under an equal-power fade,
    // whose square root starts with a kink the residual hears.
    expect(await suggestionFor(quarterPeriodShort(), 480)).toBeUndefined();
  });

  it('is never longer than the audio before the start: with 2 ms of it, 5 ms is not offered', async () => {
    const frames = 40_000;
    const noise = Float32Array.from({ length: frames }, (_, n) => 0.3 * noiseAt(n));
    const loop: AnalysedLoop = {
      start: 96,
      end: 30_096,
      crossfadeLength: 0,
      crossfadeShape: 'linear',
    };
    const fixture: LoopFixture = {
      name: 'pre-roll',
      sampleRate: RATE,
      layout: StandardLayouts.mono,
      channels: [noise],
      loop,
    };
    const source = fixtureSource(fixture);
    const capture = await captureLoop(
      source,
      searchCapture(loop, defaultLoopSearch(RATE), frames, RATE),
      TOOLS,
      () => undefined,
    );
    const place = { start: 96, end: 30_096, regionLength: frames, window: 2_400 };
    expect(crossfadeFits(place, 240)).toBe(false);
    const kit = new MeasuringKit(REFERENCE_DSP, RATE);
    expect(suggestCrossfade(capture, kit, place, microCrossfadeLengths(48_000, undefined))).toEqual(
      {
        lengthFrames: 96,
        shape: 'equal-power',
      },
    );
  });
});

describe('the candidate that moves the start to make room for a crossfade', SEARCHING, () => {
  it('is offered for a whole-sound loop, moving its start forward by the crossfade it then takes', async () => {
    const fixture = wholeSoundSine();
    const source = fixtureSource(fixture);
    const analysis = expectSuccess(
      await analyseLoop(
        source,
        source,
        { loop: fixture.loop, search: defaultLoopSearch(RATE) },
        TOOLS,
      ),
    );
    const room = analysis.candidates.filter((candidate) => candidate.makesRoomForCrossfade);
    expect(room).toHaveLength(1);
    expect(room[0]?.start).toBe(room[0]?.crossfade?.lengthFrames);
    expect(room[0]?.end).toBe(fixture.loop.end);
  });

  it('is not offered for a loop with audio before its start', async () => {
    const fixture = seamlessSine();
    const source = fixtureSource(fixture);
    const analysis = expectSuccess(
      await analyseLoop(
        source,
        source,
        { loop: fixture.loop, search: defaultLoopSearch(RATE) },
        TOOLS,
      ),
    );
    expect(analysis.candidates.some((candidate) => candidate.makesRoomForCrossfade)).toBe(false);
  });
});
