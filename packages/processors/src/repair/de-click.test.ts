import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';

import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { changedFrames, partials, withClicks, worstError } from '../testing/repair-signals.js';
import { DE_CLICK } from './de-click.js';

const mono = StandardLayouts.mono;
const LENGTH = 24_000;

type Values = Readonly<Record<string, string | number>>;

function latencyOf(values: Values = {}): number {
  const latency = DE_CLICK.descriptor.latency({
    values: processorValues(DE_CLICK, values),
    sampleRate: TEST_RATE,
    quality: MAXIMUM_QUALITY.settings,
  });
  if (latency.kind !== 'known') throw new Error('A de-click states its latency.');
  return latency.frames;
}

function render(input: Float32Array, values: Values = {}): Float32Array {
  const [out] = runProcessor(DE_CLICK, { layout: mono, values }, [input]);
  return out ?? new Float32Array(0);
}

describe('the de-click', () => {
  it('repairs as a run from the start does once settled, when started on its frame grid', () => {
    const settings = {
      values: processorValues(DE_CLICK, {}),
      sampleRate: TEST_RATE,
      quality: MAXIMUM_QUALITY.settings,
    };
    const leadIn = DE_CLICK.descriptor.leadIn(settings);
    const grid = DE_CLICK.descriptor.frameGrid(settings);
    const clicks = [14_000, 19_003, 26_011, 33_017].map((at) => ({ at, width: 30, size: 0.2 }));
    const dirty = withClicks(partials(2 * LENGTH), clicks);
    const whole = render(dirty);
    const worst = (from: number) => {
      const late = render(dirty.slice(from));
      let most = 0;
      for (let frame = leadIn + latencyOf(); frame < late.length; frame += 1)
        most = Math.max(most, Math.abs((late[frame] ?? 0) - (whole[from + frame] ?? 0)));
      return most;
    };
    // Off the grid the detector judges other blocks, and a click is missed.
    expect(worst(4 * grid)).toBe(0);
    expect(worst(4 * grid + 100)).toBeGreaterThan(0.01);
  });

  it('states the latency its geometry gives: 1 326 frames at 1 ms, 1 374 at 2 ms', () => {
    // M + C + B − 2: M the longest click, C = 256, B = 1 024 at 48 kHz.
    expect(latencyOf()).toBe(48 + 256 + 1_024 - 2);
    expect(latencyOf({ 'maximum-length': 2 })).toBe(96 + 256 + 1_024 - 2);
  });

  it('repairs a long click wherever it falls against the detector blocks', () => {
    // A 60-frame click and its guard and residual tail fill most of the
    // longest span, 96 frames at 2 ms, and its end is moved across the
    // frames where its context's last frame meets a block end, the latest a
    // span is decided: every one is repaired before it is given.
    const values = { 'maximum-length': 2 };
    const latency = latencyOf(values);
    const clean = partials(LENGTH * 2);
    for (let at = 13 * 1_024 + 660; at < 13 * 1_024 + 724; at += 1) {
      const dirty = withClicks(clean, [{ at, width: 60, size: 0.2 }]);
      expect(worstError(render(dirty, values), clean, latency, at - 20, at + 110)).toBeLessThan(
        0.02,
      );
    }
  });

  it('repairs a click of the longest span decided at the latest, the latency its slack', () => {
    // A click whose span, guards and tail included, is the longest, 96
    // frames, moved until its context of 256 ends on the first frame of a
    // detector block of 1 024: decided only at that block's end, its first
    // frame is given that same frame, so a latency one frame shorter gives
    // it unrepaired. Which frames were repaired is read from the auditioning
    // output.
    const values = { 'maximum-length': 2 };
    const latency = latencyOf(values);
    const clean = partials(LENGTH * 2);
    let latest = 0;
    for (let at = 13 * 1_024 + 667; at < 13 * 1_024 + 683; at += 1) {
      const dirty = withClicks(clean, [{ at, width: 82, size: 0.2, seed: 2 }]);
      const taken = render(dirty, { ...values, output: 'clicks' });
      const repaired = [];
      for (let frame = at - 40; frame < at + 140; frame += 1) {
        if (taken[frame + latency] !== 0) repaired.push(frame);
      }
      const first = repaired[0] ?? 0;
      const last = repaired[repaired.length - 1] ?? 0;
      if (last - first + 1 === 96 && (last + 256) % 1_024 === 0) latest += 1;
      // A span the music under it has made longer than 96 is rightly left.
      if (repaired.length > 0) {
        const error = worstError(render(dirty, values), clean, latency, at - 20, at + 110);
        expect(error).toBeLessThan(0.02);
      }
    }
    expect(latest).toBeGreaterThan(0);
  });

  it('leaves a burst longer than the longest click as the sound it is', () => {
    const clean = partials(LENGTH);
    // Three milliseconds of noise against a longest click of one.
    const dirty = withClicks(clean, [{ at: 9_000, width: 144, size: 0.3 }]);
    const out = render(dirty, { 'maximum-length': 1 });
    expect(changedFrames(out, dirty, latencyOf({ 'maximum-length': 1 }))).toEqual([]);
  });

  it('finds a click only above the sensitivity, which moves while it plays', () => {
    const clean = partials(LENGTH);
    const dirty = withClicks(clean, [
      { at: 6_000, width: 4, size: 0.008 },
      { at: 18_000, width: 4, size: 0.008 },
    ]);
    const latency = latencyOf();
    // At the least sensitivity a click so small is passed over.
    expect(changedFrames(render(dirty, { sensitivity: 30 }), dirty, latency)).toEqual([]);
    const repaired = render(dirty, { sensitivity: 8 });
    expect(worstError(repaired, clean, latency, 5_990, 6_030)).toBeLessThan(0.001);
    expect(worstError(dirty, clean, 0, 5_990, 6_030)).toBeGreaterThan(0.004);
    // Moved to the least sensitivity part way through, the second click stays.
    const { kernel } = processorKernel(DE_CLICK, { layout: mono, values: { sensitivity: 8 } });
    const moved = new Float32Array(LENGTH);
    const block = (channel: Float32Array, from: number) => ({
      layout: mono,
      sampleRate: TEST_RATE,
      frames: 1_000,
      channels: [channel.subarray(from, from + 1_000)],
    });
    for (let from = 0; from < LENGTH; from += 1_000) {
      if (from === 12_000) expect(kernel.setParameter('sensitivity', 30).ok).toBe(true);
      kernel.process([block(dirty, from)], [block(moved, from)], 1_000);
    }
    expect(worstError(moved, clean, latency, 5_990, 6_030)).toBeLessThan(0.001);
    expect(changedFrames(moved, dirty, latency).filter((frame) => frame > 12_000)).toEqual([]);
  });

  it('refuses to move the longest click or the output while it plays', () => {
    const { kernel } = processorKernel(DE_CLICK, { layout: mono });
    expect(kernel.setParameter('maximum-length', 2).ok).toBe(false);
    expect(kernel.setParameter('output', 1).ok).toBe(false);
    expect(kernel.setParameter('sensitivity', 31).ok).toBe(false);
  });

  it('gives the removed clicks alone, which with the repaired audio make the input', () => {
    const clean = partials(LENGTH);
    const dirty = withClicks(clean, [{ at: 7_000, width: 10, size: 0.4 }]);
    const latency = latencyOf();
    const repaired = render(dirty);
    const clicks = render(dirty, { output: 'clicks' });
    let worst = 0;
    for (let frame = 0; frame + latency < LENGTH; frame += 1) {
      const sum = (repaired[frame + latency] ?? 0) + (clicks[frame + latency] ?? 0);
      worst = Math.max(worst, Math.abs(sum - (dirty[frame] ?? 0)));
      if (frame < 6_990 || frame > 7_040) expect(clicks[frame + latency]).toBe(0);
    }
    // Each is a float rounded once, so they sum to the input within a rounding.
    expect(worst).toBeLessThan(1e-7);
    // What it gives over the click is the click: the input less the clean signal.
    for (let frame = 7_000; frame < 7_010; frame += 1) {
      const click = (dirty[frame] ?? 0) - (clean[frame] ?? 0);
      expect(Math.abs((clicks[frame + latency] ?? 0) - click)).toBeLessThan(0.005);
    }
  });

  it('repairs each channel alone, leaving a clean channel beside a clicked one untouched', () => {
    const clean = partials(LENGTH);
    const other = partials(LENGTH, 11);
    const dirty = withClicks(clean, [{ at: 8_000, width: 6, size: 0.5 }]);
    const latency = latencyOf();
    const [left = new Float32Array(0), right = new Float32Array(0)] = runProcessor(
      DE_CLICK,
      { layout: StandardLayouts.stereo },
      [dirty, other],
    );
    expect(worstError(left, clean, latency, 7_990, 8_040)).toBeLessThan(0.005);
    expect(changedFrames(right, other, latency)).toEqual([]);
  });
});
