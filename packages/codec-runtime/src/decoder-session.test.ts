import type { SyncAudioBytes } from '@audiogubbins/codecs';
import { describe, expect, it } from 'vitest';

import type { CodecModule } from './codec-module.js';
import type { DecoderSession } from './decoder-session.js';
import type { FlacFrameSettings } from './flac-frame-encoder.js';
import { codecModule } from './testing/codec-module.js';
import { memoryBytes } from './testing/memory-bytes.js';

/** Integer samples of `bits` bits: a sine with a few steps of noise. */
function signal(frames: number, cycles: number, bits: number, seed: number): Int32Array {
  const peak = (2 ** (bits - 1) - 1) * 0.75;
  let state = seed;
  return Int32Array.from({ length: frames }, (_, frame) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return Math.round(Math.sin((2 * Math.PI * cycles * frame) / frames) * peak) + (state % 7) - 3;
  });
}

/**
 * A native FLAC stream of `planes` from the runtime's frame encoder: the
 * signature, STREAMINFO without an MD5 (which FLAC allows), and the frames.
 */
function flacStream(
  module: CodecModule,
  settings: FlacFrameSettings,
  planes: Int32Array[],
): Uint8Array {
  const encoder = module.createFlacFrameEncoder(settings);
  if (!encoder.ok) throw new Error(encoder.failures[0].summary);
  const total = planes[0]?.length ?? 0;
  const frames: Uint8Array[] = [];
  for (let start = 0, number = 0; start < total; start += settings.blockSize, number += 1) {
    const slices = planes.map((plane) => plane.subarray(start, start + settings.blockSize));
    const frame = encoder.value.encodeFrame(slices, number);
    if (!frame.ok) throw new Error(frame.failures[0].summary);
    frames.push(frame.value);
  }
  encoder.value.release();
  const sizes = frames.map((frame) => frame.length);
  const header: number[] = [0x66, 0x4c, 0x61, 0x43];
  // The last metadata block: STREAMINFO, of 34 bytes.
  header.push(0x80, 0, 0, 34);
  const bigEndian = (value: bigint, bytes: number): void => {
    for (let index = bytes - 1; index >= 0; index -= 1) {
      header.push(Number((value >> BigInt(index * 8)) & 0xffn));
    }
  };
  bigEndian(BigInt(settings.blockSize), 2);
  bigEndian(BigInt(settings.blockSize), 2);
  bigEndian(BigInt(Math.min(...sizes)), 3);
  bigEndian(BigInt(Math.max(...sizes)), 3);
  // Rate (20 bits), channels less one (3), bits less one (5), total samples (36).
  bigEndian(
    (BigInt(settings.sampleRate) << 44n) |
      (BigInt(settings.channels - 1) << 41n) |
      (BigInt(settings.bitsPerSample - 1) << 36n) |
      BigInt(total),
    8,
  );
  header.push(...new Array<number>(16).fill(0));
  return new Uint8Array([...header, ...frames.flatMap((frame) => [...frame])]);
}

const STEREO_16: FlacFrameSettings = {
  channels: 2,
  bitsPerSample: 16,
  sampleRate: 44_100,
  blockSize: 4_096,
  level: 5,
};

/** Every frame a session decodes, one plane per channel. */
function decodeAll(session: DecoderSession, channels: number): Float32Array[] | string {
  const block = Array.from({ length: channels }, () => new Float32Array(1_000));
  const planes: number[][] = Array.from({ length: channels }, () => []);
  for (;;) {
    const decoded = session.decode(block);
    if (!decoded.ok) return decoded.failures[0].code;
    if (decoded.value === 0) return planes.map((plane) => Float32Array.from(plane));
    block.forEach((plane, channel) => {
      planes[channel]?.push(...plane.subarray(0, decoded.value));
    });
  }
}

