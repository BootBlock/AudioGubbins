import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';

import {
  GENERIC_LAYOUTS,
  RATE,
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

function meter(layout: ChannelLayout) {
  return nodeOf(BuiltInNodeType.Meter, { inputs: [port('in', layout)] });
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

  it('does nothing when no one watches it', () => {
    const kernel = kernelOf(METER_NODE, meter(StandardLayouts.stereo));
    expect(() => {
      kernel.process([distinctBlock(StandardLayouts.stereo, 16)], [], 16);
    }).not.toThrow();
    expect(expectFailureCode(kernel.setParameter('window', 1))).toBe('node.parameter-unknown');
  });
});
