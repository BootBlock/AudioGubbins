import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  succeed,
  unsafeBrandId,
  type EditPlan,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import type { CachedStreamRequest } from '../pcm/cached-streams.js';
import { allocateBlock } from '../pcm/frame-block.js';
import { describedSource, PcmDescriptionKind } from '../pcm/pcm-description.js';
import { ProcessedStart } from '../pcm/processed-content.js';
import { rackedMedia, rackedPlan } from '../testing/racked-plan.js';
import { scalingChain, type ScalingRuns } from '../testing/scaling-chain.js';
import { CachePurpose, PreviewProducer } from './preview-producer.js';
import { RenderPhase } from './rendered-stream.js';

const RATE = expectSuccess(sampleRate(48_000));
const LENGTH = 40_000;
const SAMPLES = [
  Float32Array.from({ length: LENGTH }, (_, frame) => Math.fround((frame % 97) / 97)),
];
const CHAIN: EffectChain = { id: unsafeBrandId<'EffectChainId'>('00000000-c4a1'), slots: [] };

/**
 * Chains that double their input, heard from a render, each prepared once
 * `gate` lets it, whose passes hold `passBytesPerFrame` for each frame.
 */
function doubling(gate?: Promise<void>, passBytesPerFrame = 0): ScalingRuns {
  return scalingChain({
    factor: 2,
    rendered: true,
    passBytesPerFrame,
    ...(gate === undefined ? {} : { gate }),
  });
}

function opened(
  bound = 64 * 2 ** 20,
  gate?: Promise<void>,
  passBytesPerFrame = 0,
): ScalingRuns & { producer: PreviewProducer } {
  const chain = doubling(gate, passBytesPerFrame);
  return {
    ...chain,
    producer: new PreviewProducer({
      processing: chain.processing,
      dsp: REFERENCE_DSP,
      bound,
      concurrency: 1,
    }),
  };
}

function request(identity = 'memory:racked'): CachedStreamRequest {
  return {
    plan: rackedPlan(CHAIN, LENGTH, RATE),
    place: 1,
    media: [rackedMedia(SAMPLES, RATE, identity)],
    quality: MAXIMUM_QUALITY.settings,
  };
}

const DOUBLED = SAMPLES[0]?.map((sample) => 2 * sample) ?? new Float32Array();

/** A gate and the call that opens it. */
function gated(): { readonly gate: Promise<void>; readonly open: () => void } {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open };
}

