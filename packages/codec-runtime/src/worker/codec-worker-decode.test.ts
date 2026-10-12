/**
 * The codec worker decoding files end to end, as the storage worker receives
 * them: real FLAC and Opus made by the codec module's own encoders, decoded
 * through the worker's stream under the receiver's credit, compared with the
 * samples they were made from.
 */

import { ChannelRole, StandardLayouts, createCancellationSource } from '@audiogubbins/domain';
import type { DecodedStreamMessage } from '@audiogubbins/import-export';
import { describe, expect, it } from 'vitest';

import { codecModule } from '../testing/codec-module.js';
import { flacFile, oggOpusFile } from '../testing/encoded-fixtures.js';
import { runDecode } from './decode-job.js';
import {
  MEMORY_READER,
  decodedReceiver,
  memoryFile,
  workerHarness,
  type DecodedReceiver,
  type Harness,
} from '../testing/worker-harness.js';

/** Integer samples of `bits` bits: a sine of `cycles` cycles and a little noise. */
function integers(frames: number, cycles: number, bits: number, seed: number): Int32Array {
  const peak = (2 ** (bits - 1) - 1) * 0.7;
  let state = seed;
  return Int32Array.from({ length: frames }, (_, frame) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.round(Math.sin((2 * Math.PI * cycles * frame) / frames) * peak) + (state % 5) - 2;
  });
}

function sine(frames: number, frequency: number, amplitude: number): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, frame) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / 48_000),
  );
}

/** The planes a stream's blocks hold, joined. */
function joinedPlanes(messages: readonly DecodedStreamMessage[]): Float32Array[] {
  const blocks = messages.flatMap((message) => (message.kind === 'block' ? [message] : []));
  const channels = blocks[0]?.channels.length ?? 0;
  const total = blocks.reduce((sum, block) => sum + block.frames, 0);
  const planes = Array.from({ length: channels }, () => new Float32Array(total));
  let at = 0;
  for (const block of blocks) {
    block.channels.forEach((plane, channel) => planes[channel]?.set(plane, at));
    at += block.frames;
  }
  return planes;
}

/** Decodes `file` through `harness` into `receiver`, answering the request's end. */
async function decode(
  harness: Harness,
  file: Uint8Array,
  receiver: DecodedReceiver,
  request = 'd',
) {
  harness.core.receive({
    kind: 'decode',
    request,
    file: { kind: 'file', file: memoryFile(file) },
    stream: receiver.port,
  });
  const answer = await harness.answer(request);
  await receiver.ended;
  receiver.close();
  return answer;
}

/** The correlation of two planes, -1 to 1. */
function correlation(a: Float32Array, b: Float32Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  a.forEach((sample, index) => {
    const other = b[index] ?? 0;
    ab += sample * other;
    aa += sample * sample;
    bb += other * other;
  });
  return ab / Math.sqrt(aa * bb);
}

