import { Blob as PlatformBlob } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  AssetOrigin,
  assetPlan,
  derivedSampleCount,
  MAXIMUM_QUALITY,
  sampleRate,
  StandardLayouts,
  unsafeBrandId,
  type Asset,
} from '@audiogubbins/domain';
import {
  PLAN_WITHOUT_CHAINS,
  expectFailureCode,
  expectSuccess,
} from '@audiogubbins/domain/testing';
import { GRAPH_DESCRIPTOR_VERSION, nodeId, type GraphDescriptor } from '@audiogubbins/audio-graph';
import {
  BuiltInNodeType,
  DspImplementation,
  toneRecipe,
  PcmDescriptionKind,
} from '@audiogubbins/audio-engine';
import { dspModuleBytes } from '@audiogubbins/audio-engine/testing';

import { DspDeliveryKind } from '../dsp/dsp-delivery.js';
import { createSampleRing } from '../feed/sample-ring.js';
import { FakeMessagePort, cloneAcross } from '../testing/fake-message-channel.js';
import {
  FromFeederKind,
  ToFeederKind,
  readFromFeeder,
  readToFeeder,
  type FromFeeder,
  type ToFeeder,
} from './feeder-messages.js';
import { FeedTransport } from './processor-messages.js';

const IN = expectSuccess(nodeId('in'));
const OUT = expectSuccess(nodeId('out'));
const STEREO = StandardLayouts.stereo;
const RATE = expectSuccess(sampleRate(48_000));

/** A stereo asset of four frames, whose edited sound a message describes. */
const TAKE: Asset = {
  id: unsafeBrandId<'AssetId'>('0000aaaa-0000-4000-8000-0000000000a1'),
  displayName: 'Take',
  origin: AssetOrigin.Imported,
  sampleRate: RATE,
  channelLayout: StandardLayouts.stereo,
  length: derivedSampleCount(4),
  storageKey: 'content:take',
  edits: [],
};

/**
 * The edited sound of `TAKE`, its file a Blob as the page holds one: the
 * platform's, since jsdom's own does not survive the structured clone a
 * browser's Blob does.
 */
const EDITED = {
  kind: PcmDescriptionKind.Edited,
  sampleRate: RATE,
  plan: expectSuccess(assetPlan(TAKE, PLAN_WITHOUT_CHAINS)),
  media: [
    {
      asset: TAKE.id,
      identity: 'content:take',
      sampleRate: RATE,
      channels: 2,
      length: TAKE.length,
      file: new PlatformBlob([new Uint8Array(16)]),
    },
  ],
} as const;

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

/** One message of every kind the feeder is sent. */
function everyToFeeder(): readonly ToFeeder[] {
  return [
    {
      kind: ToFeederKind.Sources,
      quality: MAXIMUM_QUALITY,
      request: 2,
      graph: GRAPH,
      sources: [
        {
          node: IN,
          kind: PcmDescriptionKind.Signal,
          sampleRate: RATE,
          recipe: expectSuccess(toneRecipe(2, 48_000, 440, 0.25)),
        },
      ],
      dsp: { kind: DspDeliveryKind.Available, module: new WebAssembly.Module(dspModuleBytes()) },
    },
    {
      kind: ToFeederKind.Sources,
      quality: MAXIMUM_QUALITY,
      request: 3,
      graph: GRAPH,
      sources: [
        {
          node: IN,
          kind: PcmDescriptionKind.Pcm,
          sampleRate: RATE,
          channels: [Float32Array.of(0.5)],
        },
      ],
      dsp: { kind: DspDeliveryKind.Unavailable, reason: 'WebAssembly is switched off.' },
    },
    {
      kind: ToFeederKind.Sources,
      quality: MAXIMUM_QUALITY,
      request: 4,
      graph: GRAPH,
      sources: [{ node: IN, ...EDITED }],
      dsp: { kind: DspDeliveryKind.Unavailable, reason: 'WebAssembly is switched off.' },
    },
    {
      kind: ToFeederKind.Bind,
      request: 2,
      feeds: [
        { node: IN, transport: FeedTransport.Posted },
        {
          node: OUT,
          transport: FeedTransport.SharedRing,
          ring: expectSuccess(createSampleRing(2, 64)),
        },
      ],
      feedAheadMilliseconds: 200,
      chunkFrames: 1_280,
      wakeMilliseconds: 1_280 / 48,
      processor: FakeMessagePort.pair().port1,
    },
    { kind: ToFeederKind.Start, run: 4, from: 12_000 },
    { kind: ToFeederKind.Stop },
    { kind: ToFeederKind.Unbind },
    { kind: ToFeederKind.Release, request: 2 },
    { kind: ToFeederKind.Previews, port: FakeMessagePort.pair().port1 },
    {
      kind: ToFeederKind.Parameters,
      request: 2,
      change: 3,
      changes: [
        {
          processor: unsafeBrandId<'ProcessorId'>('00000000-0e01'),
          parameter: unsafeBrandId<'ParameterId'>('9a1e0001-0001'),
          value: -3.5,
        },
      ],
    },
  ];
}

