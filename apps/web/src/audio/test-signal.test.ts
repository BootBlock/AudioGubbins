import { describe, expect, it } from 'vitest';

import { StandardLayouts, ZERO_SAMPLES, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { compileGraph } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  BuiltInNodeType,
  MAXIMUM_RENDER_QUALITY,
  allocateBlock,
} from '@audiogubbins/audio-engine';
import { SourceKind } from '@audiogubbins/audio-runtime';

import { RENDER_SAMPLE_RATE, TEST_SIGNAL_GRAPH, testSignalRender } from './test-signal.js';
import { testSignalPlayback } from './test-signal-tone.js';

describe('the test signal', () => {
  it('is a graph the engine compiles: an input through a gain to a meter and one output', () => {
    const { graph } = expectSuccess(TEST_SIGNAL_GRAPH);
    const compiled = compileGraph(graph, BUILT_IN_NODES, expectSuccess(sampleRate(44_100)));

    expect(compiled.ok).toBe(true);
    expect(graph.nodes.map((node) => (node.kind === 'processing' ? node.type : node.kind))).toEqual(
      [
        BuiltInNodeType.GraphInput,
        BuiltInNodeType.Gain,
        BuiltInNodeType.Meter,
        BuiltInNodeType.Output,
      ],
    );
    expect(compiled.ok && compiled.plan.sinks).toHaveLength(1);
  });

  it('plays a stereo tone at the context’s rate, ten seconds long, peaking at a quarter of full scale', async () => {
    const { request, source } = expectSuccess(testSignalPlayback(44_100));
    const [input] = request.sources.keys();

    expect(input).toBeDefined();
    expect(source.sampleRate).toBe(44_100);
    expect(source.length).toBe(441_000);
    expect(source.layout).toEqual(StandardLayouts.stereo);

    // A whole cycle and more, which reaches the peak of the sine.
    const block = allocateBlock(source.layout, source.sampleRate, 200);
    expect(await source.read(ZERO_SAMPLES, block)).toBe(200);
    const [left, right] = block.channels;
    expect(Math.max(...(left ?? []))).toBeCloseTo(0.25, 3);
    expect(right).toEqual(left);
    source.release();
  });

  it('renders the same graph from a tone the worker makes, at 48 kHz and maximum quality', () => {
    const { request, output } = expectSuccess(testSignalRender(500));

    expect(request.sampleRate).toBe(RENDER_SAMPLE_RATE);
    expect(request.range).toEqual({ start: 0, length: 480_000 });
    expect(request.quality).toBe(MAXIMUM_RENDER_QUALITY);
    expect(request.chunkFrames).toBe(24_000);
    expect(request.sources).toEqual([
      {
        node: request.graph.nodes[0]?.id,
        kind: SourceKind.Tone,
        sampleRate: 48_000,
        frequency: 440,
        amplitude: 0.25,
        frames: 480_000,
      },
    ]);
    expect(request.graph.nodes.map((node) => node.id)).toContain(output);
  });

  it('never asks for a chunk of no frames, whatever the profile says', () => {
    expect(expectSuccess(testSignalRender(0.001)).request.chunkFrames).toBe(1);
  });
});
