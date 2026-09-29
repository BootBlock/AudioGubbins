/**
 * The test signal: the deterministic PCM the packet's outcome plays and
 * renders, and the graph it runs through.
 *
 * A stereo tone from the canonical oscillator into a gain, whose output is
 * both metered and played: `graph-input → gain → meter + output`. The same
 * graph plays in real time, at the context's rate, and renders offline at
 * {@link RENDER_SAMPLE_RATE}, so the one graph exercises the transport, the
 * worklet, the meters and the render worker alike.
 *
 * Playback makes the tone on the main thread (`test-signal-tone.ts`); a render
 * describes it instead, and its worker makes it (`SourceKind.Tone`), so no
 * audio crosses a thread.
 */

import {
  StandardLayouts,
  ZERO_SAMPLES,
  flatMapResult,
  mapResult,
  sampleCount,
  sampleRate,
  type DomainResult,
} from '@audiogubbins/domain';
import {
  GRAPH_DESCRIPTOR_VERSION,
  nodeId,
  type GraphDescriptor,
  type NodeId,
  type ProcessingNodeDescriptor,
} from '@audiogubbins/audio-graph';
import { BuiltInNodeType, MAXIMUM_RENDER_QUALITY } from '@audiogubbins/audio-engine';
import { SourceKind, type RenderRequest } from '@audiogubbins/audio-runtime';

/** The tone: A above middle C, twelve decibels below full scale, for ten seconds. */
export const TEST_SIGNAL = { frequency: 440, amplitude: 0.25, seconds: 10 } as const;

/** The rate an offline render of the test signal runs at. */
export const RENDER_SAMPLE_RATE = 48_000;

/** The test signal's graph, and the nodes a caller binds. */
export interface TestSignalGraph {
  readonly graph: GraphDescriptor;
  readonly input: NodeId;
  readonly output: NodeId;
}

/** The layout the test signal is made in, from its source to its output. */
export const STEREO = StandardLayouts.stereo;

function node(
  id: NodeId,
  type: BuiltInNodeType,
  ports: { readonly inputs: readonly string[]; readonly outputs: readonly string[] },
  settings: ProcessingNodeDescriptor['settings'] = {},
): ProcessingNodeDescriptor {
  return {
    kind: 'processing',
    id,
    type,
    inputs: ports.inputs.map((name) => ({ name, layout: STEREO })),
    outputs: ports.outputs.map((name) => ({ name, layout: STEREO })),
    settings,
  };
}

function graphOf(input: NodeId, level: NodeId, meter: NodeId, output: NodeId): GraphDescriptor {
  return {
    version: GRAPH_DESCRIPTOR_VERSION,
    nodes: [
      node(input, BuiltInNodeType.GraphInput, { inputs: [], outputs: ['out'] }),
      // Unity: the gain is in the graph so that a stage between the source and
      // its two destinations is processed, not to change the level.
      node(level, BuiltInNodeType.Gain, { inputs: ['in'], outputs: ['out'] }, { gain: 1 }),
      node(meter, BuiltInNodeType.Meter, { inputs: ['in'], outputs: [] }),
      node(output, BuiltInNodeType.Output, { inputs: ['in'], outputs: [] }),
    ],
    edges: [
      { from: { node: input, port: 'out' }, to: { node: level, port: 'in' } },
      { from: { node: level, port: 'out' }, to: { node: meter, port: 'in' } },
      { from: { node: level, port: 'out' }, to: { node: output, port: 'in' } },
    ],
  };
}

/** The graph, built once: it is a value, and the same one plays and renders. */
export const TEST_SIGNAL_GRAPH: DomainResult<TestSignalGraph> = flatMapResult(
  nodeId('test-signal'),
  (input) =>
    flatMapResult(nodeId('level'), (level) =>
      flatMapResult(nodeId('meter'), (meter) =>
        mapResult(nodeId('output'), (output) => ({
          graph: graphOf(input, level, meter, output),
          input,
          output,
        })),
      ),
    ),
);

/** An offline render of the test signal, and the node its audio is written from. */
export interface TestSignalRender {
  readonly request: RenderRequest;
  readonly output: NodeId;
}

/**
 * The whole test signal rendered at maximum quality (REQ-ARCH-081), in
 * chunks of `chunkMilliseconds`, which the profile sets and which change no
 * bit of the output.
 */
export function testSignalRender(chunkMilliseconds: number): DomainResult<TestSignalRender> {
  return flatMapResult(TEST_SIGNAL_GRAPH, ({ graph, input, output }) =>
    flatMapResult(sampleRate(RENDER_SAMPLE_RATE), (rate) =>
      mapResult(sampleCount(TEST_SIGNAL.seconds * RENDER_SAMPLE_RATE), (length) => ({
        output,
        request: {
          graph,
          sampleRate: rate,
          range: { start: ZERO_SAMPLES, length },
          chunkFrames: Math.max(1, Math.round((chunkMilliseconds * RENDER_SAMPLE_RATE) / 1000)),
          quality: MAXIMUM_RENDER_QUALITY,
          sources: [
            {
              node: input,
              kind: SourceKind.Tone,
              sampleRate: rate,
              frequency: TEST_SIGNAL.frequency,
              amplitude: TEST_SIGNAL.amplitude,
              frames: length,
            },
          ],
        },
      })),
    ),
  );
}
