/**
 * The input's meters on the audio thread (ADR-0070): the engine's own meter
 * node on the dry input, so an input is measured as playback's output is,
 * peak, root mean square and phase correlation, by the one kernel.
 *
 * The meter runs in a graph of its own, the input feeding a meter and an
 * output nobody hears, compiled once when the processor is told what its
 * input is. Each quantum it is handed the input's arrays and copies them in,
 * as a graph input copies a feed, so the meter can never touch the audio the
 * capture keeps. Its readings gather in a window between reports, as
 * playback's do (`meter-window.ts`). Neighbouring channels are correlated in
 * pairs, the first with the second and so on, which is the stereo pair of a
 * stereo input and of each pair a multichannel input is wired as.
 */

import {
  channelCount,
  FailureKind,
  fail,
  failure,
  flatMapResult,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';
import {
  GRAPH_DESCRIPTOR_VERSION,
  compileGraph,
  nodeId,
  type GraphDescriptor,
  type NodeId,
} from '@audiogubbins/audio-graph';
import {
  BUILT_IN_NODES,
  BuiltInNodeType,
  createExecutor,
  type AudioFrameBlock,
  type CanonicalDsp,
  type GraphExecutor,
  type InputFeed,
} from '@audiogubbins/audio-engine';

import { MeterWindow, type WindowReport } from '../processor/meter-window.js';

/** Where the meter's graph takes its audio from: the input's arrays of the quantum being run. */
class QuantumFeed implements InputFeed {
  readonly layout: ChannelLayout;
  input: readonly Float32Array[] = [];

  constructor(layout: ChannelLayout) {
    this.layout = layout;
  }

  fill(into: AudioFrameBlock): number {
    for (let channel = 0; channel < into.channels.length; channel += 1) {
      const to = into.channels[channel];
      if (to === undefined) continue;
      const from = this.input[channel];
      for (let frame = 0; frame < into.frames; frame += 1) to[frame] = from?.[frame] ?? 0;
    }
    return into.frames;
  }
}

/** Where the meter's graph sends its output, which nobody hears. */
const UNHEARD = { receive: (): void => undefined };

/** The pairs of neighbouring channels of `channels`, written flat. */
function neighbouringPairs(channels: number): number[] {
  const pairs: number[] = [];
  for (let first = 0; first + 1 < channels; first += 2) pairs.push(first, first + 1);
  return pairs;
}

function named(name: string): NodeId {
  const id = nodeId(name);
  if (!id.ok) throw new Error(`The meter's graph names its node ${name}, a valid identifier.`);
  return id.value;
}

const INPUT = named('input');
const LEVEL = named('level');
const UNHEARD_OUTPUT = named('unheard');

/** input → level, and input → an output nobody hears, which a graph needs. */
function meterGraph(layout: ChannelLayout): GraphDescriptor {
  const port = (name: string): { readonly name: string; readonly layout: ChannelLayout } => ({
    name,
    layout,
  });
  return {
    version: GRAPH_DESCRIPTOR_VERSION,
    nodes: [
      {
        kind: 'processing',
        id: INPUT,
        type: BuiltInNodeType.GraphInput,
        inputs: [],
        outputs: [port('out')],
        settings: {},
      },
      {
        kind: 'processing',
        id: LEVEL,
        type: BuiltInNodeType.Meter,
        inputs: [port('in')],
        outputs: [],
        settings: { correlate: neighbouringPairs(channelCount(layout)) },
      },
      {
        kind: 'processing',
        id: UNHEARD_OUTPUT,
        type: BuiltInNodeType.Output,
        inputs: [port('in')],
        outputs: [],
        settings: {},
      },
    ],
    edges: [
      { from: { node: INPUT, port: 'out' }, to: { node: LEVEL, port: 'in' } },
      { from: { node: INPUT, port: 'out' }, to: { node: UNHEARD_OUTPUT, port: 'in' } },
    ],
  };
}

/** The meter on the dry input, and the window its readings gather in. */
export class InputMeter {
  readonly #executor: GraphExecutor;
  readonly #quantumFeed: QuantumFeed;
  readonly #window: MeterWindow;

  private constructor(executor: GraphExecutor, feed: QuantumFeed, window: MeterWindow) {
    this.#executor = executor;
    this.#quantumFeed = feed;
    this.#window = window;
  }

  /** The meter of an input of `layout` at `rate`, run a quantum of `blockFrames` at a time. */
  static make(
    layout: ChannelLayout,
    rate: SampleRate,
    blockFrames: number,
    dsp: CanonicalDsp,
  ): DomainResult<InputMeter> {
    const compiled = compileGraph(meterGraph(layout), BUILT_IN_NODES, rate);
    if (!compiled.ok) {
      return fail(
        failure(
          'capture.meter-unbuilt',
          FailureKind.Unrecoverable,
          compiled.diagnostics.map((diagnostic) => diagnostic.message).join(' '),
        ),
      );
    }
    const channels = channelCount(layout);
    const feed = new QuantumFeed(layout);
    const window = new MeterWindow(channels, neighbouringPairs(channels).length / 2);
    const executor = createExecutor(compiled.plan, BUILT_IN_NODES, {
      sampleRate: rate,
      blockFrames,
      dsp,
      feedFor: (node) => (node === INPUT ? feed : undefined),
      sinkFor: (node) => (node === UNHEARD_OUTPUT ? UNHEARD : undefined),
      meterFor: (node) => (node === LEVEL ? window : undefined),
    });
    return flatMapResult(executor, (made) => succeed(new InputMeter(made, feed, window)));
  }

  /** Measures `frames` frames of `input`, one array per channel. */
  measure(input: readonly Float32Array[], frames: number): void {
    this.#quantumFeed.input = input;
    this.#executor.process(frames);
  }

  /** The levels since the last report, and a new window begun; nothing where no quantum was measured. */
  take(): WindowReport | undefined {
    return this.#window.take();
  }

  release(): void {
    this.#executor.release();
  }
}
