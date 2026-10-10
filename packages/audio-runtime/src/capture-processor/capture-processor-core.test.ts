/**
 * The capture processor's core, run directly as the worklet runs it, a
 * quantum at a time over a known input, with its takes read back through the
 * real capture channel reader (ADR-0070).
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  type ChainSlot,
  type ChannelLayout,
  type EffectChain,
} from '@audiogubbins/domain';
import { decibelsToGain, DspDeliveryKind } from '@audiogubbins/audio-engine';

import { CaptureReader, type CaptureEvent } from '../capture/capture-reader.js';
import { CaptureEndReason } from '../capture/capture-wire.js';
import { createSampleRing } from '../feed/sample-ring.js';
import {
  FromCaptureKind,
  ToCaptureKind,
  type FromCapture,
  type ToCapture,
} from '../protocol/capture-messages.js';
import { CAPTURE_PROCESSING, catalogueSlot } from '../testing/capture-rig.js';
import { fakeChannel } from '../testing/fake-message-channel.js';
import { settle } from '../testing/playback-rig.js';
import { CaptureProcessorCore } from './capture-processor-core.js';

const RATE = 48_000;
const QUANTUM = 128;
const ids = createDeterministicIdGenerator(97);

/** The input's sample on `channel` at context frame `frame`: exact in f32, and unlike every other. */
function signal(channel: number, frame: number): number {
  return ((channel + 1) * 1000 + (frame % 4096)) / 65_536 - 0.04;
}

function chainOf(...slots: ChainSlot[]): EffectChain {
  return { id: ids.next(), slots };
}

/** A core over an input of `layout`, the replies it posts, and its quanta driven by the test. */
class CoreRig {
  readonly core: CaptureProcessorCore;
  readonly replies: FromCapture[] = [];
  /** Every quantum played, flat per channel. */
  readonly played: number[][];
  readonly channels: number;
  frame = 0;
  /** Whether the input gives no channels, as a stopped source gives none. */
  absent = false;

  constructor(layout: ChannelLayout = StandardLayouts.stereo, reportEveryBlocks = 0) {
    this.channels = layout.roles.length;
    this.played = Array.from({ length: this.channels }, () => []);
    this.core = new CaptureProcessorCore({
      sampleRate: RATE,
      processing: CAPTURE_PROCESSING,
      post: (message) => {
        this.replies.push(structuredClone(message));
      },
    });
    this.send({
      kind: ToCaptureKind.Configure,
      layout,
      dsp: { kind: DspDeliveryKind.Unavailable, reason: 'This test compiles no DSP module.' },
      reportEveryBlocks,
    });
  }

  send(message: ToCapture): void {
    this.core.receive(message);
  }

  /** Runs `quanta` quanta of the input from the current frame. */
  run(quanta: number): void {
    for (let quantum = 0; quantum < quanta; quantum += 1) {
      const input = this.absent
        ? []
        : Array.from({ length: this.channels }, (_, channel) =>
            Float32Array.from({ length: QUANTUM }, (_, at) => signal(channel, this.frame + at)),
          );
      const output = Array.from({ length: this.channels }, () => new Float32Array(QUANTUM));
      this.core.process(input, output, this.frame);
      output.forEach((channel, index) => this.played[index]?.push(...channel));
      this.frame += QUANTUM;
    }
  }

  /** Starts a take at `at`, and the reader of its channel. */
  record(at: number, ring?: SharedArrayBuffer, heldSeconds?: number): CaptureReader {
    const { port1, port2 } = fakeChannel();
    this.send({ kind: ToCaptureKind.Record, at, channel: port1, ring });
    return new CaptureReader(port2, heldSeconds === undefined ? {} : { heldSeconds });
  }

  repliesOf<TKind extends FromCapture['kind']>(
    kind: TKind,
  ): Extract<FromCapture, { kind: TKind }>[] {
    return this.replies.filter(
      (reply): reply is Extract<FromCapture, { kind: TKind }> => reply.kind === kind,
    );
  }
}

/** Every event of a take, once its end has been posted. */
async function eventsOf(reader: CaptureReader): Promise<CaptureEvent[]> {
  await settle();
  const events: CaptureEvent[] = [];
  for await (const event of reader) events.push(event);
  return events;
}

