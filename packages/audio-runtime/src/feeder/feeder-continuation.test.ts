/**
 * The feeder going on with an edited sound into a plan that continues its own
 * while it feeds (ADR-0104, the phase 10 plan's section 6 gate), its chains
 * run by the effect rack's real processors and its member at another rate by
 * the canonical resampler.
 *
 * The plan is a game preview's shape: an output reading a bus through a delay,
 * the bus an emitter through a filter, the emitter a mix of two lanes, each
 * lane silence around its voices, one voice a member through its own filter
 * and the other a member at 44.1 kHz heard converted. A delay and a filter
 * carry their history into every frame, so any run made afresh is heard, and
 * the test sees every run prepared, and every resampler made, through the
 * processing and the DSP it gives the feeder.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type AssetId,
  type ChainSlot,
  type EditPlan,
  type EffectChain,
  type ParameterValue,
  type PlanSegment,
  type PlanSource,
  type PlanStream,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  BuiltInNodeType,
  PcmDescriptionKind,
  DspDeliveryKind,
  type ChainProcessing,
  type MediaEntry,
} from '@audiogubbins/audio-engine';
import {
  countingDsp,
  graphOf,
  named,
  nodeOf,
  rackedMedia,
  wire,
} from '@audiogubbins/audio-engine/testing';

import {
  FromProcessorFeedKind,
  ToProcessorFeedKind,
  readToProcessorFeed,
  type ToProcessorFeed,
} from '../protocol/feed-messages.js';
import {
  FromFeederKind,
  ToFeederKind,
  type FromFeeder,
  type ToFeeder,
} from '../protocol/feeder-messages.js';
import { FeedTransport } from '../protocol/processor-messages.js';
import type { SourceDescription } from '../protocol/source-descriptions.js';
import { CAPTURE_PROCESSING, catalogueSlot } from '../testing/capture-rig.js';
import { FakeMessagePort } from '../testing/fake-message-channel.js';
import { FakeSchedule, settle } from '../testing/playback-rig.js';
import { FeederCore } from './feeder-core.js';

const MONO = StandardLayouts.mono;
const RATE = expectSuccess(sampleRate(48_000));
const MEMBER_RATE = expectSuccess(sampleRate(44_100));
const IN = named('in');
const HORIZON = 8_192;
const LONGER = 12_288;
/** Forty milliseconds ahead in chunks of 512 frames: 1,920 frames, four chunks, queued at most. */
const AHEAD_MILLISECONDS = 40;
const CHUNK = 512;

const ASSET_A = unsafeBrandId<'AssetId'>('0000feed-000a');
const ASSET_B = unsafeBrandId<'AssetId'>('0000feed-000b');

const GRAPH = graphOf(
  [
    nodeOf('in', BuiltInNodeType.GraphInput, MONO, { outputs: ['out'] }),
    nodeOf('out', BuiltInNodeType.Output, MONO, { inputs: ['in'] }),
  ],
  [wire('in.out', 'out.in')],
);

/** Noise from a seed, so every frame of every stream differs. */
function noise(seed: number, frames: number): Float32Array {
  let state = seed;
  return Float32Array.from({ length: frames }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return Math.fround(state / 2 ** 32 - 0.5);
  });
}

function member(asset: AssetId, rate: SampleRate, seed: number): MediaEntry {
  return { ...rackedMedia([noise(seed, 6_000)], rate, `memory:${asset}`), asset };
}

const MEDIA: readonly MediaEntry[] = [member(ASSET_A, RATE, 1), member(ASSET_B, MEMBER_RATE, 2)];

const ids = createDeterministicIdGenerator(1_004);

/** One processor of the catalogue's `typeKey`, with `values` by parameter key, mixed `mix` with its input. */
function processor(
  typeKey: string,
  values: Readonly<Record<string, ParameterValue>>,
  mix = 1,
): ChainSlot {
  return { ...catalogueSlot(ids, typeKey, values), mix };
}

function chainOf(slot: ChainSlot): EffectChain {
  return { id: ids.next(), slots: [slot] };
}

