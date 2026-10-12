/**
 * A spectrogram lane's frequency axis and its inverse: a frequency drawn at a
 * height is the frequency read back from that height, and a height read as a
 * frequency is drawn at that height again, on every scale the lane offers, at
 * any size, and the same each time it is asked.
 */

import { describe, expect, it } from 'vitest';

import { frequencyAt, frequencyOnAxis, frequencyY } from './frequency-axis.js';
import { LaneKind, type Lane } from './lane-layout.js';
import type { SpectralSettings } from './view-state.js';

/** Every scale a lane offers, each over a narrow and a wide band. */
const AXES: readonly SpectralSettings[] = [
  { frequencyScale: 'linear', lowest: 20, highest: 20_000 },
  { frequencyScale: 'linear', lowest: 1_000, highest: 1_250 },
  { frequencyScale: 'logarithmic', lowest: 20, highest: 20_000 },
  { frequencyScale: 'logarithmic', lowest: 5, highest: 192_000 },
  { frequencyScale: 'logarithmic', lowest: 400, highest: 440 },
];

/** Lanes of the sizes a view lays out: short and tall, high and low in the view. */
const LANES: readonly Lane[] = [
  { channel: 0, kind: LaneKind.Spectrogram, area: { x: 0, y: 42, width: 1000, height: 179 } },
  { channel: 1, kind: LaneKind.Overlay, area: { x: 0, y: 400.5, width: 640, height: 37.25 } },
  { channel: 2, kind: LaneKind.Spectrogram, area: { x: 0, y: 1200, width: 3840, height: 1080 } },
];

const name = (axis: SpectralSettings): string =>
  `${axis.frequencyScale} ${String(axis.lowest)}–${String(axis.highest)} Hz`;

describe('the frequency axis', () => {
  it.each(AXES.map((axis) => [name(axis), axis] as const))(
    'reads back every frequency it draws, %s',
    (_name, axis) => {
      for (const lane of LANES) {
        for (let step = 0; step <= 64; step += 1) {
          const share = step / 64;
          const frequency =
            axis.frequencyScale === 'linear'
              ? axis.lowest + share * (axis.highest - axis.lowest)
              : axis.lowest * (axis.highest / axis.lowest) ** share;
          const read = frequencyAt(lane, frequencyY(lane, frequency, axis), axis);
          expect(Math.abs(read - frequency) / frequency).toBeLessThan(1e-12);
        }
      }
    },
  );

  it.each(AXES.map((axis) => [name(axis), axis] as const))(
    'draws every height it reads at that height, %s',
    (_name, axis) => {
      for (const lane of LANES) {
        const { y, height } = lane.area;
        for (let row = 0; row <= 4 * height; row += 1) {
          const at = y + row / 4;
          expect(frequencyY(lane, frequencyAt(lane, at, axis), axis)).toBeCloseTo(at, 9);
        }
      }
    },
  );

  it('puts the lowest frequency at the bottom edge and the highest at the top', () => {
    for (const axis of AXES) {
      for (const lane of LANES) {
        expect(frequencyY(lane, axis.lowest, axis)).toBeCloseTo(lane.area.y + lane.area.height, 9);
        expect(frequencyY(lane, axis.highest, axis)).toBeCloseTo(lane.area.y, 9);
        expect(frequencyAt(lane, lane.area.y + lane.area.height, axis)).toBeCloseTo(axis.lowest, 9);
      }
    }
  });

  it('spaces octaves evenly on a logarithmic scale, and hertz on a linear one', () => {
    const [lane] = LANES;
    if (lane === undefined) throw new Error('No lane.');
    const log: SpectralSettings = { frequencyScale: 'logarithmic', lowest: 25, highest: 25_600 };
    const octave = frequencyY(lane, 100, log) - frequencyY(lane, 200, log);
    expect(frequencyY(lane, 1_600, log) - frequencyY(lane, 3_200, log)).toBeCloseTo(octave, 9);
    const linear: SpectralSettings = { frequencyScale: 'linear', lowest: 0.5, highest: 1_000.5 };
    const hundred = frequencyY(lane, 100.5, linear) - frequencyY(lane, 200.5, linear);
    expect(frequencyY(lane, 800.5, linear) - frequencyY(lane, 900.5, linear)).toBeCloseTo(
      hundred,
      9,
    );
  });

  it('takes a height beyond the lane to the edge it lies beyond, and a frequency likewise', () => {
    for (const axis of AXES) {
      for (const lane of LANES) {
        expect(frequencyAt(lane, lane.area.y - 500, axis)).toBe(axis.highest);
        expect(frequencyAt(lane, lane.area.y + lane.area.height + 500, axis)).toBe(axis.lowest);
        expect(frequencyY(lane, axis.highest * 4, axis)).toBe(lane.area.y);
        expect(frequencyY(lane, axis.lowest / 4, axis)).toBe(lane.area.y + lane.area.height);
      }
    }
  });

  it('runs on past the edges where a reach is measured, still the same mapping', () => {
    for (const axis of AXES) {
      for (const lane of LANES) {
        const above = frequencyOnAxis(lane, lane.area.y - 10, axis);
        const below = frequencyOnAxis(lane, lane.area.y + lane.area.height + 10, axis);
        expect(above).toBeGreaterThan(axis.highest);
        expect(below).toBeLessThan(axis.lowest);
        const inside = lane.area.y + lane.area.height / 3;
        expect(frequencyOnAxis(lane, inside, axis)).toBe(frequencyAt(lane, inside, axis));
      }
    }
  });

  it('gives the same frequency for the same height every time it is asked', () => {
    for (const axis of AXES) {
      for (const lane of LANES) {
        const at = lane.area.y + lane.area.height * 0.37;
        const first = frequencyAt(lane, at, axis);
        for (let again = 0; again < 8; again += 1) {
          expect(frequencyAt({ ...lane, area: { ...lane.area } }, at, { ...axis })).toBe(first);
        }
      }
    }
  });
});
