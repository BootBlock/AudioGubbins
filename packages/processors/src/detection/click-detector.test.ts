import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, MeasureUnit, StandardLayouts, succeed } from '@audiogubbins/domain';
import {
  REFERENCE_DSP,
  gainToDecibels,
  type CanonicalDetectorFeatures,
  type CanonicalDsp,
} from '@audiogubbins/audio-engine';

import { MERGE_GAP } from '../repair/click-geometry.js';
import { DE_CLICK } from '../repair/de-click.js';
import { TEST_RATE, processorValues, runProcessor } from '../testing/processor-run.js';
import { partials, withClicks, type Click } from '../testing/repair-signals.js';
import { detect } from '../testing/detection-signals.js';
import { CLICK_DETECTOR } from './click-detector.js';
import { CLICK_SENSITIVITY } from './treatments.js';

const LENGTH = 96_000;
const clean = partials(LENGTH);

/**
 * The reference DSP, its click extractor replaced by one that reports an event
 * of a large deviation at each of `events`, on channel 0, once the frame has
 * been pushed: so the detector and the de-click hear the same flags.
 */
function scriptedClicks(events: readonly number[]): CanonicalDsp {
  return {
    ...REFERENCE_DSP,
    createDetectorFeatures: (settings) => {
      let pushed = 0;
      let given = 0;
      const features: CanonicalDetectorFeatures = {
        kind: settings.kind,
        channels: settings.channels,
        recordWidth: 4,
        push: (input) => {
          pushed += input[0]?.length ?? 0;
        },
        pull: (into) => {
          let count = 0;
          while (
            given < events.length &&
            (events[given] ?? 0) < pushed &&
            4 * count < into.length
          ) {
            into.set([0, events[given] ?? 0, 1, 0.001], 4 * count);
            given += 1;
            count += 1;
          }
          return count;
        },
        release: () => undefined,
      };
      return succeed(features);
    },
  };
}

/** The runs of frames the de-click changed in `signal`, flagged at `events`, as first and last. */
function repairedRuns(signal: Float32Array, events: readonly number[]): [number, number][] {
  const [removed] = runProcessor(
    DE_CLICK,
    { layout: StandardLayouts.mono, values: { output: 'clicks' }, dsp: scriptedClicks(events) },
    [signal],
  );
  const runs: [number, number][] = [];
  for (const [frame, sample] of (removed ?? new Float32Array(0)).entries()) {
    if (sample === 0) continue;
    const last = runs.at(-1);
    if (last?.[1] === frame - 1) last[1] = frame;
    else runs.push([frame, frame]);
  }
  return runs;
}

/** The ranges and channels of the clicks found in `channels`. */
async function clicksIn(...channels: Float32Array[]) {
  return (await detect(CLICK_DETECTOR, channels)).map(({ range, channels: on }) => ({
    start: range.start,
    end: range.end,
    channels: on,
  }));
}

