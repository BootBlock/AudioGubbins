import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP } from '@audiogubbins/audio-engine';
import {
  StandardLayouts,
  createCancellationSource,
  sampleRate,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { analyseLoop } from './analyse-loop.js';
import { byCost } from './candidate-cost.js';
import { startAnchors } from './candidate-pairs.js';
import { searchCapture } from './candidate-search.js';
import { EndCorrelator } from './end-correlation.js';
import { captureLoop, type LoopCapture } from './loop-capture.js';
import { defaultLoopSearch, type AnalysedLoop, type LoopSearch } from './loop-request.js';
import { MeasuringKit } from './measuring-kit.js';
import {
  antiPhaseStereo,
  cutNoise,
  directCurrentOnly,
  fixtureSource,
  seamlessSine,
  type LoopFixture,
} from './testing/loop-fixtures.js';

/**
 * A search measures hundreds of pairs: a second or two alone, and several
 * under the whole suite's load, past Vitest's five-second default.
 */
const SEARCHING = { timeout: 60_000 };

const RATE: SampleRate = expectSuccess(sampleRate(48_000));

const TOOLS = {
  dsp: REFERENCE_DSP,
  signal: createCancellationSource().signal,
  yieldToHost: () => Promise.resolve(),
  onProgress: () => undefined,
};

/** A uniform value in `[−1, 1)`, from a 32-bit counter hash. */
function noiseAt(index: number): number {
  let state = Math.imul(index ^ 0x68e31da4, 0x9e3779b1) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
  state = Math.imul(state ^ (state >>> 12), 0x297a2d39) >>> 0;
  return ((state ^ (state >>> 15)) >>> 0) / 2 ** 31 - 1;
}

function captured(fixture: LoopFixture, search: LoopSearch): Promise<LoopCapture> {
  const regionLength = fixture.channels[0]?.length ?? 0;
  return captureLoop(
    fixtureSource(fixture),
    searchCapture(fixture.loop, search, regionLength, fixture.sampleRate),
    TOOLS,
    () => undefined,
  );
}

async function searched(fixture: LoopFixture, search: LoopSearch) {
  const source = fixtureSource(fixture);
  return expectSuccess(await analyseLoop(source, source, { loop: fixture.loop, search }, TOOLS))
    .candidates;
}

describe('the correlation of a start with every end', SEARCHING, () => {
  // Stereo noise in anti-phase repeating every 80,000 frames, searched 40,000
  // frames either way of E: the end window spans two overlap-save blocks.
  const frames = 200_000;
  const left = Float32Array.from({ length: frames }, (_, n) => 0.3 * noiseAt(n % 80_000));
  const loop: AnalysedLoop = {
    start: 50_000,
    end: 130_000,
    crossfadeLength: 0,
    crossfadeShape: 'linear',
  };
  const fixture: LoopFixture = {
    name: 'long-noise',
    sampleRate: RATE,
    layout: StandardLayouts.stereo,
    channels: [left, left.map((sample) => -sample)],
    loop,
  };
  const search: LoopSearch = { radiusFrames: 40_000, keepLength: false, candidates: 5 };

  it('is the direct normalised sum over every channel, across the overlap-save blocks', async () => {
    const capture = await captured(fixture, search);
    const correlator = new EndCorrelator(
      capture,
      new MeasuringKit(REFERENCE_DSP, RATE),
      loop.end - search.radiusFrames,
      loop.end + search.radiusFrames,
      256,
    );
    const anchor = 50_123;
    const scores = new Float64Array(correlator.ends);
    correlator.scores(anchor, scores);
    // Either side of the first block's end, 65,536 − 511 outputs in, and spread over the rest.
    const outputs = [0, 997, 65_024, 65_025, 65_026, 79_999, correlator.ends - 1];
    for (const output of outputs) {
      const end = correlator.firstEnd + output;
      let product = 0;
      let startEnergy = 0;
      let endEnergy = 0;
      for (const channel of fixture.channels) {
        for (let offset = -256; offset < 256; offset += 1) {
          const a = channel[anchor + offset] ?? 0;
          const b = end + offset < frames ? (channel[end + offset] ?? 0) : 0;
          product += a * b;
          startEnergy += a * a;
          endEnergy += b * b;
        }
      }
      expect(scores[output]).toBeCloseTo(product / Math.sqrt(startEnergy * endEnergy), 9);
    }
    // The repeat, 80,000 frames on, correlates fully, the anti-phase channels included.
    expect(scores[anchor + 80_000 - correlator.firstEnd]).toBeCloseTo(1, 9);
  });
});

describe('the start anchors', SEARCHING, () => {
  it('are the frames nearest S where a channel changes sign, the earlier of two at one distance', async () => {
    const fixture = seamlessSine();
    const search = defaultLoopSearch(RATE);
    const capture = await captured(fixture, search);
    const anchors = startAnchors(capture, {
      start: fixture.loop.start,
      end: fixture.loop.end,
      regionLength: fixture.channels[0]?.length ?? 0,
      radius: search.radiusFrames,
      keepLength: false,
      window: 2_400,
    });
    // A 480 Hz sine is exactly zero every 50 frames from S, so both
    // boundaries of each zero are crossings.
    expect(anchors.slice(0, 5)).toEqual([4_800, 4_801, 4_751, 4_750, 4_850]);
  });

  it('are the nearest frames where no channel changes sign', async () => {
    const fixture = directCurrentOnly();
    const search = defaultLoopSearch(RATE);
    const capture = await captured(fixture, search);
    const anchors = startAnchors(capture, {
      start: fixture.loop.start,
      end: fixture.loop.end,
      regionLength: fixture.channels[0]?.length ?? 0,
      radius: search.radiusFrames,
      keepLength: false,
      window: 2_400,
    });
    expect(anchors).toHaveLength(64);
    expect(anchors.slice(0, 3)).toEqual([4_800, 4_799, 4_801]);
  });
});

describe('the candidates a search returns', SEARCHING, () => {
  it('keep the length when asked, finding whole repeats of a repeating noise', async () => {
    const fixture = cutNoise();
    const length = fixture.loop.end - fixture.loop.start;
    const candidates = await searched(fixture, { ...defaultLoopSearch(RATE), keepLength: true });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) expect(candidate.end - candidate.start).toBe(length);
    const free = await searched(fixture, defaultLoopSearch(RATE));
    // Freed of its length, the best is a whole number of repeats, 12,000 frames each.
    expect(((free[0]?.end ?? 0) - (free[0]?.start ?? 0)) % 12_000).toBe(0);
  });

  it('stay inside the region and the radius, but for the start moved to make room for a crossfade', async () => {
    const fixture = seamlessSine();
    const near: LoopFixture = { ...fixture, loop: { ...fixture.loop, start: 100 } };
    const search = { ...defaultLoopSearch(RATE), candidates: 16 };
    for (const candidate of await searched(near, search)) {
      expect(candidate.start).toBeGreaterThanOrEqual(0);
      expect(candidate.end).toBeLessThanOrEqual(fixture.channels[0]?.length ?? 0);
      expect(Math.abs(candidate.moved.end)).toBeLessThanOrEqual(search.radiusFrames);
      expect(Math.abs(candidate.moved.start)).toBeLessThanOrEqual(
        candidate.makesRoomForCrossfade
          ? (candidate.crossfade?.lengthFrames ?? 0)
          : search.radiusFrames,
      );
    }
  });

  it('find whole periods in anti-phase stereo, ranked from 1', async () => {
    const candidates = await searched(antiPhaseStereo(), defaultLoopSearch(RATE));
    expect(candidates.map(({ rank }) => rank)).toEqual([1, 2, 3, 4, 5]);
    expect([candidates[0]?.start, candidates[0]?.end]).toEqual([4_800, 28_800]);
  });

  it('are the same list for the same audio and settings', async () => {
    const fixture = cutNoise();
    expect(await searched(fixture, defaultLoopSearch(RATE))).toEqual(
      await searched(fixture, defaultLoopSearch(RATE)),
    );
  });
});

describe('the order candidates are offered in', () => {
  const base = { start: 100, end: 900, cost: 1, distance: 10 };

  it('is by cost, then the smaller move, then the earlier start, then the earlier end', () => {
    expect(byCost(base, { ...base, cost: 1.5 })).toBeLessThan(0);
    expect(byCost(base, { ...base, distance: 11 })).toBeLessThan(0);
    expect(byCost(base, { ...base, start: 101 })).toBeLessThan(0);
    expect(byCost(base, { ...base, end: 901 })).toBeLessThan(0);
    expect(byCost(base, { ...base })).toBe(0);
  });

  it('compares costs exactly, so a difference in the last bit decides', () => {
    expect(byCost({ ...base, cost: 1 + Number.EPSILON, distance: 0 }, base)).toBeGreaterThan(0);
  });
});
