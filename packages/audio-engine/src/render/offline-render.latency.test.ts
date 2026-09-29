/**
 * Latency through a render: reported latency propagates through serial and
 * parallel paths, parallel paths are aligned, and a render trims what the
 * graph reports so its audio lines up with its sources (REQ-ARCH-144).
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { BUILT_IN_NODES } from '../nodes/built-in-nodes.js';
import { BuiltInNodeType } from '../nodes/built-in-node-type.js';
import type { NodeImplementation } from '../nodes/node-implementation.js';
import { graphOf, named, nodeOf, wire } from '../testing/graph-builders.js';
import { collectingSink, distinctAudio, jobOf, sourceOf } from '../testing/render-harness.js';
import { renderOffline } from './offline-renderer.js';

const STEREO: ChannelLayout = StandardLayouts.stereo;
const LENGTH = 3_000;

function lookahead(name: string, frames: number, asLatency = true) {
  return nodeOf(
    name,
    BuiltInNodeType.Delay,
    STEREO,
    { inputs: ['in'], outputs: ['out'] },
    { frames, 'as-latency': asLatency },
  );
}

const input = nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] });
const output = nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] });

/** Renders `graph` over the source `audio`, from `start`, and what the sink received. */
async function render(
  graph: ReturnType<typeof graphOf>,
  options: { readonly start?: number; readonly chunkFrames?: number } = {},
) {
  const audio = distinctAudio(STEREO, 5_000);
  const out = collectingSink();
  const summary = expectSuccess(
    await renderOffline(
      jobOf(graph, {
        sources: { in: sourceOf(audio) },
        sinks: { out },
        length: LENGTH,
        ...options,
      }),
      REFERENCE_DSP,
      BUILT_IN_NODES,
    ),
  );
  return { audio, channels: out.channels(), summary };
}

describe('latency in an offline render', () => {
  it('trims a serial chain by the sum of its latencies, rendering the tail from the source', async () => {
    const graph = graphOf(
      [input, lookahead('first', 30), lookahead('second', 70), output],
      [wire('in.out', 'first.in'), wire('first.out', 'second.in'), wire('second.out', 'out.in')],
    );
    for (const chunkFrames of [4_096, 64, 99]) {
      const { audio, channels, summary } = await render(graph, { start: 1_000, chunkFrames });
      expect(summary.latencyTrimmed.get(named('out'))).toBe(100);
      // Aligned with the source from the range's start to its last frame,
      // which needed the 100 frames after the range to be read.
      audio.channels.forEach((channel, index) => {
        expect(channels[index]).toEqual(channel.subarray(1_000, 1_000 + LENGTH));
      });
    }
  });

  it('aligns a parallel path with a late one, so the two sum exactly', async () => {
    const graph = graphOf(
      [
        input,
        lookahead('wet', 64),
        nodeOf('both', BuiltInNodeType.Mix, STEREO, { inputs: ['a', 'b'], outputs: ['out'] }),
        output,
      ],
      [
        wire('in.out', 'wet.in'),
        wire('wet.out', 'both.a'),
        wire('in.out', 'both.b'),
        wire('both.out', 'out.in'),
      ],
    );
    const { audio, channels, summary } = await render(graph);
    expect(summary.latencyTrimmed.get(named('out'))).toBe(64);
    audio.channels.forEach((channel, index) => {
      expect(channels[index]).toEqual(channel.subarray(0, LENGTH).map((sample) => sample * 2));
    });
  });

  it('keeps a delay that is the effect asked for, rather than trimming it', async () => {
    const graph = graphOf(
      [input, lookahead('echo', 50, false), output],
      [wire('in.out', 'echo.in'), wire('echo.out', 'out.in')],
    );
    const { audio, channels, summary } = await render(graph);
    expect(summary.latencyTrimmed.get(named('out'))).toBe(0);
    expect([...(channels[0]?.subarray(0, 50) ?? [])].every((sample) => sample === 0)).toBe(true);
    expect(channels[1]?.subarray(50)).toEqual(audio.channels[1]?.subarray(0, LENGTH - 50));
  });

  it('refuses to render a sink whose latency is not known', async () => {
    const gain = BUILT_IN_NODES.get(BuiltInNodeType.Gain);
    if (gain === undefined) throw new Error('Gain is a built-in node.');
    const mystery: NodeImplementation = {
      ...gain,
      type: 'mystery',
      latency: () => ({ kind: 'unknown', reason: 'It adapts its lookahead to the material.' }),
    };
    const graph = graphOf(
      [input, nodeOf('odd', 'mystery', STEREO, { inputs: ['in'], outputs: ['out'] }), output],
      [wire('in.out', 'odd.in'), wire('odd.out', 'out.in')],
    );
    const job = jobOf(graph, {
      sources: { in: sourceOf(distinctAudio(STEREO, 100)) },
      sinks: { out: collectingSink() },
      length: 100,
    });
    const nodes = new Map([...BUILT_IN_NODES, ['mystery', mystery]]);
    expect(expectFailureCode(await renderOffline(job, REFERENCE_DSP, nodes))).toBe(
      'render.latency-unknown',
    );
  });
});