describe('a decode session', () => {
  it('returns the FLAC frames the runtime encodes bit for bit, and describes the stream', async () => {
    const module = await codecModule();
    const planes = [signal(20_000, 3, 16, 1), signal(20_000, 5, 16, 2)];
    const reads: number[] = [];
    const file = flacStream(module, STEREO_16, planes);
    const opened = module.openDecoder(memoryBytes(file, reads));
    if (!opened.ok) throw new Error(opened.failures[0].summary);
    const session = opened.value;
    expect(session.description).toMatchObject({
      codec: 'flac',
      container: 'flac',
      sampleRate: 44_100,
      channelCount: 2,
      layout: { kind: 'speakers', mask: 0b11 },
      totalFrames: 20_000,
      bitsPerSample: 16,
      decodable: true,
    });
    expect(session.description.codecConfig.length).toBe(34);
    const decoded = decodeAll(session, 2);
    if (typeof decoded === 'string') throw new Error(decoded);
    decoded.forEach((plane, channel) => {
      expect(Int32Array.from(plane, (sample) => sample * 32_768)).toEqual(planes[channel]);
    });
    // Read through ranged reads, never past the file.
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((offset) => offset < file.length)).toBe(true);
    session.release();
  });

  it('returns 32-bit FLAC frames the runtime encodes within a float sample of each', async () => {
    const module = await codecModule();
    const settings: FlacFrameSettings = { ...STEREO_16, bitsPerSample: 32, level: 8 };
    const planes = [
      signal(9_000, 3, 32, 1),
      Int32Array.from({ length: 9_000 }, (_, frame) =>
        frame % 2 === 0 ? -(2 ** 31) : 2 ** 31 - 1,
      ),
    ];
    const opened = module.openDecoder(memoryBytes(flacStream(module, settings, planes)));
    if (!opened.ok) throw new Error(opened.failures[0].summary);
    const session = opened.value;
    expect(session.description).toMatchObject({ bitsPerSample: 32, totalFrames: 9_000 });
    const decoded = decodeAll(session, 2);
    if (typeof decoded === 'string') throw new Error(decoded);
    // A decoded sample is a float of 24 significant bits, so it is within
    // 2^7 of the 32-bit sample it was.
    decoded.forEach((plane, channel) => {
      const original = planes[channel] ?? new Int32Array(0);
      expect(plane.length).toBe(original.length);
      const furthest = plane.reduce(
        (worst, sample, frame) =>
          Math.max(worst, Math.abs(sample * 2 ** 31 - (original[frame] ?? 0))),
        0,
      );
      expect(furthest).toBeLessThanOrEqual(2 ** 7);
    });
    session.release();
  });

  it('refuses a call after release, and a second release does nothing', async () => {
    const module = await codecModule();
    const opened = module.openDecoder(
      memoryBytes(
        flacStream(module, STEREO_16, [signal(5_000, 1, 16, 1), signal(5_000, 1, 16, 2)]),
      ),
    );
    if (!opened.ok) throw new Error(opened.failures[0].summary);
    opened.value.release();
    opened.value.release();
    const decoded = opened.value.decode([new Float32Array(10), new Float32Array(10)]);
    expect(decoded.ok ? undefined : decoded.failures[0].code).toBe('codec-runtime.released');
  });

  it('refuses planes that are not one per channel of one length', async () => {
    const module = await codecModule();
    const opened = module.openDecoder(
      memoryBytes(
        flacStream(module, STEREO_16, [signal(5_000, 1, 16, 1), signal(5_000, 1, 16, 2)]),
      ),
    );
    if (!opened.ok) throw new Error(opened.failures[0].summary);
    for (const into of [
      [new Float32Array(10)],
      [new Float32Array(10), new Float32Array(9)],
      [new Float32Array(0), new Float32Array(0)],
    ]) {
      const decoded = opened.value.decode(into);
      expect(decoded.ok ? undefined : decoded.failures[0].code).toBe(
        'codec-runtime.planes-refused',
      );
    }
    opened.value.release();
  });

  it('names why a file cannot be opened or read', async () => {
    const module = await codecModule();
    const failureOf = (bytes: SyncAudioBytes): string | undefined => {
      const opened = module.openDecoder(bytes);
      if (!opened.ok) return opened.failures[0].code;
      const decoded = decodeAll(opened.value, opened.value.description.channelCount);
      opened.value.release();
      return typeof decoded === 'string' ? decoded : undefined;
    };
    expect(failureOf(memoryBytes(new Uint8Array(4_096).fill(7)))).toBe(
      'codec-runtime.unrecognised',
    );
    const file = flacStream(module, STEREO_16, [
      signal(30_000, 1, 16, 1),
      signal(30_000, 1, 16, 2),
    ]);
    const throwing: SyncAudioBytes = {
      size: file.length,
      readInto: (offset, into) => {
        if (offset > 0) throw new DOMException('The file was removed.', 'NotFoundError');
        return memoryBytes(file).readInto(offset, into);
      },
    };
    // The read throws where the file is opened or where it is decoded,
    // whichever first reads past its start.
    const opened = module.openDecoder(throwing);
    const failed = opened.ok
      ? opened.value.decode([new Float32Array(60_000), new Float32Array(60_000)])
      : opened;
    expect(failed.ok ? undefined : failed.failures[0]).toMatchObject({
      code: 'codec-runtime.unreadable',
      details: { cause: 'NotFoundError' },
    });
    if (opened.ok) opened.value.release();
    const shrinking: SyncAudioBytes = {
      size: file.length,
      readInto: (offset, into) => memoryBytes(file.subarray(0, 20_000)).readInto(offset, into),
    };
    expect(failureOf(shrinking)).toBe('codec-runtime.source-changed');
  });

  it('reads an MP3 packet by packet for a decoder elsewhere, and then decodes nothing', async () => {
    const module = await codecModule();
    // MPEG-1 Layer III frames of silence: a header, then zeros.
    const frame = new Uint8Array(417);
    frame.set([0xff, 0xfb, 0x90, 0x00]);
    const file = new Uint8Array(417 * 6);
    for (let index = 0; index < 6; index += 1) file.set(frame, index * 417);
    const opened = module.openDecoder(memoryBytes(file));
    if (!opened.ok) throw new Error(opened.failures[0].summary);
    expect(opened.value.description).toMatchObject({ codec: 'mp3', container: 'mp3' });
    const packets = [];
    for (
      let packet = opened.value.readPacket();
      packet.ok && packet.value !== undefined;
      packet = opened.value.readPacket()
    ) {
      packets.push(packet.value);
    }
    expect(packets).toHaveLength(6);
    expect(packets[0]?.frames).toBe(1_152);
    expect(packets[0]?.data).toEqual(frame);
    const decoded = opened.value.decode([new Float32Array(10), new Float32Array(10)]);
    expect(decoded.ok ? undefined : decoded.failures[0].code).toBe('codec-runtime.refused');
    opened.value.release();
  });
});

