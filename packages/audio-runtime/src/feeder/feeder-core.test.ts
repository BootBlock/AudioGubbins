import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleCount, sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { NodeId } from '@audiogubbins/audio-graph';
import {
  BuiltInNodeType,
  DspImplementation,
  REFERENCE_DSP,
  allocateBlock,
  type PcmSource,
} from '@audiogubbins/audio-engine';

import { scopeDsp } from '../dsp/dsp-instance.js';
import { RingReader, createSampleRing } from '../feed/sample-ring.js';
import {
  FromFeederKind,
  ToFeederKind,
  type FromFeeder,
  type ToFeeder,
} from '../protocol/feeder-messages.js';
import {
  FromProcessorFeedKind,
  ToProcessorFeedKind,
  readToProcessorFeed,
  type ToProcessorFeed,
} from '../protocol/feed-messages.js';
import { FeedTransport } from '../protocol/processor-messages.js';
import { SourceKind, type SourceDescription } from '../protocol/source-descriptions.js';
import { countingDsp } from '../testing/counting-dsp.js';
import { dspModuleBytes } from '../testing/dsp-module-bytes.js';
import { FakeMessagePort } from '../testing/fake-message-channel.js';
import { FakeSchedule, settle } from '../testing/playback-rig.js';
import { graphOf, named, nodeOf, wire } from '../testing/render-graphs.js';
import { FeederCore } from './feeder-core.js';
import type { DspChooser } from './feeder-sources.js';

const STEREO = StandardLayouts.stereo;
const RATE = expectSuccess(sampleRate(48_000));
const IN = named('in');

const GRAPH = graphOf(
  [
    nodeOf('in', BuiltInNodeType.GraphInput, STEREO, { outputs: ['out'] }),
    nodeOf('out', BuiltInNodeType.Output, STEREO, { inputs: ['in'] }),
  ],
  [wire('in.out', 'out.in')],
);

function tone(frames: number, amplitude = 0.5): SourceDescription {
  return {
    node: IN,
    kind: SourceKind.Tone,
    sampleRate: RATE,
    frequency: 440,
    amplitude,
    frames: expectSuccess(sampleCount(frames)),
  };
}

function recorded(frames: number): SourceDescription {
  return {
    node: IN,
    kind: SourceKind.Pcm,
    sampleRate: RATE,
    channels: [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(-0.25)],
  };
}

function sources(
  request: number,
  described: SourceDescription,
  module?: WebAssembly.Module,
): ToFeeder {
  return {
    kind: ToFeederKind.Sources,
    request,
    graph: GRAPH,
    sources: [described],
    dspModule: module,
    dspUnavailable: module === undefined ? 'No module in this test.' : undefined,
  };
}

/** A binding of request `request` to a posted feed, or a ring where given one. */
function bind(request: number, ring?: SharedArrayBuffer): ToFeeder {
  return {
    kind: ToFeederKind.Bind,
    request,
    feeds: [
      ring === undefined
        ? { node: IN, transport: FeedTransport.Posted }
        : { node: IN, transport: FeedTransport.SharedRing, ring },
    ],
    feedAheadMilliseconds: 10,
    chunkFrames: 128,
    wakeMilliseconds: 2,
    // The core only hands the port to its host, which this test plays.
    processor: FakeMessagePort.pair().port1,
  };
}

/** A feeder, what it said to the main thread, and what it sent the processor. */
function feeder(
  chooseDsp: DspChooser = scopeDsp,
  readThrough?: (node: NodeId, source: PcmSource) => PcmSource,
): {
  core: FeederCore;
  said: FromFeeder[];
  toProcessor: ToProcessorFeed[];
  schedule: FakeSchedule;
} {
  const said: FromFeeder[] = [];
  const toProcessor: ToProcessorFeed[] = [];
  const schedule = new FakeSchedule();
  const core = new FeederCore({
    post: (message) => {
      said.push(message);
    },
    connectProcessor: (port) => {
      port?.close();
    },
    postToProcessor: (message) => {
      // Read back, as the processor reads it, so a message the reader refuses fails here.
      toProcessor.push(expectSuccess(readToProcessorFeed(message)));
    },
    schedule: schedule.schedule,
    chooseDsp,
    ...(readThrough === undefined ? {} : { readThrough }),
  });
  return { core, said, toProcessor, schedule };
}

const kinds = (messages: readonly ToProcessorFeed[]): readonly string[] =>
  messages.map((message) => message.kind);

