import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';
import type { SettingValue } from '@audiogubbins/audio-graph';

import {
  GENERIC_LAYOUTS,
  RATE,
  distinctBlock,
  distinctSample,
  kernelContext,
  kernelOf,
  nodeOf,
  port,
  runInCalls,
  stepOf,
} from '../testing/kernel-harness.js';
import { BuiltInNodeType } from './built-in-node-type.js';
import { DELAY_NODE } from './delay.js';

function delay(layout: ChannelLayout, settings: Readonly<Record<string, SettingValue>>) {
  return nodeOf(BuiltInNodeType.Delay, {
    inputs: [port('in', layout)],
    outputs: [port('out', layout)],
    settings,
  });
}

function codes(node: ReturnType<typeof delay>) {
  return DELAY_NODE.check(node).map((one) => one.code);
}

/** A layout's distinct signal, `frames` later, silent before. */
function delayed(layout: ChannelLayout, frames: number, total: number): Float32Array[] {
  return layout.roles.map((_, index) =>
    Float32Array.from({ length: total }, (__, frame) =>
      frame < frames ? 0 : distinctSample(index, frame - frames),
    ),
  );
}

/** A layout's distinct signal, each channel `frames[channel]` later, silent before. */
function delayedEach(
  layout: ChannelLayout,
  frames: readonly number[],
  total: number,
): Float32Array[] {
  return layout.roles.map((_, index) => {
    const lag = frames[index] ?? 0;
    return Float32Array.from({ length: total }, (__, frame) =>
      frame < lag ? 0 : distinctSample(index, frame - lag),
    );
  });
}

