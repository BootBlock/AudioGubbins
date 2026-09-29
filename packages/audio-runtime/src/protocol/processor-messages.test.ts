import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { GRAPH_DESCRIPTOR_VERSION, nodeId, type GraphDescriptor } from '@audiogubbins/audio-graph';
import { BuiltInNodeType, DspImplementation } from '@audiogubbins/audio-engine';

import { createSampleRing } from '../feed/sample-ring.js';
import { dspModuleBytes } from '../testing/dsp-module-bytes.js';
import {
  FeedTransport,
  FromProcessorKind,
  ToProcessorKind,
  readFromProcessor,
  readToProcessor,
  type FromProcessor,
  type ToProcessor,
} from './processor-messages.js';

const IN = expectSuccess(nodeId('in'));
const OUT = expectSuccess(nodeId('out'));
const STEREO = StandardLayouts.stereo;

const GRAPH: GraphDescriptor = {
  version: GRAPH_DESCRIPTOR_VERSION,
  nodes: [
    {
      kind: 'processing',
      id: IN,
      type: BuiltInNodeType.GraphInput,
      inputs: [],
      outputs: [{ name: 'out', layout: STEREO }],
      settings: {},
    },
    {
      kind: 'processing',
      id: OUT,
      type: BuiltInNodeType.Output,
      inputs: [{ name: 'in', layout: STEREO }],
      outputs: [],
      settings: {},
    },
  ],
  edges: [{ from: { node: IN, port: 'out' }, to: { node: OUT, port: 'in' } }],
};

/** One message of every kind the processor is sent. */
function everyToProcessor(): readonly ToProcessor[] {
  return [
    {
      kind: ToProcessorKind.Load,
      graph: GRAPH,
      dspModuleBytes: dspModuleBytes(),
      dspUnavailable: undefined,
      feeds: [
        { node: IN, transport: FeedTransport.Posted, channels: 2 },
        {
          node: OUT,
          transport: FeedTransport.SharedRing,
          channels: 2,
          ring: expectSuccess(createSampleRing(2, 64)),
        },
      ],
      meterEveryBlocks: 8,
    },
    {
      kind: ToProcessorKind.Load,
      graph: GRAPH,
      dspModuleBytes: undefined,
      dspUnavailable: 'WebAssembly is switched off.',
      feeds: [],
      meterEveryBlocks: 0,
    },
    {
      kind: ToProcessorKind.FeedBlock,
      node: IN,
      channels: [Float32Array.of(0.5, -0.25), Float32Array.of(1, 0)],
    },
    { kind: ToProcessorKind.FeedEnd, node: IN },
    { kind: ToProcessorKind.Start, run: 3 },
    { kind: ToProcessorKind.Halt },
    { kind: ToProcessorKind.Reset },
    { kind: ToProcessorKind.SetParameter, node: IN, name: 'gain', value: -0.5 },
  ];
}

/** One message of every kind the processor sends. */
const EVERY_FROM_PROCESSOR: readonly FromProcessor[] = [
  {
    kind: FromProcessorKind.Loaded,
    dsp: DspImplementation.WebAssembly,
    dspFallbackReason: undefined,
    latencyFrames: 256,
  },
  {
    kind: FromProcessorKind.Loaded,
    dsp: DspImplementation.Reference,
    dspFallbackReason: 'No compiled DSP module was provided.',
    latencyFrames: undefined,
  },
  { kind: FromProcessorKind.Refused, reasons: ['One.', 'Two.'] },
  { kind: FromProcessorKind.Started, run: 3, contextFrame: 1_280 },
  { kind: FromProcessorKind.Underrun, run: 3, contextFrame: 1_408, frames: 28 },
  { kind: FromProcessorKind.FeedsEnded, run: 3, contextFrame: 9_000 },
  {
    kind: FromProcessorKind.ParameterRefused,
    node: OUT,
    name: 'gain',
    failures: [{ code: 'node.parameter-unknown', summary: 'No such parameter.' }],
  },
  { kind: FromProcessorKind.Meter, node: OUT, peak: [0.5, 0.25], rms: [0.1, 0.05] },
  { kind: FromProcessorKind.Fault, message: 'Processing stopped.' },
];

/**
 * A message with its sample arrays and bytes as lists of numbers. jsdom's
 * clone makes a typed array of its own realm, which the reader accepts by its
 * tag and Vitest's equality refuses by its prototype, so the values are
 * compared.
 */
function comparable(message: ToProcessor): unknown {
  switch (message.kind) {
    case ToProcessorKind.FeedBlock:
      return { ...message, channels: message.channels.map((channel) => Array.from(channel)) };
    case ToProcessorKind.Load:
      return {
        ...message,
        dspModuleBytes:
          message.dspModuleBytes === undefined ? undefined : Array.from(message.dspModuleBytes),
      };
    default:
      return message;
  }
}

