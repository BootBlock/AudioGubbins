import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';
import type { SettingValue } from '@audiogubbins/audio-graph';

import {
  GENERIC_LAYOUTS,
  RATE,
  STEMS,
  blockOf,
  distinctBlock,
  distinctSample,
  kernelContext,
  kernelOf,
  nodeOf,
  port,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { METER_NODE } from './meter.js';
import type { MeterReading, MeterTarget } from './node-implementation.js';

function meter(layout: ChannelLayout, settings: Readonly<Record<string, SettingValue>> = {}) {
  return nodeOf(BuiltInNodeType.Meter, { inputs: [port('in', layout)], settings });
}

/** A meter bound to a target that keeps a copy of each reading's correlations. */
function correlating(layout: ChannelLayout, pairs: readonly number[]) {
  const node = meter(layout, { correlate: pairs });
  const readings: number[][] = [];
  const target: MeterTarget = {
    receive: (reading) => readings.push([...reading.correlation]),
  };
  const kernel = kernelOf(
    METER_NODE,
    node,
    kernelContext({ meters: new Map([[node.id, target]]) }),
  );
  return { kernel, readings };
}

/**
 * Pearson's correlation of two channels over a block, in the order the meter
 * states: each mean summed in f64 in frame order and divided once, then the
 * products of the deviations summed in f64 in frame order, and the quotient
 * by the root of the product of the two sums of squares.
 */
function pearson(first: readonly number[], second: readonly number[]): number {
  const frames = first.length;
  const mean = (samples: readonly number[]) => samples.reduce((sum, one) => sum + one, 0) / frames;
  const firstMean = mean(first);
  const secondMean = mean(second);
  let cross = 0;
  let firstSquares = 0;
  let secondSquares = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const a = (first[frame] ?? 0) - firstMean;
    const b = (second[frame] ?? 0) - secondMean;
    cross += a * b;
    firstSquares += a * a;
    secondSquares += b * b;
  }
  const spread = Math.sqrt(firstSquares * secondSquares);
  return spread === 0 ? 0 : Math.min(1, Math.max(-1, cross / spread));
}

/** A target that keeps a copy of each reading, and the reading object itself. */
function recording() {
  const copies: { frames: number; peak: number[]; rms: number[] }[] = [];
  const objects: MeterReading[] = [];
  const target: MeterTarget = {
    receive: (reading) => {
      objects.push(reading);
      copies.push({ frames: reading.frames, peak: [...reading.peak], rms: [...reading.rms] });
    },
  };
  return { target, copies, objects };
}

