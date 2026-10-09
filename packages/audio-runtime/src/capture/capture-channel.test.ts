/**
 * A take's capture channel end to end (ADR-0070): the processor's writer
 * draining its queue into posted blocks or a shared ring, and the storage
 * worker's reader giving back the same frames at the same context frames, the
 * frames lost as gaps of exactly their length, and the end with its reason.
 */

import { describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { RingWriter, createSampleRing } from '../feed/sample-ring.js';
import { FakeMessagePort } from '../testing/fake-message-channel.js';
import { settle } from '../testing/playback-rig.js';
import { CaptureQueue } from './capture-queue.js';
import { CaptureReader, type CaptureEvent } from './capture-reader.js';
import { CaptureEndReason, CaptureTransport, CaptureWireKind } from './capture-wire.js';
import { CAPTURE_BLOCK_FRAMES, CaptureWriter } from './capture-writer.js';

const RATE = expectSuccess(sampleRate(48_000));
const CHANNELS = 2;
const QUANTUM = 128;

function sample(channel: number, frame: number): number {
  return Math.fround((channel * 7 + frame) / 1_048_576);
}

function quantumAt(frame: number): Float32Array[] {
  return Array.from({ length: CHANNELS }, (_, channel) =>
    Float32Array.from({ length: QUANTUM }, (_, at) => sample(channel, frame + at)),
  );
}

/** A take from `first`: its queue, its writer on one end, and the reader on the other. */
function openTake(
  first: number,
  options: {
    readonly ring?: SharedArrayBuffer | undefined;
    readonly capacity?: number;
    readonly heldSeconds?: number;
  } = {},
): { queue: CaptureQueue; writer: CaptureWriter; reader: CaptureReader; port: FakeMessagePort } {
  const { port1, port2 } = FakeMessagePort.pair();
  const queue = new CaptureQueue(CHANNELS, options.capacity ?? 64 * QUANTUM);
  const writer = expectSuccess(
    CaptureWriter.open(port1, {
      frame: first,
      sampleRate: RATE,
      channels: CHANNELS,
      ring: options.ring,
    }),
  );
  const reader = new CaptureReader(
    port2,
    options.heldSeconds === undefined ? {} : { heldSeconds: options.heldSeconds },
  );
  return { queue, writer, reader, port: port1 };
}

async function readAll(reader: CaptureReader): Promise<CaptureEvent[]> {
  await settle();
  const events: CaptureEvent[] = [];
  for await (const event of reader) events.push(event);
  return events;
}

/** The frames of every block, by channel, each block checked to start where the last ended or a gap did. */
function joined(events: readonly CaptureEvent[]): { frames: number[][]; frameOf: number[] } {
  const frames = Array.from({ length: CHANNELS }, (): number[] => []);
  const frameOf: number[] = [];
  let next = 0;
  for (const event of events) {
    if (event.kind === 'begin') next = event.frame;
    if (event.kind === 'gap') {
      expect(event.frame).toBe(next);
      next += event.frames;
    }
    if (event.kind !== 'block') continue;
    expect(event.frame).toBe(next);
    const length = event.channels[0]?.length ?? 0;
    event.channels.forEach((channel, index) => frames[index]?.push(...channel));
    for (let at = 0; at < length; at += 1) frameOf.push(event.frame + at);
    next += length;
  }
  return { frames, frameOf };
}

describe.each([
  ['posted blocks', (): SharedArrayBuffer | undefined => undefined],
  [
    'a shared ring',
    (): SharedArrayBuffer | undefined => expectSuccess(createSampleRing(CHANNELS, 16_384)),
  ],
])('a take over %s', (_name, ring) => {
  it('arrives as the frames sent, at their context frames, a bounded block at a time, then its end', async () => {
    const first = 1_000;
    const { queue, writer, reader } = openTake(first, { ring: ring() });
    let frame = first;
    for (let quantum = 0; quantum < 100; quantum += 1, frame += QUANTUM) {
      queue.push(quantumAt(frame), 0, QUANTUM, frame);
      writer.send(queue, false);
    }
    while (queue.queued > 0) writer.send(queue, true);
    writer.end({ frame, reason: CaptureEndReason.Stopped });
    const events = await readAll(reader);

    expect(events[0]).toMatchObject({
      kind: 'begin',
      frame: first,
      channels: CHANNELS,
      sampleRate: RATE,
    });
    const blocks = events.filter((event) => event.kind === 'block');
    expect(blocks.every((block) => (block.channels[0]?.length ?? 0) <= CAPTURE_BLOCK_FRAMES)).toBe(
      true,
    );
    // Batched: far fewer messages than quanta.
    expect(blocks.length).toBeLessThan(10);
    const { frames, frameOf } = joined(events);
    expect(frameOf).toEqual(Array.from({ length: 100 * QUANTUM }, (_, at) => first + at));
    expect(frames[1]).toEqual(frameOf.map((at) => sample(1, at)));
    expect(events.at(-1)).toEqual({ kind: 'end', frame, reason: CaptureEndReason.Stopped });
  });

  it('reports frames the processor could not keep as a gap of exactly their length', async () => {
    const { queue, writer, reader } = openTake(0, { ring: ring() });
    queue.push(quantumAt(0), 0, QUANTUM, 0);
    writer.send(queue, true);
    // Frames 128 to 640 were captured and lost; the queue goes on from 640.
    queue.push(quantumAt(640), 0, QUANTUM, 640);
    writer.send(queue, true);
    writer.end({ frame: 1_000, reason: CaptureEndReason.Released });
    const events = await readAll(reader);

    expect(events.filter((event) => event.kind === 'gap')).toEqual([
      { kind: 'gap', frame: QUANTUM, frames: 512 },
      { kind: 'gap', frame: 768, frames: 232 },
    ]);
    expect(joined(events).frames[0]).toEqual([
      ...(quantumAt(0)[0] ?? []),
      ...(quantumAt(640)[0] ?? []),
    ]);
    expect(events.at(-1)).toEqual({ kind: 'end', frame: 1_000, reason: CaptureEndReason.Released });
  });
});

describe('a take over a shared ring', () => {
  it('fills the ring and no further while its reader is behind, the rest waiting in the queue', () => {
    const ring = expectSuccess(createSampleRing(CHANNELS, 4_096));
    const { queue, writer } = openTake(0, { ring, capacity: 100 * QUANTUM });
    for (let frame = 0; frame < 10_000; frame += QUANTUM) {
      queue.push(quantumAt(frame), 0, QUANTUM, frame);
      writer.send(queue, false);
    }

    expect(writer.send(queue, true)).toBe(0);
    expect(queue.queued).toBe(10_112 - 4_096);
  });

  it('is read only as far as the processor said it wrote', async () => {
    const ring = expectSuccess(createSampleRing(CHANNELS, 4_096));
    const { port1, port2 } = FakeMessagePort.pair();
    port1.postMessage({
      kind: CaptureWireKind.Begin,
      transport: CaptureTransport.SharedRing,
      frame: 0,
      sampleRate: RATE,
      channels: CHANNELS,
      ring,
    });
    const reader = new CaptureReader(port2);
    expect(await reader.next()).toMatchObject({ kind: 'begin' });
    // Written into the ring but not yet announced: a gap may still come before it.
    const writer = expectSuccess(RingWriter.open(ring));
    writer.writeFrames(quantumAt(0), QUANTUM);
    let read: CaptureEvent | undefined;
    void reader.next().then((event) => {
      read = event;
    });
    await settle();
    expect(read).toBeUndefined();

    port1.postMessage({ kind: CaptureWireKind.Written, frame: 64 });
    await settle();
    expect(read).toMatchObject({ kind: 'block', frame: 0 });
    expect(read?.kind === 'block' ? read.channels[0]?.length : undefined).toBe(64);
  });
});

describe('posted blocks a slow reader has not taken', () => {
  it('are held up to the bound, and the rest let go as one gap, said once', async () => {
    const { queue, writer, reader } = openTake(0, { heldSeconds: 5_000 / 48_000 });
    for (let frame = 0; frame < 4 * CAPTURE_BLOCK_FRAMES; frame += QUANTUM) {
      queue.push(quantumAt(frame), 0, QUANTUM, frame);
      writer.send(queue, false);
    }
    writer.end({ frame: 4 * CAPTURE_BLOCK_FRAMES, reason: CaptureEndReason.Stopped });
    const events = await readAll(reader);

    expect(events.map((event) => event.kind)).toEqual(['begin', 'block', 'gap', 'end']);
    expect(events[2]).toEqual({
      kind: 'gap',
      frame: CAPTURE_BLOCK_FRAMES,
      frames: 3 * CAPTURE_BLOCK_FRAMES,
    });
  });
});

describe('a capture channel that cannot be trusted', () => {
  it('ends the take as failed, with the reason, after what came before', async () => {
    const { queue, writer, reader, port } = openTake(0);
    queue.push(quantumAt(0), 0, QUANTUM, 0);
    writer.send(queue, true);
    port.postMessage({ kind: 'block', frame: 'soon', channels: [] });
    const events = await readAll(reader);

    expect(events.map((event) => event.kind)).toEqual(['begin', 'block', 'end']);
    expect(events.at(-1)).toMatchObject({
      kind: 'end',
      frame: QUANTUM,
      reason: CaptureEndReason.Failed,
    });
  });

  it('refuses audio that arrives out of order', async () => {
    const { port1, port2 } = FakeMessagePort.pair();
    const reader = new CaptureReader(port2);
    expectSuccess(
      CaptureWriter.open(port1, {
        frame: 0,
        sampleRate: RATE,
        channels: CHANNELS,
        ring: undefined,
      }),
    );
    port1.postMessage({ kind: CaptureWireKind.Block, frame: 512, channels: quantumAt(512) });
    const events = await readAll(reader);

    expect(events.at(-1)).toMatchObject({
      kind: 'end',
      reason: CaptureEndReason.Failed,
      summary: 'A block arrived out of order.',
    });
  });

  it('ends the take as failed when a message is lost in crossing', async () => {
    const { port, reader } = openTake(0);
    port.failToOther();
    const events = await readAll(reader);

    expect(events.at(-1)).toMatchObject({ kind: 'end', reason: CaptureEndReason.Failed });
  });
});
