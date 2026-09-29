import { describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { compileGraph } from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  BuiltInNodeType,
  MAXIMUM_RENDER_QUALITY,
} from '@audiogubbins/audio-engine';
import { SourceKind } from '@audiogubbins/audio-runtime';

import { RENDER_SAMPLE_RATE, testSignalPlayback, testSignalRender } from './test-signal.js';

describe('the test signal', () => {
  it('is a graph the engine compiles: an input through a gain to a meter and one output', () => {
    const { graph } = expectSuccess(testSignalPlayback(44_100));
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

  it('plays and renders the one graph', () => {
    expect(expectSuccess(testSignalPlayback(44_100)).graph).toBe(
      expectSuccess(testSignalRender(500)).request.graph,
    );
  });

  it('meters the correlation of its left and right channels', () => {
    const { graph } = expectSuccess(testSignalPlayback(44_100));
    const meter = graph.nodes.find(
      (node) => node.kind === 'processing' && node.type === BuiltInNodeType.Meter,
    );

    expect(meter?.kind === 'processing' && meter.settings).toEqual({ correlate: [0, 1] });
  });

  it('plays a tone the feeder makes, at the context’s rate, ten seconds long, at a quarter of full scale', () => {
    const { graph, sources } = expectSuccess(testSignalPlayback(44_100));

    expect(sources).toEqual([
      {
        node: graph.nodes[0]?.id,
        kind: SourceKind.Tone,
        sampleRate: 44_100,
        frequency: 440,
        amplitude: 0.25,
        frames: 441_000,
      },
    ]);
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
