import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate, type ChannelLayout } from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { allocateBlock, type AudioFrameBlock } from '@audiogubbins/audio-engine';

import {
  MAXIMUM_RING_FRAMES,
  RingReader,
  RingWriter,
  advancePosition,
  createSampleRing,
  framesBetween,
} from './sample-ring.js';

const RATE = expectSuccess(sampleRate(48_000));
const STEREO: ChannelLayout = StandardLayouts.stereo;

/** Sample `frame` of channel `channel` of the test signal: each channel its own ramp, exact in f32. */
function sampleAt(channel: number, frame: number): number {
  return (channel + 1) * 100_000 + frame;
}

/** Frames `[start, start + frames)` of the test signal. */
function signal(start: number, frames: number): AudioFrameBlock {
  const block = allocateBlock(STEREO, RATE, frames);
  block.channels.forEach((channel, index) => {
    for (let frame = 0; frame < frames; frame += 1) channel[frame] = sampleAt(index, start + frame);
  });
  return block;
}

function ring(capacity: number): { writer: RingWriter; reader: RingReader } {
  const memory = expectSuccess(createSampleRing(2, capacity));
  return {
    writer: expectSuccess(RingWriter.open(memory)),
    reader: expectSuccess(RingReader.open(memory)),
  };
}

/** Reads `frames` frames and answers them, one array per channel, cut to what was read. */
function readOut(reader: RingReader, frames: number): Float32Array[] {
  const into = allocateBlock(STEREO, RATE, frames);
  const got = reader.read(into);
  return into.channels.map((channel) => channel.slice(0, got));
}

