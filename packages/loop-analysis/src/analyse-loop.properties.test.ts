import { describe, expect, it } from 'vitest';

import { REFERENCE_DSP, sineOfTurns } from '@audiogubbins/audio-engine';
import {
  StandardLayouts,
  createCancellationSource,
  sampleRate,
  type ChannelLayout,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { analyseLoop, type LoopAnalysis } from './analyse-loop.js';
import { searchCapture } from './candidate-search.js';
import { captureLoop } from './loop-capture.js';
import { defaultLoopSearch } from './loop-request.js';
import { analysisWindow } from './loop-windows.js';
import { MeasuringKit } from './measuring-kit.js';
import { measurePair } from './seam-metrics.js';
import {
  cutNoise,
  dcStep,
  drone,
  drumBars,
  fixtureSource,
  levelStep,
  quarterPeriodShort,
  seamlessSine,
  type LoopFixture,
} from './testing/loop-fixtures.js';
import type { LoopMetric } from './verdicts.js';

const RATE = expectSuccess(sampleRate(48_000));

const TOOLS = {
  dsp: REFERENCE_DSP,
  signal: createCancellationSource().signal,
  yieldToHost: () => Promise.resolve(),
  onProgress: () => undefined,
};

async function analysed(fixture: LoopFixture): Promise<LoopAnalysis> {
  const source = fixtureSource(fixture);
  return expectSuccess(await analyseLoop(source, source, { loop: fixture.loop }, TOOLS));
}

/**
 * Every metric of an analysis stated in time, level or ratio, in one order:
 * the zero crossings' distances are frames by definition, a frame being
 * shorter at a higher rate, so they are left out.
 */
function rateFreeMetrics(analysis: LoopAnalysis): readonly LoopMetric[] {
  const current = analysis.current;
  return [
    current.discontinuity,
    current.dcMismatch,
    current.netDc,
    current.levelMismatch,
    current.phaseMismatch,
    current.spectralMismatch,
    current.zeroCrossing.signs,
    current.cycleStability.seam,
    current.cycleStability.drift,
  ];
}

describe('the pass over a loop', () => {
  it.each([
    ['cut noise', cutNoise],
    ['drum bars', drumBars],
  ])(
    'keeps the same audio, sums and envelope whatever chunks it reads %s in',
    async (_name, make) => {
      const fixture = make();
      const regionLength = fixture.channels[0]?.length ?? 0;
      const request = searchCapture(fixture.loop, defaultLoopSearch(RATE), regionLength, RATE);
      const kit = new MeasuringKit(REFERENCE_DSP, RATE);
      const { start, end } = fixture.loop;
      const pairs = [
        [start, end],
        [start - 333, end + 517],
        [start + 960, end - 960],
      ] as const;
      const measured = [];
      for (const chunkFrames of [32_768, 4_096, 1_000, 777]) {
        const capture = await captureLoop(
          fixtureSource(fixture),
          request,
          TOOLS,
          () => undefined,
          chunkFrames,
        );
        measured.push(
          pairs.map(([from, to]) =>
            measurePair(capture, kit, {
              start: from,
              end: to,
              regionLength,
              window: analysisWindow(RATE, to - from),
            }),
          ),
        );
      }
      for (const measurement of measured.slice(1)) expect(measurement).toEqual(measured[0]);
    },
    60_000,
  );
});

describe('the analysis of every channel of a layout', () => {
  /** A 5.1 region whose channel `bad` is 485 Hz, half a period out at the seam, and the rest the seamless 480 Hz sine. */
  function surround(bad: number): LoopFixture {
    const sine = (frequency: number) =>
      Float32Array.from(
        { length: 33_600 },
        (_, n) => 0.5 * sineOfTurns(((frequency * n) % 48_000) / 48_000),
      );
    const layout: ChannelLayout = StandardLayouts.surround5_1;
    return {
      name: 'surround',
      sampleRate: RATE,
      layout,
      channels: layout.roles.map((_, channel) => sine(channel === bad ? 485 : 480)),
      loop: seamlessSine().loop,
    };
  }

  it('reports the channel whose seam is worst, with the value a channel alone has', async () => {
    const [three, zero] = await Promise.all([analysed(surround(3)), analysed(surround(0))]);
    const alone = await analysed({
      ...surround(0),
      layout: StandardLayouts.mono,
      channels: surround(0).channels.slice(0, 1),
    });
    expect(three.channels).toBe(6);
    expect(three.current.discontinuity.channel).toBe(3);
    expect(three.current.phaseMismatch.channel).toBe(3);
    expect(zero.current.discontinuity.channel).toBe(0);
    expect(three.current.discontinuity.value).toBe(alone.current.discontinuity.value);
    expect(three.current.phaseMismatch.value).toBe(alone.current.phaseMismatch.value);
    expect(three.seam.head).toHaveLength(6);
  }, 60_000);
});

describe('the verdicts at another rate', () => {
  it.each([
    ['the seamless sine', seamlessSine],
    ['the sine a quarter period short', quarterPeriodShort],
    ['the DC step', dcStep],
    ['the level step', levelStep],
    ['the drone', drone],
  ])(
    'are the same for %s at 44.1, 48 and 96 kHz',
    async (_name, make) => {
      const verdicts = [];
      for (const rate of [44_100, 48_000, 96_000]) {
        verdicts.push(rateFreeMetrics(await analysed(make(rate))).map(({ verdict }) => verdict));
      }
      expect(verdicts[0]).toEqual(verdicts[1]);
      expect(verdicts[2]).toEqual(verdicts[1]);
    },
    60_000,
  );
});

describe('the spans stated in time', () => {
  /** `sin(2π · frequency · n / rate)` at frame `n`, `frequency` whole hertz. */
  const sineAt = (frequency: number, rate: number, n: number): number =>
    sineOfTurns(((frequency * n) % rate) / rate);

  /** A mono region of `seconds` at `rate`, its loop `[start, end)` in seconds, its samples `at(n, rate)`. */
  function region(
    name: string,
    rate: number,
    seconds: { readonly start: number; readonly end: number; readonly length: number },
    at: (n: number, rate: number) => number,
  ): LoopFixture {
    const frames = Math.round(seconds.length * rate);
    return {
      name,
      sampleRate: expectSuccess(sampleRate(rate)),
      layout: StandardLayouts.mono,
      channels: [Float32Array.from({ length: frames }, (_, n) => at(n, rate))],
      loop: {
        start: Math.round(seconds.start * rate),
        end: Math.round(seconds.end * rate),
        crossfadeLength: 0,
        crossfadeShape: seamlessSine().loop.crossfadeShape,
      },
    };
  }

  it('weighs the DC means over 200 ms at every rate, so a DC 100 to 200 ms past the end counts', async () => {
    // The loop's head holds no DC, and the 200 ms after E holds 0.05 in its
    // second half only: a span that were a fixed number of frames would be
    // 100 ms at one of these rates and miss it.
    const make = (rate: number) =>
      region('late-dc', rate, { start: 0.3, end: 0.8, length: 1.1 }, (n, at) => {
        const seconds = n / at;
        const dc = seconds >= 0.9 && seconds < 1 ? 0.05 : 0;
        return 0.5 * sineAt(480, at, n) + dc;
      });
    const [at48, at96] = [await analysed(make(48_000)), await analysed(make(96_000))];
    expect(at48.current.dcMismatch.reference).toBe('post-end');
    expect(at48.current.dcMismatch.verdict).toBe('fail');
    expect(at96.current.dcMismatch.verdict).toBe('fail');
    expect(at96.current.dcMismatch.value).toBeCloseTo(at48.current.dcMismatch.value, 2);
  }, 60_000);

  it('steps the envelope every 10 ms at every rate, so a level that repeats every 10 ms is steady', async () => {
    // A 500 Hz tone whose level swings at 100 Hz: every 10 ms holds the same
    // energy, but halves of it do not, so a step that were a fixed number of
    // frames would be 5 ms at one of these rates and see the swing as unsteady.
    const make = (rate: number) =>
      region('swinging', rate, { start: 0.1, end: 0.6, length: 0.7 }, (n, at) => {
        const level = 0.5 + 0.5 * sineAt(100, at, n);
        return 0.4 * level * sineAt(500, at, n);
      });
    const [at48, at96] = [await analysed(make(48_000)), await analysed(make(96_000))];
    expect(at48.current.cycleStability.seam.verdict).toBe('pass');
    expect(at96.current.cycleStability.seam.value).toBeCloseTo(
      at48.current.cycleStability.seam.value,
      2,
    );
    expect(at96.current.cycleStability.drift.value).toBeCloseTo(
      at48.current.cycleStability.drift.value,
      2,
    );
  }, 60_000);
});