/** The take's frames, channel by channel, from its blocks, which must follow one another. */
function framesOf(events: readonly CaptureEvent[], channels: number): number[][] {
  const frames = Array.from({ length: channels }, (): number[] => []);
  let next: number | undefined;
  for (const event of events) {
    if (event.kind === 'begin') next = event.frame;
    if (event.kind === 'gap') next = event.frame + event.frames;
    if (event.kind !== 'block') continue;
    expect(event.frame).toBe(next);
    event.channels.forEach((channel, index) => frames[index]?.push(...channel));
    next = event.frame + (event.channels[0]?.length ?? 0);
  }
  return frames;
}

/** The input from context frame `from` up to `to`, channel by channel. */
function inputBetween(from: number, to: number, channels: number): number[][] {
  return Array.from({ length: channels }, (_, channel) =>
    Array.from({ length: to - from }, (_, at) => Math.fround(signal(channel, from + at))),
  );
}

let rig: CoreRig | undefined;
afterEach(() => {
  rig?.send({ kind: ToCaptureKind.Release });
  rig = undefined;
});

describe('the capture processor’s take (ADR-0070)', () => {
  it('is the dry input, bit for bit, while monitoring plays it through a chain', async () => {
    rig = new CoreRig();
    rig.send({ kind: ToCaptureKind.Monitor, on: true });
    rig.send({
      kind: ToCaptureKind.SetChain,
      chain: chainOf(catalogueSlot(ids, 'gain', { gain: 6 })),
      quality: MAXIMUM_QUALITY,
    });
    rig.run(3);
    const reader = rig.record(1_000);
    rig.run(60);
    rig.send({ kind: ToCaptureKind.Stop, at: 9_000 });
    rig.run(80);
    const events = await eventsOf(reader);

    expect(rig.repliesOf(FromCaptureKind.Monitoring).at(-1)).toMatchObject({
      on: true,
      chained: true,
    });
    expect(framesOf(events, 2)).toEqual(inputBetween(1_000, 9_000, 2));
    expect(events.at(-1)).toEqual({ kind: 'end', frame: 9_000, reason: CaptureEndReason.Stopped });
    // The monitored output is the chain's, which shows the chain ran on the same input.
    const louder = decibelsToGain(6);
    expect(rig.played[0]?.[5_000]).toBe(Math.fround(Math.fround(signal(0, 5_000)) * louder));
  });

  it('reports its first frame exactly, a frame within a quantum', async () => {
    rig = new CoreRig();
    rig.run(6);
    const reader = rig.record(777);
    rig.send({ kind: ToCaptureKind.Stop, at: 800 });
    rig.run(1);

    expect(rig.repliesOf(FromCaptureKind.Recording)).toEqual([
      { kind: FromCaptureKind.Recording, firstFrame: 777, startFrame: 777, retrospectiveFrames: 0 },
    ]);
    rig.run(1);
    expect(rig.repliesOf(FromCaptureKind.Stopped)).toEqual([
      { kind: FromCaptureKind.Stopped, endFrame: 800, reason: CaptureEndReason.Stopped },
    ]);
    const events = await eventsOf(reader);
    expect(events[0]).toMatchObject({ kind: 'begin', frame: 777, channels: 2 });
    expect(framesOf(events, 2)).toEqual(inputBetween(777, 800, 2));
  });

  it('starts a take whose frame has passed at the next quantum, and says so', () => {
    rig = new CoreRig();
    rig.run(10);
    rig.record(5);
    rig.run(1);

    expect(rig.repliesOf(FromCaptureKind.Recording)[0]).toMatchObject({
      firstFrame: 1_280,
      startFrame: 1_280,
    });
  });
});