describe('the sample ring', () => {
  it('refuses a shape it cannot hold, and accepts any capacity up to the maximum', () => {
    expect(expectFailureCode(createSampleRing(0, 16))).toBe('feed.ring-invalid');
    expect(expectFailureCode(createSampleRing(2, 0))).toBe('feed.ring-invalid');
    expect(expectFailureCode(createSampleRing(2, 1.5))).toBe('feed.ring-invalid');
    expect(expectFailureCode(createSampleRing(2, MAXIMUM_RING_FRAMES + 1))).toBe(
      'feed.ring-invalid',
    );
    expect(expectSuccess(createSampleRing(3, 7)).byteLength).toBeGreaterThan(3 * 7 * 4);
  });

  it('refuses memory whose header does not describe a ring of its length', () => {
    expect(expectFailureCode(RingReader.open(new SharedArrayBuffer(8)))).toBe('feed.ring-invalid');
    const memory = expectSuccess(createSampleRing(2, 16));
    const truncated = new SharedArrayBuffer(memory.byteLength - 4);
    new Uint8Array(truncated).set(new Uint8Array(memory, 0, truncated.byteLength));
    expect(expectFailureCode(RingWriter.open(truncated))).toBe('feed.ring-invalid');
  });

  it('wraps around its end without losing or reordering a frame', () => {
    const { writer, reader } = ring(5);
    expect(writer.write(signal(0, 3))).toBe(3);
    expect(readOut(reader, 3)).toEqual(signal(0, 3).channels);
    // Four frames from index 3 of five: two before the end, two from the start.
    expect(writer.write(signal(3, 4))).toBe(4);
    expect(readOut(reader, 4)).toEqual(signal(3, 4).channels);
  });

  it('writes as much of a block as fits, and says how much', () => {
    const { writer, reader } = ring(4);
    expect(writer.write(signal(0, 6))).toBe(4);
    expect(writer.available).toBe(0);
    expect(writer.write(signal(4, 2))).toBe(0);
    expect(readOut(reader, 2)).toEqual(signal(0, 2).channels);
    expect(writer.available).toBe(2);
    expect(writer.write(signal(4, 2))).toBe(2);
    expect(readOut(reader, 10)).toEqual(signal(2, 4).channels);
  });

  it('gives the exact sequence when writes and reads of odd sizes interleave', () => {
    const { writer, reader } = ring(11);
    const total = 5_000;
    const writes = [3, 7, 1, 5, 11];
    const reads = [2, 9, 4, 13];
    const collected = [new Float32Array(total), new Float32Array(total)];
    let written = 0;
    let read = 0;
    // Bounded, so a ring that stops giving frames fails the test rather than hanging it.
    for (let turn = 0; read < total && turn < 10 * total; turn += 1) {
      const size = Math.min(writes[turn % writes.length] ?? 1, total - written);
      if (size > 0) written += writer.write(signal(written, size));
      const got = readOut(reader, reads[turn % reads.length] ?? 1);
      got.forEach((channel, index) => collected[index]?.set(channel, read));
      read += got[0]?.length ?? 0;
    }
    expect(collected).toEqual(signal(0, total).channels);
  });

  it('keeps its positions within 32 bits however long it runs', () => {
    const largest = 2 * MAXIMUM_RING_FRAMES - 1;
    // The largest position a ring of the largest capacity reaches is a 32-bit integer.
    expect(new Int32Array([largest])[0]).toBe(largest);
    expect(advancePosition(largest, 1, MAXIMUM_RING_FRAMES)).toBe(0);
    expect(advancePosition(largest - 2, 5, MAXIMUM_RING_FRAMES)).toBe(2);
    // Across the wrap of the positions, the frames between them are still counted.
    expect(framesBetween(largest - 2, 2, MAXIMUM_RING_FRAMES)).toBe(5);
    expect(framesBetween(largest, largest, MAXIMUM_RING_FRAMES)).toBe(0);
    expect(framesBetween(0, MAXIMUM_RING_FRAMES, MAXIMUM_RING_FRAMES)).toBe(MAXIMUM_RING_FRAMES);
  });

  it('streams many times its positions’ range through a small ring exactly', () => {
    // A capacity of 3 wraps its positions every 6 frames, thousands of times here.
    const { writer, reader } = ring(3);
    const total = 30_000;
    let read = 0;
    let written = 0;
    let mismatches = 0;
    for (let turn = 0; read < total && turn < 10 * total; turn += 1) {
      written += writer.write(signal(written, Math.min(2, total - written)));
      const got = readOut(reader, 3);
      got[1]?.forEach((sample, frame) => {
        if (sample !== sampleAt(1, read + frame)) mismatches += 1;
      });
      read += got[1]?.length ?? 0;
    }
    expect(read).toBe(total);
    expect(mismatches).toBe(0);
    expect(writer.queued).toBe(0);
  });

  it('says it has ended once the writer does, and the rest of its audio still reads', () => {
    const { writer, reader } = ring(8);
    writer.write(signal(0, 5));
    expect(readOut(reader, 2)[0]).toHaveLength(2);
    expect(reader.ended).toBe(false);
    writer.end();
    expect(readOut(reader, 8)).toEqual(signal(2, 3).channels);
    expect(reader.ended).toBe(true);
  });

  it('skips the audio a discard marked when the reader is cleared, and keeps what followed', () => {
    const { writer, reader } = ring(16);
    writer.write(signal(0, 6));
    writer.end();
    writer.discard();
    // The new position's audio is written at once, before the reset arrives.
    writer.write(signal(1_000, 4));
    // Until the reset, the reader reads the old audio and stops at the mark.
    expect(readOut(reader, 4)).toEqual(signal(0, 4).channels);
    expect(readOut(reader, 8)).toEqual(signal(4, 2).channels);
    expect(readOut(reader, 8)[0]).toHaveLength(0);
    reader.clear();
    expect(reader.ended).toBe(false);
    expect(readOut(reader, 8)).toEqual(signal(1_000, 4).channels);
  });

  it('skips to the latest mark when two discards come before a reset', () => {
    const { writer, reader } = ring(16);
    writer.write(signal(0, 3));
    writer.discard();
    writer.write(signal(500, 3));
    writer.discard();
    writer.write(signal(1_000, 3));
    reader.clear();
    expect(readOut(reader, 16)).toEqual(signal(1_000, 3).channels);
    // The second seek's reset finds its mark already skipped to, and discards nothing new.
    writer.write(signal(1_003, 2));
    reader.clear();
    expect(readOut(reader, 16)).toEqual(signal(1_003, 2).channels);
  });

  it('discards nothing when cleared without a mark, since only the writer knows what is old', () => {
    const { writer, reader } = ring(8);
    writer.write(signal(0, 4));
    reader.clear();
    expect(readOut(reader, 8)).toEqual(signal(0, 4).channels);
  });

  it('refuses a block of another number of channels', () => {
    const { writer } = ring(8);
    expect(() => writer.write(allocateBlock(StandardLayouts.mono, RATE, 2))).toThrow(/channels/u);
  });
});