describe('the cached preview producer', () => {
  it('waits for a frame not yet made rather than answer silence, then answers the render', async () => {
    const { gate, open } = gated();
    const { producer } = opened(undefined, gate);
    const stream = producer.streams(CachePurpose.Playback).open(request());
    expect(await stream.ready).toEqual(succeed(undefined));
    const into = [new Float32Array(1_000)];
    let answered = false;
    const reading = stream.read(20_000, 1_000, into).then(() => {
      answered = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(answered).toBe(false);
    expect(producer.reports()[0]?.reached).toBe(0);

    open();
    await reading;
    expect(into[0]).toEqual(DOUBLED.subarray(20_000, 21_000));
    stream.release();
  });

  it('renders a sound once for every reader that asks for it, whatever each reads it for', async () => {
    const { producer, starts } = opened();
    const playing = producer.streams(CachePurpose.Playback).open(request());
    const drawing = producer.streams(CachePurpose.Waveform).open(request());
    await playing.read(0, LENGTH, [new Float32Array(LENGTH)]);
    await drawing.read(0, LENGTH, [new Float32Array(LENGTH)]);
    playing.release();
    const again = producer.streams(CachePurpose.Playback).open(request());
    const into = [new Float32Array(LENGTH)];
    await again.read(0, LENGTH, into);
    expect(into[0]).toEqual(DOUBLED);
    expect(starts).toEqual([0]);
    expect(producer.rendersBegun).toBe(1);
    expect(producer.reports()).toEqual([
      expect.objectContaining({
        phase: RenderPhase.Made,
        reached: LENGTH,
        purposes: [CachePurpose.Waveform, CachePurpose.Playback],
      }),
    ]);
  });

  it('goes on making a render let go, until another waits for its place', async () => {
    const { gate, open } = gated();
    const { producer, signals, starts } = opened(undefined, gate);
    const stopped = producer.streams(CachePurpose.Playback).open(request('memory:stopped'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Playback stopped: the render goes on, as playback started again wants it.
    stopped.release();
    expect(signals[0]?.aborted).toBe(false);

    // A render of the sound with a parameter changed waits for the one place:
    // the render nobody listens to gives it up.
    const changed = producer.streams(CachePurpose.Playback).open(request('memory:changed'));
    expect(signals[0]?.aborted).toBe(true);
    open();
    const into = [new Float32Array(100)];
    await changed.read(0, 100, into);
    expect(into[0]).toEqual(DOUBLED.subarray(0, 100));
    expect(starts).toEqual([0, 0]);
    expect(producer.reports()).toEqual([expect.objectContaining({ id: 2 })]);
    changed.release();
  });

  it('gives up the render least recently used to make room for another within its bound', async () => {
    // Room for one render of the stream's 40,000 frames of 4 bytes, not two.
    const { producer } = opened(LENGTH * 4 * 1.5);
    const first = producer.streams(CachePurpose.Waveform).open(request('memory:first'));
    await first.read(0, LENGTH, [new Float32Array(LENGTH)]);
    first.release();
    const second = producer.streams(CachePurpose.Waveform).open(request('memory:second'));
    expect(await second.ready).toEqual(succeed(undefined));
    // The first was made and let go, so it gave its room up.
    expect(producer.reports()).toHaveLength(1);
    // The second is held, so a third has no room, and is declined, not kept over the bound.
    const third = producer.streams(CachePurpose.Waveform).open(request('memory:third'));
    const declined = await third.ready;
    expect(declined.ok).toBe(false);
    if (!declined.ok) expect(declined.failures[0].code).toBe('preview.cache-full');
    second.release();
  });

  it('declines a render longer than its bound before it takes any memory for it', async () => {
    const { producer, starts } = opened();
    // A hundred hours at 48 kHz: 69 GB of samples, more than any typed array holds.
    const hours = { ...request(), plan: rackedPlan(CHAIN, 100 * 3_600 * 48_000, RATE) };
    const declined = await producer.streams(CachePurpose.Playback).open(hours).ready;
    expect(declined.ok).toBe(false);
    if (!declined.ok) expect(declined.failures[0].code).toBe('preview.render-too-long');
    expect(starts).toEqual([]);
    expect(producer.reports()).toEqual([]);
  });

  it('counts what the whole passes hold while a render is made against its bound', async () => {
    // Room for the render's samples, 4 bytes a frame, not for them and its
    // chain's passes, which hold as much again while it is made.
    const { producer, starts } = opened(LENGTH * 4 * 1.5, undefined, 4);
    const declined = await producer.streams(CachePurpose.Playback).open(request()).ready;
    expect(declined.ok).toBe(false);
    if (!declined.ok) expect(declined.failures[0].code).toBe('preview.render-too-long');
    expect(starts).toEqual([]);
  });

  it('counts the passes of every stream a mix it reads sums (ADR-0072)', async () => {
    // Stream 1 is rendered, and reads the mix of streams 2 and 3, each run
    // through a chain of its own while it is made: three passes in all.
    const [heard, racked] = rackedPlan(CHAIN, LENGTH, RATE).streams;
    if (racked === undefined) throw new Error('A racked plan has two streams.');
    const [whole] = racked.segments;
    if (whole === undefined) throw new Error('A racked stream reads the file.');
    const mixing = {
      ...racked,
      segments: [{ ...whole, source: { kind: 'mix' as const, streams: [2, 3] } }],
    };
    const plan: EditPlan = { streams: [heard, mixing, racked, racked] };
    // Room for the render's samples, 4 bytes a frame, and two passes of as
    // much again, but not for the third.
    const { producer, starts } = opened(LENGTH * 4 * 3.5, undefined, 4);
    const declined = await producer.streams(CachePurpose.Playback).open({ ...request(), plan })
      .ready;
    expect(declined.ok).toBe(false);
    if (!declined.ok) expect(declined.failures[0].code).toBe('preview.render-too-long');
    expect(starts).toEqual([]);
  });

  it('gives back what a render’s making held once it is made', async () => {
    const { gate, open } = gated();
    // Room for a made render beside one being made, whose passes hold as much
    // as its samples, but not for two being made.
    const { producer } = opened(LENGTH * 4 * 3.5, gate, 4);
    const first = producer.streams(CachePurpose.Waveform).open(request('memory:first'));
    const crowded = producer.streams(CachePurpose.Waveform).open(request('memory:second'));
    const refused = await crowded.ready;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.failures[0].code).toBe('preview.cache-full');

    open();
    await first.read(0, LENGTH, [new Float32Array(LENGTH)]);
    // Its making lets go of its chain's run once the read it woke has its frames.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Made, the first holds its samples alone, so the second has room beside it.
    const second = producer.streams(CachePurpose.Waveform).open(request('memory:second'));
    expect(await second.ready).toEqual(succeed(undefined));
    first.release();
    second.release();
  });

  it('is read by an edited source through the render, the chain never run by the reader', async () => {
    const { producer, starts } = opened();
    const cached = producer.streams(CachePurpose.Playback);
    const description = {
      kind: PcmDescriptionKind.Edited,
      sampleRate: RATE,
      plan: request().plan,
      media: request().media,
    } as const;
    const own = doubling();
    const settings = {
      processing: own.processing,
      quality: MAXIMUM_QUALITY.settings,
      start: ProcessedStart.Preview,
      cached,
    };
    const source = expectSuccess(
      describedSource(description, StandardLayouts.mono, REFERENCE_DSP, settings),
    );
    const block = allocateBlock(StandardLayouts.mono, RATE, 2_000);
    await source.read(derivedSampleCount(30_000), block);
    // A seek back, as playback started again from the start makes.
    await source.read(derivedSampleCount(0), block);
    expect(block.channels[0]).toEqual(DOUBLED.subarray(0, 2_000));
    source.release();
    expect(starts).toEqual([0]);
    expect(own.starts).toEqual([]);
  });
});
