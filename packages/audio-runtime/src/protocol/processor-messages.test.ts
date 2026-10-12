import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { GRAPH_DESCRIPTOR_VERSION, nodeId, type GraphDescriptor } from '@audiogubbins/audio-graph';
import { BuiltInNodeType, DspImplementation, DspDeliveryKind } from '@audiogubbins/audio-engine';
import { dspModuleBytes } from '@audiogubbins/audio-engine/testing';

import { createSampleRing } from '../feed/sample-ring.js';
import { crossingThreads } from '@audiogubbins/domain/testing';
import { FakeMessagePort } from '../testing/fake-message-channel.js';
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

/** A load's word that it carries no module, for the refusals of its other fields. */
const NO_DSP = { kind: DspDeliveryKind.Unavailable, reason: 'None, in this test.' };

/** One message of every kind the processor is sent. */
function everyToProcessor(): readonly ToProcessor[] {
  return [
    {
      kind: ToProcessorKind.Load,
      graph: GRAPH,
      dsp: { kind: DspDeliveryKind.Available, module: dspModuleBytes() },
      feeds: [
        { node: IN, transport: FeedTransport.Posted, channels: 2 },
        {
          node: OUT,
          transport: FeedTransport.SharedRing,
          channels: 2,
          ring: expectSuccess(createSampleRing(2, 64)),
        },
      ],
      reportEveryBlocks: 8,
      feeder: FakeMessagePort.pair().port2,
    },
    {
      kind: ToProcessorKind.Load,
      graph: GRAPH,
      dsp: { kind: DspDeliveryKind.Unavailable, reason: 'WebAssembly is switched off.' },
      feeds: [],
      reportEveryBlocks: 0,
      feeder: undefined,
    },
    { kind: ToProcessorKind.Start, run: 3, epoch: 2, from: 48_000 },
    { kind: ToProcessorKind.Halt },
    { kind: ToProcessorKind.SetParameter, node: IN, name: 'gain', value: -0.5 },
  ];
}

/** One message of every kind the processor sends. */
const EVERY_FROM_PROCESSOR: readonly FromProcessor[] = [
  {
    kind: FromProcessorKind.Loaded,
    dsp: DspImplementation.WebAssembly,
    dspFallbackReason: undefined,
    dspInUse: true,
    latencyFrames: 256,
  },
  {
    kind: FromProcessorKind.Loaded,
    dsp: DspImplementation.Reference,
    dspFallbackReason: 'No compiled DSP module was provided.',
    dspInUse: false,
    latencyFrames: undefined,
  },
  { kind: FromProcessorKind.Refused, reasons: ['One.', 'Two.'] },
  { kind: FromProcessorKind.Started, run: 3, contextFrame: 1_280, position: 4_800 },
  {
    kind: FromProcessorKind.Report,
    run: 3,
    contextFrame: 1_408,
    position: 4_928,
    underrunFrames: 256,
    underruns: 2,
    meters: [{ node: OUT, peak: [0.5, 0.25], rms: [0.1, 0.05], correlation: [-0.5] }],
  },
  { kind: FromProcessorKind.Halted, run: 3, contextFrame: 2_048, position: 5_568 },
  { kind: FromProcessorKind.FeedsEnded, run: 3, contextFrame: 9_000, position: 12_000 },
  {
    kind: FromProcessorKind.ParameterRefused,
    node: OUT,
    name: 'gain',
    failures: [{ code: 'node.parameter-unknown', summary: 'No such parameter.' }],
  },
  { kind: FromProcessorKind.Fault, message: 'Processing stopped.' },
];

/**
 * A message with its bytes as a list of numbers. jsdom's clone makes a typed
 * array of its own realm, which the reader accepts by its tag and Vitest's
 * equality refuses by its prototype, so the values are compared.
 */
function comparable(message: ToProcessor): unknown {
  return message.kind === ToProcessorKind.Load
    ? {
        ...message,
        dsp:
          message.dsp.kind === DspDeliveryKind.Available
            ? { ...message.dsp, module: Array.from(message.dsp.module) }
            : message.dsp,
      }
    : message;
}

/** A message as it arrives, the feeder's end of the channel transferred with it. */
function crossed(message: ToProcessor): unknown {
  const transfer =
    message.kind === ToProcessorKind.Load && message.feeder !== undefined ? [message.feeder] : [];
  return crossingThreads(message, transfer);
}

/** The summary a malformed message is refused with. */
function refusal(result: ReturnType<typeof readToProcessor | typeof readFromProcessor>): string {
  if (result.ok) throw new Error('The message was read, and should have been refused.');
  return result.failures[0].summary;
}

/** A report whose fields are as given, over one that reads. */
function report(fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    kind: 'report',
    run: 1,
    contextFrame: 0,
    position: 0,
    underrunFrames: 0,
    underruns: 0,
    meters: [],
    ...fields,
  };
}