describe('the codec worker decoding a file', () => {
  it('streams FLAC sample for sample, described, in blocks, never past its credit', async () => {
    const module = await codecModule();
    const frames = 150_000;
    const planes = [integers(frames, 7, 16, 1), integers(frames, 11, 16, 2)];
    const file = flacFile(module, planes, {
      sampleRate: 44_100,
      bitsPerSample: 16,
      blockSize: 4_096,
      metadata: { text: { title: 'Rain' } },
    });
    const harness = await workerHarness();
    const receiver = decodedReceiver({ window: 1 });
    const answer = await decode(harness, file, receiver);
    expect(answer).toMatchObject({
      kind: 'decoded',
      frames,
      decoder: { implementation: 'codec-module', name: 'Symphonia', version: '0.6.1' },
    });
    expect(receiver.overdrawn()).toBe(0);
    expect(receiver.messages[0]).toEqual({
      kind: 'description',
      description: {
        sampleRate: 44_100,
        layout: StandardLayouts.stereo,
        statedFrames: frames,
        metadata: { text: { title: 'Rain' } },
      },
    });
    expect(receiver.messages.at(-1)).toEqual({ kind: 'end', frames });
    // Blocks of the stated size, all but the last.
    const sizes = receiver.messages.flatMap((one) => (one.kind === 'block' ? [one.frames] : []));
    expect(sizes).toEqual([65_536, 65_536, 18_928]);
    joinedPlanes(receiver.messages).forEach((plane, channel) => {
      expect(Int32Array.from(plane, (sample) => sample * 32_768)).toEqual(planes[channel]);
    });
    expect(harness.progress('d')).toEqual([65_536, 131_072, 150_000]);
  });

  it('keeps FLAC 5.1 in the speaker-mask order its channel assignment states, each channel its own', async () => {
    const module = await codecModule();
    const frames = 20_000;
    const planes = Array.from({ length: 6 }, (_, channel) =>
      integers(frames, 3 + channel * 2, 24, channel + 1),
    );
    const file = flacFile(module, planes, {
      sampleRate: 48_000,
      bitsPerSample: 24,
      blockSize: 4_096,
    });
    const harness = await workerHarness();
    const receiver = decodedReceiver({ window: 2 });
    expect((await decode(harness, file, receiver)).kind).toBe('decoded');
    const description = receiver.messages[0];
    expect(description?.kind === 'description' ? description.description.layout.roles : []).toEqual(
      [
        ChannelRole.Left,
        ChannelRole.Right,
        ChannelRole.Centre,
        ChannelRole.LowFrequency,
        ChannelRole.RearLeft,
        ChannelRole.RearRight,
      ],
    );
    joinedPlanes(receiver.messages).forEach((plane, channel) => {
      expect(Int32Array.from(plane, (sample) => sample * 2 ** 23)).toEqual(planes[channel]);
    });
  });

  it('streams Opus to exactly the frames encoded, each channel in speaker-mask order', async () => {
    const module = await codecModule();
    const frames = 48_123;
    // The fourth channel is the low-frequency effects, which Opus keeps only below 120 Hz.
    const frequencies = [300, 500, 700, 80, 1_100, 1_300];
    const planes = frequencies.map((frequency) => sine(frames, frequency, 0.3));
    const file = oggOpusFile(module, planes, {
      bitRate: 384_000,
      application: 'audio',
      frameDuration: 20,
      complexity: 10,
      rateControl: 'variable',
    });
    const harness = await workerHarness();
    const receiver = decodedReceiver({ window: 3 });
    const answer = await decode(harness, file, receiver);
    expect(answer).toMatchObject({
      kind: 'decoded',
      frames,
      decoder: { name: 'ropus', version: '0.12.18' },
    });
    expect(receiver.overdrawn()).toBe(0);
    const decoded = joinedPlanes(receiver.messages);
    expect(decoded.map((plane) => plane.length)).toEqual(frequencies.map(() => frames));
    // Each decoded channel is most like the source channel of its own place.
    decoded.forEach((plane, channel) => {
      const likeness = planes.map((source) => correlation(source, plane));
      expect(likeness.indexOf(Math.max(...likeness))).toBe(channel);
      expect(likeness[channel]).toBeGreaterThan(0.9);
    });
  });

  it('stops at a cancellation part way, ending the stream with it and sending no end', async () => {
    const module = await codecModule();
    const frames = 400_000;
    const file = flacFile(module, [integers(frames, 5, 16, 3), integers(frames, 9, 16, 4)], {
      sampleRate: 48_000,
      bitsPerSample: 16,
      blockSize: 4_096,
    });
    const harness = await workerHarness();
    const receiver = decodedReceiver({ window: 2 });
    harness.core.receive({
      kind: 'decode',
      request: 'c',
      file: { kind: 'file', file: memoryFile(file) },
      stream: receiver.port,
    });
    // Hold credit back once the description and the first block have come.
    while (receiver.messages.length < 2) await new Promise((resolve) => setTimeout(resolve, 1));
    receiver.pause();
    harness.core.receive({ kind: 'cancel', request: 'c' });
    receiver.resume();
    expect(await harness.answer('c')).toEqual({ kind: 'cancelled', request: 'c' });
    expect(await receiver.ended).toMatchObject({
      kind: 'failed',
      failure: { code: 'codec-runtime.cancelled' },
    });
    expect(receiver.messages.some((one) => one.kind === 'end')).toBe(false);
    const blocks = receiver.messages.filter((one) => one.kind === 'block').length;
    expect(blocks).toBeLessThan(Math.ceil(frames / 65_536));
    expect(receiver.overdrawn()).toBe(0);
    receiver.close();
  });

  it('fails a stream whose audio breaks part way, after the blocks before it', async () => {
    const module = await codecModule();
    const frames = 300_000;
    const file = flacFile(module, [integers(frames, 5, 16, 5), integers(frames, 9, 16, 6)], {
      sampleRate: 48_000,
      bitsPerSample: 16,
      blockSize: 4_096,
    });
    // Damage the frames of the last third of the file.
    const damaged = file.slice();
    for (let at = Math.floor(file.length * 0.7); at < file.length; at += 97) {
      damaged[at] = (damaged[at] ?? 0) ^ 0x5a;
    }
    const harness = await workerHarness();
    const receiver = decodedReceiver({ window: 4 });
    const answer = await decode(harness, damaged, receiver);
    expect(answer).toMatchObject({ kind: 'failed', failure: { code: 'codec-runtime.malformed' } });
    expect(receiver.messages.filter((one) => one.kind === 'block').length).toBeGreaterThan(0);
    expect(receiver.messages.at(-1)).toMatchObject({
      kind: 'failed',
      failure: { code: 'codec-runtime.malformed' },
    });
  });

  it('ends the stream with the reason where the file is refused before it decodes', async () => {
    const harness = await workerHarness();
    const receiver = decodedReceiver({ window: 1 });
    const answer = await decode(harness, new Uint8Array(4_096).fill(9), receiver);
    expect(answer.kind).toBe('failed');
    expect(receiver.messages).toEqual([
      { kind: 'failed', failure: expect.objectContaining({ code: 'codecs.unsupported-format' }) },
    ]);
  });

  it('stops when the storage worker refuses the stream, sending nothing more', async () => {
    const module = await codecModule();
    const frames = 300_000;
    const file = flacFile(module, [integers(frames, 5, 16, 7)], {
      sampleRate: 48_000,
      bitsPerSample: 16,
      blockSize: 4_096,
    });
    const harness = await workerHarness();
    const receiver = decodedReceiver({ window: 1 });
    harness.core.receive({
      kind: 'decode',
      request: 'r',
      file: { kind: 'file', file: memoryFile(file) },
      stream: receiver.port,
    });
    while (receiver.messages.length < 1) await new Promise((resolve) => setTimeout(resolve, 1));
    receiver.pause();
    const refusal = {
      code: 'storage.quota',
      kind: 'retryable',
      summary: 'The disk is full.',
    } as const;
    receiver.refuse({ kind: 'refused', failure: refusal });
    expect(await harness.answer('r')).toEqual({ kind: 'failed', request: 'r', failure: refusal });
    receiver.close();
  });

  it('ends the stream with a fault the decode meets, so the storage worker does not wait on it', async () => {
    const module = await codecModule();
    const file = flacFile(module, [integers(4_096, 5, 16, 8)], {
      sampleRate: 48_000,
      bitsPerSample: 16,
      blockSize: 4_096,
    });
    const thrown = new Error('A decoder broke.');
    const receiver = decodedReceiver({ window: 4 });

    const decoding = runDecode(
      { kind: 'file', file: memoryFile(file) },
      receiver.port,
      MEMORY_READER,
      {
        codecModule: () => Promise.reject(thrown),
        environment: () => ({
          webAssembly: true,
          codecModule: 'loaded',
          encoderModules: new Map(),
          browserDecoders: new Set(),
          browserEncoders: new Set(),
        }),
        platform: {
          webAssembly: true,
          decoding: undefined,
          encoding: undefined,
          browser: undefined,
        },
      },
      {
        signal: createCancellationSource().signal,
        yieldToHost: () => Promise.resolve(),
        progress: () => undefined,
      },
    );

    await expect(decoding).rejects.toBe(thrown);
    expect(await receiver.ended).toMatchObject({
      kind: 'failed',
      failure: { code: 'codec-runtime.fault' },
    });
    receiver.close();
  });
});