/** The summary a malformed message is refused with. */
function refusal(result: ReturnType<typeof readToProcessor | typeof readFromProcessor>): string {
  if (result.ok) throw new Error('The message was read, and should have been refused.');
  return result.failures[0].summary;
}

describe('the processor protocol', () => {
  it.each(everyToProcessor().map((message) => [message.kind, message] as const))(
    'reads a %s message sent to the processor as it was sent, after a structured clone',
    (_kind, message) => {
      expect(comparable(expectSuccess(readToProcessor(structuredClone(message))))).toEqual(
        comparable(message),
      );
    },
  );

  it.each(EVERY_FROM_PROCESSOR.map((message) => [message.kind, message] as const))(
    'reads a %s message from the processor as it was sent, after a structured clone',
    (_kind, message) => {
      expect(expectSuccess(readFromProcessor(structuredClone(message)))).toEqual(message);
    },
  );

  it('keeps a shared ring shared, and the DSP module’s bytes whole, across a structured clone', () => {
    const [load] = everyToProcessor();
    const read = expectSuccess(readToProcessor(structuredClone(load)));
    if (read.kind !== ToProcessorKind.Load) throw new Error('A load was sent.');
    const ring = read.feeds[1];
    expect(ring?.transport === FeedTransport.SharedRing && ring.ring).toBeInstanceOf(
      SharedArrayBuffer,
    );
    expect(Array.from(read.dspModuleBytes ?? [])).toEqual(Array.from(dspModuleBytes()));
  });

  it.each([
    ['no kind', {}, 'kind'],
    ['an unknown kind', { kind: 'play' }, 'kind'],
    ['a feed block of numbers', { kind: 'feed-block', node: 'in', channels: [[0.5]] }, 'channels'],
    ['a malformed node', { kind: 'feed-end', node: '' }, 'node'],
    ['a start without its run', { kind: 'start' }, 'run'],
    ['a start of a fractional run', { kind: 'start', run: 1.5 }, 'run'],
    [
      'a parameter of text',
      { kind: 'set-parameter', node: 'in', name: 'gain', value: '1' },
      'value',
    ],
    [
      'a ring that is not shared',
      {
        kind: 'load',
        graph: GRAPH,
        feeds: [{ node: 'in', transport: 'shared-ring', channels: 2, ring: new ArrayBuffer(8) }],
        meterEveryBlocks: 1,
      },
      'ring',
    ],
    [
      'an unknown transport',
      {
        kind: 'load',
        graph: GRAPH,
        feeds: [{ node: 'in', transport: 'carrier-pigeon', channels: 2 }],
        meterEveryBlocks: 1,
      },
      'transport',
    ],
    [
      'module bytes that are not bytes',
      { kind: 'load', graph: GRAPH, dspModuleBytes: [0, 97], feeds: [], meterEveryBlocks: 1 },
      'dspModuleBytes',
    ],
    ['no graph', { kind: 'load', feeds: [], meterEveryBlocks: 1 }, 'graph'],
    [
      'a fractional meter rate',
      { kind: 'load', graph: GRAPH, feeds: [], meterEveryBlocks: 1.5 },
      'meterEveryBlocks',
    ],
    ['not an object', 'start', 'body'],
  ])('refuses a message to the processor with %s, naming the field', (_case, value, field) => {
    const read = readToProcessor(value);
    expect(expectFailureCode(read)).toBe('protocol.processor-message-malformed');
    expect(refusal(read)).toContain(`message's ${field} is not`);
  });

  it.each([
    ['a negative frame count', { kind: 'underrun', run: 1, contextFrame: 0, frames: -1 }, 'frames'],
    [
      'a meter reading that is not a number',
      { kind: 'meter', node: 'out', peak: [Number.NaN], rms: [] },
      'peak',
    ],
    ['reasons that are not text', { kind: 'refused', reasons: [1] }, 'reasons'],
    ['an unknown implementation', { kind: 'loaded', dsp: 'gpu' }, 'dsp'],
    ['a fractional start', { kind: 'started', run: 1, contextFrame: 0.5 }, 'contextFrame'],
    ['a start without its run', { kind: 'started', contextFrame: 0 }, 'run'],
    ['an end without its run', { kind: 'feeds-ended', contextFrame: 0 }, 'run'],
    [
      'a parameter refused for no reason',
      { kind: 'parameter-refused', node: 'x', name: 'gain', failures: [] },
      'failures',
    ],
    [
      'a parameter refusal without a summary',
      { kind: 'parameter-refused', node: 'x', name: 'gain', failures: [{ code: 'c' }] },
      'summary',
    ],
  ])('refuses a message from the processor with %s, naming the field', (_case, value, field) => {
    const read = readFromProcessor(value);
    expect(expectFailureCode(read)).toBe('protocol.processor-reply-malformed');
    expect(refusal(read)).toContain(`message's ${field} is not`);
  });
});