describe('the processor protocol', () => {
  it.each(everyToProcessor().map((message) => [message.kind, message] as const))(
    'reads a %s message sent to the processor as it was sent, after a structured clone',
    (_kind, message) => {
      expect(comparable(expectSuccess(readToProcessor(crossed(message))))).toEqual(
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
    if (load === undefined) throw new Error('A load is the first message.');
    const read = expectSuccess(readToProcessor(crossed(load)));
    if (read.kind !== ToProcessorKind.Load) throw new Error('A load was sent.');
    const ring = read.feeds[1];
    expect(ring?.transport === FeedTransport.SharedRing && ring.ring).toBeInstanceOf(
      SharedArrayBuffer,
    );
    const bytes = read.dsp.kind === DspDeliveryKind.Available ? read.dsp.module : [];
    expect(Array.from(bytes)).toEqual(Array.from(dspModuleBytes()));
  });

  it.each([
    ['no kind', {}, 'kind'],
    ['an unknown kind', { kind: 'play' }, 'kind'],
    ['audio, which the feeder sends on a channel of its own', { kind: 'feed-block' }, 'kind'],
    ['a malformed node', { kind: 'set-parameter', node: '', name: 'gain', value: 1 }, 'node'],
    ['a start without its run', { kind: 'start' }, 'run'],
    ['a start of a fractional run', { kind: 'start', run: 1.5, epoch: 1, from: 0 }, 'run'],
    ['a start without its epoch', { kind: 'start', run: 1, from: 0 }, 'epoch'],
    ['a start from a negative frame', { kind: 'start', run: 1, epoch: 1, from: -1 }, 'from'],
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
        dsp: NO_DSP,
        feeds: [{ node: 'in', transport: 'shared-ring', channels: 2, ring: new ArrayBuffer(8) }],
        reportEveryBlocks: 1,
      },
      'ring',
    ],
    [
      'an unknown transport',
      {
        kind: 'load',
        graph: GRAPH,
        dsp: NO_DSP,
        feeds: [{ node: 'in', transport: 'carrier-pigeon', channels: 2 }],
        reportEveryBlocks: 1,
      },
      'transport',
    ],
    ['no word on the DSP module', { kind: 'load', graph: GRAPH, feeds: [] }, 'dsp'],
    [
      'bytes and no word that they are available',
      { kind: 'load', graph: GRAPH, dsp: { module: new Uint8Array(8) }, feeds: [] },
      'dsp.kind',
    ],
    [
      'module bytes over shared memory, which WebAssembly does not compile from',
      {
        kind: 'load',
        graph: GRAPH,
        dsp: { kind: 'available', module: new Uint8Array(new SharedArrayBuffer(8)) },
        feeds: [],
      },
      'dsp.module',
    ],
    [
      'module bytes that are not bytes',
      {
        kind: 'load',
        graph: GRAPH,
        dsp: { kind: 'available', module: [0, 97] },
        feeds: [],
        reportEveryBlocks: 1,
      },
      'dsp.module',
    ],
    ['no graph', { kind: 'load', dsp: NO_DSP, feeds: [], reportEveryBlocks: 1 }, 'graph'],
    [
      'a fractional report rate',
      { kind: 'load', graph: GRAPH, dsp: NO_DSP, feeds: [], reportEveryBlocks: 1.5 },
      'reportEveryBlocks',
    ],
    [
      'a feeder that is not the end of a channel',
      { kind: 'load', graph: GRAPH, dsp: NO_DSP, feeds: [], reportEveryBlocks: 1, feeder: {} },
      'feeder',
    ],
    ['not an object', 'start', 'body'],
  ])('refuses a message to the processor with %s, naming the field', (_case, value, field) => {
    const read = readToProcessor(value);
    expect(expectFailureCode(read)).toBe('protocol.processor-message-malformed');
    expect(refusal(read)).toContain(`message's ${field} is not`);
  });

  it.each([
    ['a negative underrun count', report({ underrunFrames: -1 }), 'underrunFrames'],
    [
      'a meter reading that is not a number',
      report({ meters: [{ node: 'out', peak: [Number.NaN], rms: [], correlation: [] }] }),
      'peak',
    ],
    [
      'a meter without its correlation',
      report({ meters: [{ node: 'out', peak: [], rms: [] }] }),
      'correlation',
    ],
    ['meters that are not a list', report({ meters: {} }), 'meters'],
    ['a halt without its count', { kind: 'halted', run: 1, contextFrame: 0 }, 'position'],
    [
      'a load that does not say whether its DSP is used',
      { kind: 'loaded', dsp: 'reference' },
      'dspInUse',
    ],
    ['reasons that are not text', { kind: 'refused', reasons: [1] }, 'reasons'],
    ['an unknown implementation', { kind: 'loaded', dsp: 'gpu' }, 'dsp'],
    [
      'a fractional start',
      { kind: 'started', run: 1, contextFrame: 0.5, position: 0 },
      'contextFrame',
    ],
    ['a start without its run', { kind: 'started', contextFrame: 0, position: 0 }, 'run'],
    ['an end without its run', { kind: 'feeds-ended', contextFrame: 0, position: 0 }, 'run'],
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
