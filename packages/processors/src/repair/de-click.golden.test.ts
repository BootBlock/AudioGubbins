import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';
import { fingerprint } from '@audiogubbins/audio-engine/testing';

import { TEST_RATE, processorValues, runProcessor } from '../testing/processor-run.js';
import { changedFrames, partials, withClicks, worstError } from '../testing/repair-signals.js';
import { DE_CLICK } from './de-click.js';

/**
 * Clicks of 0.1 to 1.25 ms at known frames in a second of partials, repaired
 * with a longest click of 2 ms, 96 frames, which the longest with its guards
 * and residual tail fits.
 */
const CLICKS = [
  { at: 4_100, width: 5, size: 0.6 },
  { at: 11_377, width: 12, size: 0.4 },
  { at: 23_050, width: 30, size: 0.3 },
  { at: 36_901, width: 60, size: 0.25 },
];
const VALUES = { 'maximum-length': 2 };
const CLEAN = partials(48_000);
const DIRTY = withClicks(CLEAN, CLICKS);

/**
 * The frames a repair may touch about each click: its guard of 2 before, and
 * after it the guard and the 16 frames over which a click's residual spreads.
 */
const BEFORE = 2;
const AFTER = 2 + 16;

function render(): Float32Array {
  const [out] = runProcessor(DE_CLICK, { layout: StandardLayouts.mono, values: VALUES }, [DIRTY]);
  return out ?? new Float32Array(0);
}

function latency(): number {
  const declared = DE_CLICK.descriptor.latency({
    values: processorValues(DE_CLICK, VALUES),
    sampleRate: TEST_RATE,
    quality: MAXIMUM_QUALITY.settings,
  });
  if (declared.kind !== 'known') throw new Error('A de-click states its latency.');
  return declared.frames;
}

describe('the de-click, held to a recorded render', () => {
  it('renders clicked partials to the recorded bits', () => {
    expect(fingerprint(render())).toBe(7786510622945885075n);
  });

  it('repairs each click to within 0.006 of the clean signal and touches nothing else', () => {
    const out = render();
    const delay = latency();
    for (const { at, width, size } of CLICKS) {
      // The click was as large as its size; its repair is 40 dB nearer clean.
      expect(worstError(DIRTY, CLEAN, 0, at, at + width)).toBeGreaterThan(size / 4);
      expect(worstError(out, CLEAN, delay, at - BEFORE, at + width + AFTER)).toBeLessThan(0.006);
    }
    const changed = changedFrames(out, DIRTY, delay);
    const near = (frame: number) =>
      CLICKS.some(({ at, width }) => frame >= at - BEFORE && frame < at + width + AFTER);
    expect(changed.filter((frame) => !near(frame))).toEqual([]);
    // Every click's first frame was among those repaired.
    for (const { at } of CLICKS) expect(changed).toContain(at);
  });
});