const BUS = chainOf(processor('delay', { time: 20, feedback: 50 }, 0.5));
const EMITTER = chainOf(processor('filter', { cutoff: 2_000 }));
const MEMBER = chainOf(processor('filter', { cutoff: 600 }));

function segment(source: PlanSource, start: number, length: number): PlanSegment {
  return {
    source,
    start: derivedSampleCount(start),
    length: derivedSampleCount(length),
    reversed: false,
    stages: [],
  };
}

/** A voice: `length` frames of `source` from `start`, at half its level. */
function voice(source: PlanSource, start: number, length: number): PlanSegment {
  return {
    ...segment(source, start, length),
    stages: [
      { kind: 'gain', from: start, to: start + length, gain: { kind: 'constant', gain: 0.5 } },
    ],
  };
}

/** A lane of voices, each at its frame, with silence between them and to `horizon`. */
function lane(
  voices: readonly { readonly at: number; readonly segment: PlanSegment }[],
  horizon: number,
): PlanStream {
  const segments: PlanSegment[] = [];
  let position = 0;
  for (const one of voices) {
    if (one.at > position)
      segments.push(segment({ kind: 'silence', channels: 1 }, 0, one.at - position));
    segments.push(one.segment);
    position = one.at + one.segment.length;
  }
  if (horizon > position)
    segments.push(segment({ kind: 'silence', channels: 1 }, 0, horizon - position));
  return { sampleRate: RATE, layout: MONO, segments };
}

/**
 * The preview-shaped plan to `horizon`: 0 the output, 1 the bus, 2 the
 * emitter, 3 and 4 its lanes, 5 member A through its filter, 6 member B at
 * 44.1 kHz, heard converted. Lane 3 sounds member A from 512 to 4,512 and
 * lane 4 member B from 1,024 to 4,024, each with the voices `extra` adds.
 */
function programme(
  horizon: number,
  extra: {
    readonly lane4?: readonly { readonly at: number; readonly segment: PlanSegment }[];
  } = {},
  emitter: EffectChain = EMITTER,
): EditPlan {
  const through = (chain: EffectChain) => ({ kind: 'chain' as const, chain, input: MONO });
  return {
    streams: [
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [segment({ kind: 'stream', stream: 1 }, 0, horizon)],
      },
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [segment({ kind: 'stream', stream: 2 }, 0, horizon)],
        processing: through(BUS),
      },
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [segment({ kind: 'mix', streams: [3, 4] }, 0, horizon)],
        processing: through(emitter),
      },
      lane([{ at: 512, segment: voice({ kind: 'stream', stream: 5 }, 0, 4_000) }], horizon),
      lane(
        [
          { at: 1_024, segment: voice({ kind: 'stream', stream: 6 }, 0, 3_000) },
          ...(extra.lane4 ?? []),
        ],
        horizon,
      ),
      {
        sampleRate: RATE,
        layout: MONO,
        segments: [segment({ kind: 'media', asset: ASSET_A }, 0, 6_000)],
        processing: through(MEMBER),
      },
      {
        sampleRate: MEMBER_RATE,
        layout: MONO,
        segments: [segment({ kind: 'media', asset: ASSET_B }, 0, 6_000)],
      },
    ],
  };
}

/** A voice of member A's file, sharing no stream, at `at`. */
function fileVoice(at: number): { readonly at: number; readonly segment: PlanSegment } {
  return { at, segment: voice({ kind: 'media', asset: ASSET_A }, 100, 1_500) };
}

function edited(plan: EditPlan): SourceDescription {
  return { node: IN, kind: PcmDescriptionKind.Edited, sampleRate: RATE, plan, media: MEDIA };
}