describe('the feeder', () => {
  it('makes a tone on the WebAssembly module it was sent, and says a source uses it', () => {
    const { core, said } = feeder();

    core.receive(sources(1, tone(480), new WebAssembly.Module(dspModuleBytes())));

    expect(said).toEqual([
      {
        kind: FromFeederKind.SourcesMade,
        request: 1,
        dsp: DspImplementation.WebAssembly,
        dspFallbackReason: undefined,
        dspInUse: true,
      },
    ]);
  });

  it('says recorded audio uses no DSP, and why it would run the reference path', () => {
    const { core, said } = feeder();

    core.receive(sources(1, recorded(256)));

    expect(said).toEqual([
      {
        kind: FromFeederKind.SourcesMade,
        request: 1,
        dsp: DspImplementation.Reference,
        dspFallbackReason: 'No module in this test.',
        dspInUse: false,
      },
    ]);
  });

  it('refuses sources it cannot make, with each failure’s code and summary', () => {
    const { core, said } = feeder();

    core.receive(sources(1, tone(480, 2)));

    expect(said).toEqual([
      {
        kind: FromFeederKind.SourcesRefused,
        request: 1,
        failures: [
          {
            code: 'pcm.tone-amplitude-out-of-range',
            summary: 'A test tone peaks between silence and full scale.',
          },
        ],
      },
    ]);
  });

  it('rewinds before any audio, feeds a posted feed up to its time ahead, and says it is primed', async () => {
    const { core, said, toProcessor } = feeder();
    core.receive(sources(1, recorded(2_000)));
    core.receive(bind(1));

    core.receive({ kind: ToFeederKind.Start, run: 7, from: 100 });
    await settle();

    // Ten milliseconds at 48 kHz is 480 frames: three chunks of 128.
    expect(kinds(toProcessor)).toEqual([
      ToProcessorFeedKind.Rewind,
      ToProcessorFeedKind.Block,
      ToProcessorFeedKind.Block,
      ToProcessorFeedKind.Block,
    ]);
    expect(toProcessor[0]).toEqual({ kind: ToProcessorFeedKind.Rewind, epoch: 7 });
    expect(said.at(-1)).toEqual({ kind: FromFeederKind.Primed, run: 7 });
  });

  it('feeds more when the processor says it read a block of the current run, and not of an earlier one', async () => {
    const { core, toProcessor } = feeder();
    core.receive(sources(1, recorded(2_000)));
    core.receive(bind(1));
    core.receive({ kind: ToFeederKind.Start, run: 7, from: 0 });
    await settle();
    const sent = toProcessor.length;

    core.receiveFromProcessor({
      kind: FromProcessorFeedKind.Consumed,
      epoch: 6,
      node: IN,
      frames: 128,
    });
    await settle();
    expect(toProcessor).toHaveLength(sent);

    core.receiveFromProcessor({
      kind: FromProcessorFeedKind.Consumed,
      epoch: 7,
      node: IN,
      frames: 128,
    });
    await settle();
    expect(kinds(toProcessor.slice(sent))).toEqual([ToProcessorFeedKind.Block]);
  });

  it('marks a ring’s old audio before it rewinds, so the processor skips only that', async () => {
    const { core, toProcessor } = feeder();
    const memory = expectSuccess(createSampleRing(2, 1_024));
    const reader = expectSuccess(RingReader.open(memory));
    core.receive(sources(1, recorded(2_000)));
    core.receive(bind(1, memory));
    core.receive({ kind: ToFeederKind.Start, run: 1, from: 0 });
    await settle();
    core.receive({ kind: ToFeederKind.Start, run: 2, from: 1_000 });
    await settle();

    expect(kinds(toProcessor)).toEqual([ToProcessorFeedKind.Rewind, ToProcessorFeedKind.Rewind]);
    // Run 1's 384 frames are behind the mark, and run 2's first chunks after
    // it at once, without waiting for the processor to skip the old.
    reader.clear();
    const into = allocateBlock(STEREO, RATE, 512);
    expect(reader.read(into)).toBe(384);
    expect(into.channels[0]?.[0]).toBe(0.25);
  });

  it('stops feeding when told, leaving no timer behind', async () => {
    const { core, schedule } = feeder();
    core.receive(sources(1, recorded(20_000)));
    core.receive(bind(1));
    core.receive({ kind: ToFeederKind.Start, run: 1, from: 0 });
    await settle();
    expect(schedule.pending).toBe(1);

    core.receive({ kind: ToFeederKind.Stop });

    expect(schedule.pending).toBe(0);
  });

  it('says which source failed while feeding, and in which run', async () => {
    const { core, said } = feeder(scopeDsp, (_node, source) => ({
      ...source,
      read: () => Promise.reject(new Error('The disk went away.')),
    }));
    core.receive(sources(1, recorded(2_000)));
    core.receive(bind(1));

    core.receive({ kind: ToFeederKind.Start, run: 3, from: 0 });
    await settle();

    expect(said.filter((message) => message.kind !== FromFeederKind.SourcesMade)).toEqual([
      { kind: FromFeederKind.FeedFailed, run: 3, node: IN, reason: 'The disk went away.' },
      // A feed whose pump stopped is primed as far as it will ever be.
      { kind: FromFeederKind.Primed, run: 3 },
    ]);
  });

  it('releases a request’s sources, and the DSP memory they hold', () => {
    const counting = countingDsp();
    const { core } = feeder(() => ({ dsp: counting.dsp, fallbackReason: 'Counting.' }));
    core.receive(sources(1, tone(480)));
    expect(counting.held()).toBe(1);

    core.receive({ kind: ToFeederKind.Release, request: 1 });

    expect(counting.held()).toBe(0);
  });

  it('faults on a message it cannot read or receive, and on a binding to sources it does not have', () => {
    const { core, said } = feeder(() => ({ dsp: REFERENCE_DSP, fallbackReason: undefined }));

    core.receive({ kind: 'play' });
    core.messageFailed();
    core.processorMessageFailed();
    core.receive(bind(9));
    core.receiveFromProcessor({ kind: 'consumed' });

    expect(
      said.map((message) => (message.kind === FromFeederKind.Fault ? message.message : '')),
    ).toEqual([
      "A message to the feeder could not be read: The message's kind is not one of sources, bind, start, stop, unbind, release.",
      'A message to the feeder could not be received, so what it feeds is in doubt.',
      'A message from the audio processor could not be received by the feeder, so how much audio it holds is in doubt.',
      'The feeder was bound to request 9, whose sources it does not have.',
      "A message from the audio processor could not be read: The message's epoch is not a finite number.",
    ]);
  });
});