describe('the click detector', () => {
  it('finds each click at its frames, measured past the de-click’s sensitivity', async () => {
    // The last is in the audio's last part block, 96 000 being 93¾ blocks of
    // 1024: heard only with the audio mirrored after its end.
    const clicks: readonly Click[] = [
      { at: 14_000, width: 30, size: 0.2 },
      { at: 40_003, width: 10, size: 0.1 },
      { at: 95_900, width: 6, size: 0.2 },
    ];
    const found = await detect(CLICK_DETECTOR, [withClicks(clean, clicks)]);
    expect(found).toHaveLength(clicks.length);
    for (const [index, { at, width }] of clicks.entries()) {
      const finding = found[index];
      // A click's first sample is flagged, and its residual spreads at most
      // the predictor's order past its last.
      expect(finding?.range.start).toBe(at);
      expect(finding?.range.end).toBeGreaterThanOrEqual(at + width / 2);
      expect(finding?.range.end).toBeLessThanOrEqual(Math.min(LENGTH, at + width + MERGE_GAP));
      expect(finding?.channels).toEqual([0]);
      expect(finding?.measure.unit).toBe(MeasureUnit.Decibels);
      // Each is far past the threshold it was judged at.
      expect(finding?.measure.value).toBeGreaterThan(
        gainToDecibels(4 * CLICK_SENSITIVITY.defaultValue),
      );
    }
  });

  it('finds nothing in music with no click', async () => {
    expect(await clicksIn(clean)).toEqual([]);
    expect(await clicksIn(new Float32Array(LENGTH))).toEqual([]);
  });

  it('makes one finding of events closer than the merge gap, and two of events further apart', async () => {
    // Two bursts of 4 frames 12 frames apart are one click; 60 apart, two.
    const near = await clicksIn(
      withClicks(clean, [
        { at: 30_000, width: 4, size: 0.2 },
        { at: 30_016, width: 4, size: 0.2, seed: 5 },
      ]),
    );
    expect(near).toEqual([{ start: 30_000, end: expect.any(Number) as number, channels: [0] }]);
    expect(near[0]?.end).toBeGreaterThan(30_016);
    const far = await clicksIn(
      withClicks(clean, [
        { at: 30_000, width: 4, size: 0.2 },
        { at: 30_064, width: 4, size: 0.2, seed: 5 },
      ]),
    );
    expect(far.map(({ start }) => start)).toEqual([30_000, 30_064]);
  });

  it('takes one click, and its repair, by the de-click’s own rule of gaps and lengths', async () => {
    const signal = clean.slice(0, 24_000);
    const latency = DE_CLICK.descriptor.latency({
      values: processorValues(DE_CLICK),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    });
    const delay = latency.kind === 'known' ? latency.frames : 0;
    for (const [events, clicks] of [
      // `MERGE_GAP` unflagged frames between two events: one click.
      [[10_000, 10_001 + MERGE_GAP], 1],
      // One more: two.
      [[10_000, 10_002 + MERGE_GAP], 2],
      // 44 flagged frames and the two guards each side: the 48 frames, 1 ms,
      // the de-click repairs at most.
      [[10_000, 10_011, 10_022, 10_033, 10_043], 1],
      // One frame longer: a sound, left as it is.
      [[10_000, 10_011, 10_022, 10_033, 10_044], 1],
    ] as const) {
      const found = await detect(CLICK_DETECTOR, [signal], 4_096, scriptedClicks(events));
      expect(found).toHaveLength(clicks);
      const runs = repairedRuns(signal, events);
      const repaired = found.filter(({ treatment }) => treatment.kind === 'steps');
      expect(runs).toHaveLength(repaired.length);
      for (const [index, finding] of repaired.entries()) {
        // The de-click repairs the click's frames and two guards each side.
        expect(runs[index]).toEqual([
          finding.range.start - 2 + delay,
          finding.range.end - 1 + 2 + delay,
        ]);
      }
      for (const finding of found.filter(({ treatment }) => treatment.kind === 'none')) {
        expect(finding.treatment).toEqual({
          kind: 'none',
          reason:
            'This click lasts 1.02 ms, longer than the 1.00 ms the de-click repairs, so the de-click leaves it as a sound.',
        });
      }
    }
  });

  it('finds a click on the channel it is on, one finding per channel, in order', async () => {
    const left = withClicks(clean, [{ at: 50_000, width: 12, size: 0.2 }]);
    const right = withClicks(clean, [
      { at: 20_000, width: 12, size: 0.2 },
      { at: 50_000, width: 12, size: 0.2, seed: 9 },
    ]);
    expect((await clicksIn(left, right)).map(({ start, channels }) => [start, channels])).toEqual([
      [20_000, [1]],
      [50_000, [0]],
      [50_000, [1]],
    ]);
  });

  it('treats a click with a de-click at the sensitivity it was judged at', async () => {
    const [finding] = await detect(CLICK_DETECTOR, [
      withClicks(clean, [{ at: 9_000, width: 9, size: 0.2 }]),
    ]);
    expect(finding?.treatment).toEqual({
      kind: 'steps',
      steps: [{ typeKey: 'de-click', values: { sensitivity: CLICK_SENSITIVITY.defaultValue } }],
    });
  });
});