describe('the delay node', () => {
  it('accepts a whole number of frames, zero included', () => {
    expect(DELAY_NODE.check(delay(StandardLayouts.stereo, { frames: 0 }))).toEqual([]);
    expect(
      DELAY_NODE.check(delay(StandardLayouts.stereo, { frames: 480, 'as-latency': true })),
    ).toEqual([]);
  });

  it('reports each malformed shape with its own code', () => {
    const stereo = StandardLayouts.stereo;
    expect(codes(delay(stereo, {}))).toEqual(['node-settings-invalid']);
    expect(codes(delay(stereo, { frames: -1 }))).toEqual(['node-settings-invalid']);
    expect(codes(delay(stereo, { frames: 1.5 }))).toEqual(['node-settings-invalid']);
    expect(codes(delay(stereo, { frames: 1, 'as-latency': 1 }))).toEqual(['node-settings-invalid']);
    expect(codes(delay(stereo, { frames: 1, asLatency: true }))).toEqual(['node-settings-invalid']);
    expect(
      codes(
        nodeOf(BuiltInNodeType.Delay, {
          inputs: [port('in', stereo)],
          outputs: [port('out', StandardLayouts.mono)],
          settings: { frames: 1 },
        }),
      ),
    ).toEqual(['layout-unsupported']);
  });

  it('reports its frames as latency only when it stands for a lookahead', () => {
    const stereo = StandardLayouts.stereo;
    expect(DELAY_NODE.latency(delay(stereo, { frames: 64 }), RATE)).toEqual({
      kind: 'known',
      frames: ZERO_SAMPLES,
    });
    expect(DELAY_NODE.latency(delay(stereo, { frames: 64, 'as-latency': false }), RATE)).toEqual({
      kind: 'known',
      frames: ZERO_SAMPLES,
    });
    expect(DELAY_NODE.latency(delay(stereo, { frames: 64, 'as-latency': true }), RATE)).toEqual({
      kind: 'known',
      frames: 64,
    });
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`delays every ${name} channel by its frames`, () => {
      const kernel = kernelOf(DELAY_NODE, delay(layout, { frames: 50 }));
      const [out] = runInCalls(kernel, [distinctBlock(layout, 300)], [layout], 300, [128]);
      expect(out).toEqual(delayed(layout, 50, 300));
    });
  }

  it('gives the same bits however the stream is cut into blocks', () => {
    const layout = StandardLayouts.surround5_1;
    const input = distinctBlock(layout, 1000);
    const run = (sizes: readonly number[]) =>
      runInCalls(
        kernelOf(DELAY_NODE, delay(layout, { frames: 100 })),
        [input],
        [layout],
        1000,
        sizes,
      );
    const whole = run([128]);
    expect(whole).toEqual([delayed(layout, 100, 1000)]);
    expect(run([1, 7, 128, 33, 99])).toEqual(whole);
    expect(run([100])).toEqual(whole);
  });

  it('accepts a delay for each channel, and refuses a list of the wrong kind', () => {
    const stereo = StandardLayouts.stereo;
    expect(codes(delay(stereo, { frames: 0, 'channel-delays': [0, 12] }))).toEqual([]);
    expect(codes(delay(stereo, { frames: 0, 'channel-delays': [3] }))).toEqual([
      'node-settings-invalid',
    ]);
    expect(codes(delay(stereo, { frames: 0, 'channel-delays': [3, -1] }))).toEqual([
      'node-settings-invalid',
    ]);
    expect(codes(delay(stereo, { frames: 0, 'channel-delays': [3, 0.5] }))).toEqual([
      'node-settings-invalid',
    ]);
  });

  it('refuses samples for its list of delays, naming how many rather than each', () => {
    // Samples of whole numbers, which a list of them would be read as.
    const samples = Float32Array.from([0, 12]);
    const node = delay(StandardLayouts.stereo, { frames: 0, 'channel-delays': samples });
    const [problem, ...others] = DELAY_NODE.check(node);
    expect(others).toEqual([]);
    expect(problem?.code).toBe('node-settings-invalid');
    expect(problem?.message).toContain('setting 2 samples');
  });

  for (const [name, layout] of GENERIC_LAYOUTS) {
    it(`delays each ${name} channel by the frames and its own delay, however the blocks fall`, () => {
      const channelDelays = layout.roles.map((_, index) => index * 37 + (index % 2) * 5);
      const totals = channelDelays.map((one) => 20 + one);
      const run = (sizes: readonly number[]) =>
        runInCalls(
          kernelOf(DELAY_NODE, delay(layout, { frames: 20, 'channel-delays': channelDelays })),
          [distinctBlock(layout, 400)],
          [layout],
          400,
          sizes,
        );
      const expected = [delayedEach(layout, totals, 400)];
      expect(run([128])).toEqual(expected);
      expect(run([1, 7, 128, 33, 99])).toEqual(expected);
    });
  }

  it('reports as latency the delay every channel shares, and nothing for an effect', () => {
    const surround = StandardLayouts.surround5_1;
    const even = [4, 4, 4, 4, 4, 4];
    expect(
      DELAY_NODE.latency(
        delay(surround, { frames: 60, 'channel-delays': even, 'as-latency': true }),
        RATE,
      ),
    ).toEqual({ kind: 'known', frames: 64 });
    expect(
      DELAY_NODE.latency(
        delay(surround, { frames: 60, 'channel-delays': [0, 1, 2, 3, 4, 5] }),
        RATE,
      ),
    ).toEqual({ kind: 'known', frames: ZERO_SAMPLES });
  });

  it('refuses to stand for a lookahead when its channels are late by different amounts', () => {
    // A latency is one number for the whole port, so the graph could align only
    // one of the channels: claiming it would compensate the rest wrongly.
    const node = delay(StandardLayouts.stereo, {
      frames: 10,
      'channel-delays': [0, 5],
      'as-latency': true,
    });
    const [problem] = DELAY_NODE.check(node);
    expect(DELAY_NODE.check(node).map((one) => one.code)).toEqual(['node-settings-invalid']);
    expect(problem?.message).toContain('late by different amounts');
    expect(expectFailureCode(DELAY_NODE.createKernel(stepOf(node), kernelContext()))).toBe(
      'node.settings-invalid',
    );
  });

  it('passes audio straight through at zero frames', () => {
    const layout = StandardLayouts.stereo;
    const kernel = kernelOf(DELAY_NODE, delay(layout, { frames: 0 }));
    const [out] = runInCalls(kernel, [distinctBlock(layout, 64)], [layout], 64, [30]);
    expect(out).toEqual(delayed(layout, 0, 64));
  });

  it('says so, rather than throwing, when the machine cannot hold the delay', () => {
    const node = delay(StandardLayouts.mono, { frames: 2 ** 52 });
    expect(DELAY_NODE.check(node)).toEqual([]);
    expect(expectFailureCode(DELAY_NODE.createKernel(stepOf(node), kernelContext()))).toBe(
      'node.delay-unallocated',
    );
  });

  it('has no parameters', () => {
    const kernel = kernelOf(DELAY_NODE, delay(StandardLayouts.mono, { frames: 1 }));
    expect(expectFailureCode(kernel.setParameter('frames', 2))).toBe('node.parameter-unknown');
  });
});