/** A feeder playing `plan`, bound to a posted feed and started from frame 0. */
function feeding(plan: EditPlan) {
  const said: FromFeeder[] = [];
  const blocks: Float32Array[] = [];
  let ended = false;
  const prepared: string[] = [];
  // The effect rack over the whole catalogue, as a thread's module makes it.
  const rack = CAPTURE_PROCESSING;
  const processing: ChainProcessing = {
    ...rack,
    prepare: (request, read, signal) => {
      prepared.push(`${request.chain.id}@${String(request.start)}`);
      return rack.prepare(request, read, signal);
    },
  };
  const dsp = countingDsp();
  const schedule = new FakeSchedule();
  const core = new FeederCore({
    post: (message) => {
      said.push(message);
    },
    connectProcessor: (port) => {
      port?.close();
    },
    postToProcessor: (message) => {
      const read: ToProcessorFeed = expectSuccess(readToProcessorFeed(message));
      if (read.kind === ToProcessorFeedKind.Block)
        blocks.push(Float32Array.from(read.channels[0] ?? []));
      if (read.kind === ToProcessorFeedKind.End) ended = true;
    },
    schedule: schedule.schedule,
    chooseDsp: () => ({ dsp: dsp.dsp, fallbackReason: 'Counting.' }),
    processing,
  });
  const send = (message: ToFeeder): void => {
    core.receive(message);
  };
  send({
    kind: ToFeederKind.Sources,
    request: 1,
    graph: GRAPH,
    sources: [edited(plan)],
    quality: MAXIMUM_QUALITY,
    dsp: { kind: DspDeliveryKind.Unavailable, reason: 'The reference path, counted.' },
  });
  send({
    kind: ToFeederKind.Bind,
    request: 1,
    feeds: [{ node: IN, transport: FeedTransport.Posted }],
    feedAheadMilliseconds: AHEAD_MILLISECONDS,
    chunkFrames: CHUNK,
    wakeMilliseconds: 2,
    processor: FakeMessagePort.pair().port1,
  });
  send({ kind: ToFeederKind.Start, run: 1, from: 0 });
  let acknowledged = 0;
  /** Every frame the feeder has sent so far. */
  const sent = (): number => blocks.reduce((frames, block) => frames + block.length, 0);
  /** Plays the blocks sent, one at a time, until at least `frames` frames were sent or the feed ended. */
  const play = async (frames: number): Promise<void> => {
    await settle();
    while (sent() < frames && !ended) {
      const block = blocks[acknowledged];
      if (block === undefined) throw new Error('The feeder stopped sending before it ended.');
      acknowledged += 1;
      core.receiveFromProcessor({
        kind: FromProcessorFeedKind.Consumed,
        epoch: 1,
        node: IN,
        frames: block.length,
      });
      await settle();
    }
  };
  const heard = (): number[] => blocks.flatMap((block) => [...block]);
  return { send, said, play, sent, heard, prepared, resamplers: dsp.made, ended: () => ended };
}

/** What a feeder playing `plan` from its start to its end sends. */
async function uninterrupted(plan: EditPlan): Promise<number[]> {
  const alone = feeding(plan);
  await alone.play(Number.POSITIVE_INFINITY);
  return alone.heard();
}

function continuation(
  plan: EditPlan,
  from: number,
  continuationId = 1,
): Extract<ToFeeder, { readonly kind: typeof ToFeederKind.Continue }> {
  return {
    kind: ToFeederKind.Continue,
    request: 1,
    continuation: continuationId,
    from,
    sources: [edited(plan)],
  };
}

/** The feeder playing `before` to 3,000 frames sent, continued with `after` allowed from `from`, then played to the end. */
async function continued(before: EditPlan, after: EditPlan, from: number) {
  const playing = feeding(before);
  await playing.play(3_000);
  const switchedAt = playing.sent();
  const preparedBefore = [...playing.prepared];
  const resamplersBefore = playing.resamplers();
  playing.send(continuation(after, from));
  await settle();
  const answer = playing.said.at(-1);
  await playing.play(Number.POSITIVE_INFINITY);
  return { answer, switchedAt, heard: playing.heard(), preparedBefore, resamplersBefore, playing };
}

const OLD = programme(HORIZON);