/** One message of every kind the feeder sends. */
const EVERY_FROM_FEEDER: readonly FromFeeder[] = [
  {
    kind: FromFeederKind.SourcesMade,
    request: 2,
    dsp: DspImplementation.WebAssembly,
    dspFallbackReason: undefined,
    dspInUse: true,
  },
  {
    kind: FromFeederKind.SourcesRefused,
    request: 2,
    failures: [{ code: 'pcm.tone-amplitude-out-of-range', summary: 'Too loud.' }],
  },
  { kind: FromFeederKind.Primed, run: 4 },
  { kind: FromFeederKind.FeedFailed, run: 4, node: IN, reason: 'The disk went away.' },
  { kind: FromFeederKind.Fault, message: 'A message could not be read.' },
  { kind: FromFeederKind.ParametersTaken, change: 3, refusals: [] },
  {
    kind: FromFeederKind.ParametersTaken,
    change: 4,
    refusals: [{ code: 'playback.parameter-rendered', summary: 'Made with the value before.' }],
  },
];

/**
 * A message with its sample arrays as lists of numbers. A structured clone
 * makes a typed array of the test's own realm, which the reader accepts by
 * its tag and Vitest's equality refuses by its prototype, so the values are
 * compared.
 */
function comparable(message: ToFeeder): unknown {
  if (message.kind !== ToFeederKind.Sources) return message;
  return {
    ...message,
    sources: message.sources.map((source) =>
      source.kind === PcmDescriptionKind.Pcm
        ? { ...source, channels: source.channels.map((channel) => Array.from(channel)) }
        : source,
    ),
  };
}

/** A message as it arrives, the processor's end of the channel transferred with it. */
function crossed(message: ToFeeder): unknown {
  return cloneAcross(message, message.kind === ToFeederKind.Bind ? [message.processor] : []);
}

/** The summary a malformed message is refused with. */
function refusal(result: ReturnType<typeof readToFeeder | typeof readFromFeeder>): string {
  if (result.ok) throw new Error('The message was read, and should have been refused.');
  return result.failures[0].summary;
}

describe('the feeder protocol', () => {
  it.each(everyToFeeder().map((message) => [message.kind, message] as const))(
    'reads a %s message sent to the feeder as it was sent, after a structured clone',
    (_kind, message) => {
      expect(comparable(expectSuccess(readToFeeder(crossed(message))))).toEqual(
        comparable(message),
      );
    },
  );

  it.each(EVERY_FROM_FEEDER.map((message) => [message.kind, message] as const))(
    'reads a %s message from the feeder as it was sent, after a structured clone',
    (_kind, message) => {
      expect(expectSuccess(readFromFeeder(structuredClone(message)))).toEqual(message);
    },
  );

  it.each([
    ['no kind', {}, 'kind'],
    ['sources without their graph', { kind: 'sources', request: 1, sources: [] }, 'graph'],
    [
      'a source of an unknown kind',
      { kind: 'sources', request: 1, graph: GRAPH, sources: [{ node: 'in', kind: 'radio' }] },
      'sampleRate',
    ],
    [
      'a module that is not compiled',
      {
        kind: 'sources',
        request: 1,
        graph: GRAPH,
        sources: [],
        quality: MAXIMUM_QUALITY,
        dsp: { kind: 'available', module: [0, 97] },
      },
      'dsp.module',
    ],
    [
      'a preview quality no level offers',
      {
        kind: 'sources',
        request: 1,
        graph: GRAPH,
        sources: [],
        quality: { level: 'maximum', settings: { ...MAXIMUM_QUALITY.settings, oversampling: 3 } },
        dsp: { kind: 'unavailable', reason: 'none' },
      },
      'quality',
    ],
    [
      'a binding without the end of a channel',
      {
        kind: 'bind',
        request: 1,
        feeds: [],
        feedAheadMilliseconds: 200,
        chunkFrames: 128,
        wakeMilliseconds: 1,
      },
      'processor',
    ],
    [
      'a ring that is not shared',
      {
        kind: 'bind',
        request: 1,
        feeds: [{ node: 'in', transport: 'shared-ring', ring: new ArrayBuffer(8) }],
        feedAheadMilliseconds: 200,
        chunkFrames: 128,
        wakeMilliseconds: 1,
        processor: FakeMessagePort.pair().port1,
      },
      'ring',
    ],
    ['a start from a fractional frame', { kind: 'start', run: 1, from: 0.5 }, 'from'],
    ['a release of no request', { kind: 'release' }, 'request'],
    ['not an object', 'stop', 'body'],
  ])('refuses a message to the feeder with %s, naming the field', (_case, value, field) => {
    const read = readToFeeder(value);
    expect(expectFailureCode(read)).toBe('protocol.feeder-message-malformed');
    expect(refusal(read)).toContain(`message's ${field} is not`);
  });

  it.each([
    [
      'sources refused for no reason',
      { kind: 'sources-refused', request: 1, failures: [] },
      'failures',
    ],
    [
      'sources made without saying whether the DSP is used',
      { kind: 'sources-made', request: 1, dsp: 'reference' },
      'dspInUse',
    ],
    ['a primed run of no number', { kind: 'primed' }, 'run'],
    ['a failed feed without its reason', { kind: 'feed-failed', run: 1, node: 'in' }, 'reason'],
  ])('refuses a message from the feeder with %s, naming the field', (_case, value, field) => {
    const read = readFromFeeder(value);
    expect(expectFailureCode(read)).toBe('protocol.feeder-reply-malformed');
    expect(refusal(read)).toContain(`message's ${field} is not`);
  });
});