describe('the retrospective buffer (REQ-REC-090)', () => {
  it('becomes exactly the configured seconds before Record, ahead of the live frames', async () => {
    rig = new CoreRig();
    rig.send({ kind: ToCaptureKind.Arm, retrospectiveSeconds: 5 });
    rig.run(2_000);
    const at = rig.frame + 50;
    const reader = rig.record(at);
    rig.run(4);
    rig.send({ kind: ToCaptureKind.Stop, at: at + 1_000 });
    rig.run(2_000);
    const events = await eventsOf(reader);

    const keep = 5 * RATE;
    expect(rig.repliesOf(FromCaptureKind.Armed)).toEqual([
      { kind: FromCaptureKind.Armed, retrospectiveFrames: keep },
    ]);
    expect(rig.repliesOf(FromCaptureKind.Recording)).toEqual([
      {
        kind: FromCaptureKind.Recording,
        firstFrame: at - keep,
        startFrame: at,
        retrospectiveFrames: keep,
      },
    ]);
    expect(framesOf(events, 2)).toEqual(inputBetween(at - keep, at + 1_000, 2));
  });

  it('keeps nothing while armed without one, or unarmed', () => {
    rig = new CoreRig();
    rig.run(10);
    rig.send({ kind: ToCaptureKind.Arm, retrospectiveSeconds: 0 });
    rig.run(10);

    expect(rig.core.retrospective).toBeUndefined();
    rig.record(rig.frame);
    rig.run(1);
    expect(rig.repliesOf(FromCaptureKind.Recording)[0]).toMatchObject({ retrospectiveFrames: 0 });
  });

  it('is overwritten with zeros when disarmed, rearmed or let go', () => {
    for (const leave of [
      { kind: ToCaptureKind.Disarm },
      { kind: ToCaptureKind.Arm, retrospectiveSeconds: 10 },
      { kind: ToCaptureKind.Release },
    ] as const) {
      rig = new CoreRig();
      rig.send({ kind: ToCaptureKind.Arm, retrospectiveSeconds: 5 });
      rig.run(100);
      const buffer = rig.core.retrospective;
      if (buffer === undefined) throw new Error('An input armed with a buffer has one.');
      const held = Array.from({ length: 2 }, () => new Float32Array(buffer.capacity));
      buffer.peek(held, buffer.capacity);
      expect(held[0]?.some((sample) => sample !== 0)).toBe(true);

      rig.send(leave);
      buffer.peek(held, buffer.capacity);

      expect(held.every((channel) => channel.every((sample) => sample === 0))).toBe(true);
      expect(buffer.queued).toBe(0);
    }
  });

  it('refuses a length no buffer could have, keeping the input as it was', () => {
    rig = new CoreRig();
    rig.send({ kind: ToCaptureKind.Arm, retrospectiveSeconds: -1 });

    expect(rig.repliesOf(FromCaptureKind.Refused)[0]).toMatchObject({ command: ToCaptureKind.Arm });
    expect(rig.core.retrospective).toBeUndefined();
  });
});

describe('monitoring (REQ-REC-091)', () => {
  it('is silent until turned on, whatever arming and recording do', () => {
    rig = new CoreRig();
    rig.send({ kind: ToCaptureKind.Arm, retrospectiveSeconds: 5 });
    rig.record(256);
    rig.run(20);

    expect(rig.played.every((channel) => channel.every((sample) => sample === 0))).toBe(true);
    expect(rig.repliesOf(FromCaptureKind.Monitoring)).toEqual([]);

    rig.send({ kind: ToCaptureKind.Monitor, on: true });
    rig.run(1);
    expect(rig.played[1]?.slice(-QUANTUM)).toEqual(
      inputBetween(rig.frame - QUANTUM, rig.frame, 2)[1],
    );
  });

  it('refuses a chain that cannot run live with its reason, and capture and monitoring go on', async () => {
    rig = new CoreRig();
    rig.send({ kind: ToCaptureKind.Monitor, on: true });
    const reader = rig.record(0);
    rig.run(10);
    rig.send({
      kind: ToCaptureKind.SetChain,
      chain: chainOf(catalogueSlot(ids, 'peak-normalisation')),
      quality: MAXIMUM_QUALITY,
    });
    rig.run(10);
    rig.send({ kind: ToCaptureKind.Stop, at: rig.frame });
    rig.run(2);
    const events = await eventsOf(reader);

    const [refusal] = rig.repliesOf(FromCaptureKind.ChainRefused);
    expect(refusal?.failures[0]).toMatchObject({ code: 'effect-rack.chain-not-live' });
    expect(refusal?.failures[0].summary).toContain('measures the whole of its input');
    expect(framesOf(events, 2)).toEqual(inputBetween(0, 20 * QUANTUM, 2));
    // Still monitored dry.
    expect(rig.played[0]?.slice(-QUANTUM)).toEqual(
      inputBetween(rig.frame - QUANTUM, rig.frame, 2)[0],
    );
  });
});