describe('the meter node', () => {
  it('accepts one input and no settings, of no latency', () => {
    const node = meter(StandardLayouts.stereo);
    expect(METER_NODE.check(node)).toEqual([]);
    expect(METER_NODE.latency(node, RATE)).toEqual({ kind: 'known', frames: ZERO_SAMPLES });
  });

  it('reports each malformed shape with its own code', () => {
    expect(
      METER_NODE.check(
        nodeOf(BuiltInNodeType.Meter, {
          inputs: [port('in', StandardLayouts.mono), port('also', StandardLayouts.mono)],
        }),
      ).map((one) => one.code),
    ).toEqual(['role-ports-invalid']);
    expect(
      METER_NODE.check(
        nodeOf(BuiltInNodeType.Meter, {
          inputs: [port('in', StandardLayouts.mono)],
          settings: { window: 300 },
        }),
      ).map((one) => one.code),
    ).toEqual(['node-settings-invalid']);
  });

  it('measures the peak and the root mean square of a block', () => {
    const node = meter(StandardLayouts.mono);
    const { target, copies } = recording();
    const kernel = kernelOf(
      METER_NODE,
      node,
      kernelContext({ meters: new Map([[node.id, target]]) }),
    );
    kernel.process([blockOf(StandardLayouts.mono, [[0.5, -1, 0.25, 0]])], [], 4);
    expect(copies).toEqual([{ frames: 4, peak: [1], rms: [Math.sqrt(1.3125 / 4)] }]);
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`measures every ${name} channel on its own, reusing one reading`, () => {
      const node = meter(layout);
      const { target, copies, objects } = recording();
      const kernel = kernelOf(
        METER_NODE,
        node,
        kernelContext({ meters: new Map([[node.id, target]]) }),
      );
      kernel.process([distinctBlock(layout, 64)], [], 64);
      kernel.process([distinctBlock(layout, 32, 64)], [], 32);
      const expectedOf = (start: number, frames: number) => {
        const channels = layout.roles.map((_, index) =>
          Array.from({ length: frames }, (__, frame) =>
            Math.fround(distinctSample(index, start + frame)),
          ),
        );
        return {
          frames,
          peak: channels.map((samples) => Math.max(...samples.map(Math.abs))),
          rms: channels.map((samples) =>
            Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / frames),
          ),
        };
      };
      expect(copies).toEqual([expectedOf(0, 64), expectedOf(64, 32)]);
      expect(objects[0]).toBe(objects[1]);
    });
  }

  it('accepts pairs of its channels to correlate, and refuses any that are not', () => {
    const codes = (layout: ChannelLayout, correlate: SettingValue) =>
      METER_NODE.check(meter(layout, { correlate })).map((one) => one.code);
    expect(codes(StandardLayouts.surround5_1, [0, 1, 4, 5, 2, 0])).toEqual([]);
    expect(codes(StandardLayouts.stereo, [0])).toEqual(['node-settings-invalid']);
    expect(codes(StandardLayouts.stereo, [0, 2])).toEqual(['node-settings-invalid']);
    expect(codes(StandardLayouts.stereo, [1, 1])).toEqual(['node-settings-invalid']);
    expect(codes(StandardLayouts.stereo, [0, 0.5])).toEqual(['node-settings-invalid']);
    expect(codes(StandardLayouts.mono, [0, 0])).toEqual(['node-settings-invalid']);
    expect(codes(StandardLayouts.stereo, 'left-right')).toEqual(['node-settings-invalid']);
  });

  it('reports no correlation without pairs to correlate', () => {
    const { kernel, readings } = correlating(StandardLayouts.stereo, []);
    kernel.process([distinctBlock(StandardLayouts.stereo, 16)], [], 16);
    expect(readings).toEqual([[]]);
  });

  it('reads 1 for a channel in phase with another, -1 for one inverted, and 0 for silence', () => {
    const wave = Array.from({ length: 96 }, (_, frame) =>
      Math.fround(((frame * 37) % 23) / 23 - 0.4),
    );
    const block = blockOf(StandardLayouts.lcr, [wave, wave.map((one) => -one), wave.map(() => 0)]);
    const { kernel, readings } = correlating(StandardLayouts.lcr, [0, 1, 1, 0, 0, 2]);
    kernel.process([block], [], 96);
    const [[inverted, again, silent] = []] = readings;
    expect(inverted).toBeCloseTo(-1, 12);
    expect(again).toBe(inverted);
    expect(silent).toBe(0);
    const { kernel: same, readings: sameReadings } = correlating(StandardLayouts.stereo, [0, 1]);
    same.process([blockOf(StandardLayouts.stereo, [wave, wave])], [], 96);
    expect(sameReadings[0]?.[0]).toBeCloseTo(1, 12);
  });

  for (const [name, layout, pairs] of [
    ['stereo', StandardLayouts.stereo, [0, 1]],
    ['5.1', StandardLayouts.surround5_1, [0, 1, 4, 5, 2, 3, 0, 4]],
    ['a labelled custom map', STEMS, [0, 2, 1, 2]],
  ] as const) {
    it(`correlates each named pair of ${name} channels over each block, in f64 in a stated order`, () => {
      const { kernel, readings } = correlating(layout, pairs);
      // Channels whose signals are not proportional, so every pair has its own reading.
      const signal = (channel: number, frame: number) =>
        Math.fround(((frame * (channel + 3)) % 17) / 17 - 0.5 + channel / 10);
      const blockAt = (start: number, frames: number) =>
        blockOf(
          layout,
          layout.roles.map((_, channel) =>
            Array.from({ length: frames }, (__, frame) => signal(channel, start + frame)),
          ),
        );
      kernel.process([blockAt(0, 128)], [], 128);
      kernel.process([blockAt(128, 50)], [], 50);
      const expected = (start: number, frames: number) =>
        Array.from({ length: pairs.length / 2 }, (_, pair) => {
          const channelOf = (index: number) => pairs[index] ?? 0;
          const samples = (channel: number) =>
            Array.from({ length: frames }, (__, frame) => signal(channel, start + frame));
          return pearson(samples(channelOf(pair * 2)), samples(channelOf(pair * 2 + 1)));
        });
      expect(readings).toEqual([expected(0, 128), expected(128, 50)]);
      expect(new Set(readings[0]).size).toBe(pairs.length / 2);
    });
  }

  it('does nothing when no one watches it', () => {
    const kernel = kernelOf(METER_NODE, meter(StandardLayouts.stereo));
    expect(() => {
      kernel.process([distinctBlock(StandardLayouts.stereo, 16)], [], 16);
    }).not.toThrow();
    expect(expectFailureCode(kernel.setParameter('window', 1))).toBe('node.parameter-unknown');
  });
});