describe('a FLAC frame encoder', () => {
  it('refuses settings FLAC does not encode, and frame numbers past 31 bits', async () => {
    const module = await codecModule();
    const codeOf = (settings: FlacFrameSettings): string | undefined => {
      const made = module.createFlacFrameEncoder(settings);
      if (made.ok) made.value.release();
      return made.ok ? undefined : made.failures[0].code;
    };
    expect(codeOf({ ...STEREO_16, channels: 9 })).toBe('codec-runtime.refused');
    expect(codeOf({ ...STEREO_16, bitsPerSample: 3 })).toBe('codec-runtime.refused');
    expect(codeOf({ ...STEREO_16, bitsPerSample: 33 })).toBe('codec-runtime.refused');
    expect(codeOf({ ...STEREO_16, blockSize: 16 })).toBe('codec-runtime.refused');
    expect(codeOf({ ...STEREO_16, sampleRate: 44_100.5 })).toBe('codec-runtime.settings-refused');
    expect(codeOf({ ...STEREO_16, sampleRate: 2 ** 32 + 44_100 })).toBe(
      'codec-runtime.settings-refused',
    );
    const encoder = module.createFlacFrameEncoder(STEREO_16);
    if (!encoder.ok) throw new Error(encoder.failures[0].summary);
    const quiet = [new Int32Array(64), new Int32Array(64)];
    const past = encoder.value.encodeFrame(quiet, 2 ** 31);
    expect(past.ok ? undefined : past.failures[0].code).toBe('codec-runtime.settings-refused');
    const loud = encoder.value.encodeFrame([Int32Array.of(70_000), Int32Array.of(0)], 0);
    expect(loud.ok ? undefined : loud.failures[0].code).toBe('codec-runtime.refused');
    encoder.value.release();
  });
});