describe('the input’s meters', () => {
  it('report the peak, root mean square and correlation of what arrived since the last report', () => {
    rig = new CoreRig(StandardLayouts.stereo, 4);
    rig.run(4);

    const [report] = rig.repliesOf(FromCaptureKind.Report);
    const left = inputBetween(0, 4 * QUANTUM, 2)[0] ?? [];
    const peak = Math.max(...left.map(Math.abs));
    const rms = Math.sqrt(left.reduce((sum, sample) => sum + sample * sample, 0) / left.length);
    expect(report?.contextFrame).toBe(4 * QUANTUM);
    expect(report?.meter?.peak[0]).toBe(peak);
    expect(report?.meter?.rms[0]).toBeCloseTo(rms, 12);
    expect(report?.meter?.correlation).toHaveLength(1);
    expect(report?.absentFrames).toBe(0);
  });

  it('count the frames an absent input gave nothing for, which a take holds as silence', async () => {
    rig = new CoreRig(StandardLayouts.mono, 2);
    const reader = rig.record(0);
    rig.absent = true;
    rig.run(2);
    rig.send({ kind: ToCaptureKind.Stop, at: rig.frame });
    rig.run(1);
    const events = await eventsOf(reader);

    expect(rig.repliesOf(FromCaptureKind.Report)[0]?.absentFrames).toBe(2 * QUANTUM);
    expect(framesOf(events, 1)).toEqual([new Array<number>(2 * QUANTUM).fill(0)]);
  });
});

describe('a take whose reader falls behind', () => {
  it('reports the frames its full queue could not keep as one gap, never as audio', async () => {
    rig = new CoreRig(StandardLayouts.mono, 50);
    const ring = createSampleRing(1, 8_192);
    if (!ring.ok) throw new Error('A ring of 8 192 frames can be made.');
    const reader = rig.record(0, ring.value);
    rig.run(1_000);
    const stop = rig.frame;
    rig.send({ kind: ToCaptureKind.Stop, at: stop });
    const events: CaptureEvent[] = [];
    const read = (async (): Promise<void> => {
      for await (const event of reader) events.push(event);
    })();
    for (let quantum = 0; quantum < 2_000 && events.at(-1)?.kind !== 'end'; quantum += 1) {
      rig.run(1);
      await settle();
    }
    await read;

    const gaps = events.filter((event) => event.kind === 'gap');
    expect(gaps).toHaveLength(1);
    const [gap] = gaps;
    if (gap?.kind !== 'gap') throw new Error('The overrun is reported as a gap.');
    const kept = framesOf(events, 1)[0] ?? [];
    expect(kept).toEqual(inputBetween(0, gap.frame, 1)[0]);
    expect(gap.frame + gap.frames).toBe(stop);
    expect(events.at(-1)).toEqual({ kind: 'end', frame: stop, reason: CaptureEndReason.Stopped });
    const reported = rig
      .repliesOf(FromCaptureKind.Report)
      .reduce((sum, one) => sum + one.lostFrames, 0);
    expect(reported).toBeGreaterThan(0);
    expect(reported).toBeLessThanOrEqual(gap.frames);
  });
});

describe('letting the input go', () => {
  it('ends a take as released after every frame it had', async () => {
    rig = new CoreRig();
    const reader = rig.record(0);
    rig.run(5);
    rig.send({ kind: ToCaptureKind.Release });
    const events = await eventsOf(reader);

    expect(framesOf(events, 2)).toEqual(inputBetween(0, 5 * QUANTUM, 2));
    expect(events.at(-1)).toEqual({
      kind: 'end',
      frame: 5 * QUANTUM,
      reason: CaptureEndReason.Released,
    });
    expect(rig.repliesOf(FromCaptureKind.Released)).toHaveLength(1);
    rig = undefined;
  });
});