describe('the feeder going on into a continued plan while it feeds (the gate)', () => {
  it('(a) feeds the old plan to its horizon, bit for bit, when the new one differs only after it', async () => {
    const longer = programme(LONGER, { lane4: [fileVoice(9_000)] });

    const run = await continued(OLD, longer, HORIZON);

    expect(run.answer).toEqual({
      kind: FromFeederKind.Continued,
      continuation: 1,
      frame: run.switchedAt,
    });
    const old = await uninterrupted(OLD);
    expect(run.heard.slice(run.switchedAt, HORIZON)).toEqual(old.slice(run.switchedAt, HORIZON));
    expect(run.heard).toEqual(await uninterrupted(longer));
    expect(run.playing.ended()).toBe(true);
  });

  it('(b) feeds the old plan, bit for bit, up to a voice added after the frame it went on from', async () => {
    const added = 6_000;
    const voiced = programme(HORIZON, { lane4: [fileVoice(added)] });

    const run = await continued(OLD, voiced, added);

    expect(run.answer).toMatchObject({ kind: FromFeederKind.Continued, frame: run.switchedAt });
    const old = await uninterrupted(OLD);
    expect(run.heard.slice(run.switchedAt, added)).toEqual(old.slice(run.switchedAt, added));
    expect(run.heard.slice(added)).not.toEqual(old.slice(added));
    expect(run.heard).toEqual(await uninterrupted(voiced));
  });

  it('(c) keeps every sounding voice’s filter and resampler, and the filter and delay over them', async () => {
    const run = await continued(OLD, programme(LONGER, { lane4: [fileVoice(6_000)] }), 6_000);

    expect(run.preparedBefore).toEqual([`${BUS.id}@0`, `${EMITTER.id}@0`, `${MEMBER.id}@0`]);
    expect(run.playing.prepared).toEqual(run.preparedBefore);
    expect(run.resamplersBefore).toBe(1);
    expect(run.playing.resamplers()).toBe(1);
  });
});

describe('the feeder refusing a continuation', () => {
  it('refuses one allowed only from a frame it has read past, saying the frame, and feeds on unchanged', async () => {
    const playing = feeding(OLD);
    await playing.play(3_000);
    const reached = playing.sent();

    playing.send(
      continuation(programme(HORIZON, { lane4: [fileVoice(reached - 1)] }), reached - 1),
    );
    await settle();
    const answer = playing.said.at(-1);
    await playing.play(Number.POSITIVE_INFINITY);

    expect(answer).toMatchObject({
      kind: FromFeederKind.ContinuationRefused,
      continuation: 1,
      frame: reached,
      failures: [{ code: 'playback.continuation-too-late' }],
    });
    expect(playing.heard()).toEqual(await uninterrupted(OLD));
  });

  it('refuses one after the feed has ended, which only a load goes on from', async () => {
    const playing = feeding(OLD);
    await playing.play(Number.POSITIVE_INFINITY);

    playing.send(continuation(programme(LONGER), HORIZON));
    await settle();

    expect(playing.said.at(-1)).toMatchObject({
      kind: FromFeederKind.ContinuationRefused,
      frame: HORIZON,
      failures: [{ code: 'playback.continuation-ended' }],
    });
  });

  it('refuses one for a request it does not hold, and one for audio that is not an edited sound', async () => {
    const playing = feeding(OLD);
    await playing.play(1_000);

    playing.send({ ...continuation(OLD, HORIZON, 2), request: 9 });
    playing.send({
      ...continuation(OLD, HORIZON, 3),
      sources: [
        {
          node: IN,
          kind: PcmDescriptionKind.Pcm,
          sampleRate: RATE,
          channels: [new Float32Array(8)],
        },
      ],
    });
    await settle();

    expect(playing.said.slice(-2)).toMatchObject([
      {
        kind: FromFeederKind.ContinuationRefused,
        continuation: 2,
        failures: [{ code: 'playback.continuation-unloaded' }],
      },
      {
        kind: FromFeederKind.ContinuationRefused,
        continuation: 3,
        failures: [{ code: 'playback.continuation-unmatched' }],
      },
    ]);
  });

  it('refuses one whose request was released while it waited for its sources, taking nothing', async () => {
    const playing = feeding(OLD);
    await playing.play(1_000);

    playing.send(continuation(programme(LONGER), HORIZON));
    playing.send({ kind: ToFeederKind.Release, request: 1 });
    await settle();

    expect(playing.said.at(-1)).toMatchObject({
      kind: FromFeederKind.ContinuationRefused,
      failures: [{ code: 'playback.continuation-superseded' }],
    });
  });
});
