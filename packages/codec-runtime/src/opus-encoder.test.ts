import { describe, expect, it } from 'vitest';

import type { OpusEncoder, OpusEncoderSettings, OpusPacket } from './opus-encoder.js';
import { MAX_OPUS_PACKET_FRAMES } from './opus-packet-decoder.js';
import { codecModule } from './testing/codec-module.js';
import { memoryBytes } from './testing/memory-bytes.js';

/**
 * The signal-to-noise ratio a tone keeps through the encoder at 64 kbit/s a
 * channel, sample for sample against the source: the pre-skip and the end
 * granule must align the two exactly for it to hold.
 */
const SNR_FLOOR_DB = 25;

const STEREO: OpusEncoderSettings = {
  sampleRate: 48_000,
  channels: 2,
  bitRate: 128_000,
  application: 'audio',
  frameDuration: 20,
  complexity: 10,
  rateControl: 'variable',
  inputSampleRate: 44_100,
};

function sine(frames: number, frequency: number, amplitude: number): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, frame) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / 48_000),
  );
}

function snrDb(source: Float32Array, decoded: Float32Array): number {
  let signal = 0;
  let noise = 0;
  source.forEach((sample, index) => {
    signal += sample * sample;
    noise += (sample - (decoded[index] ?? 0)) ** 2;
  });
  return 10 * Math.log10(signal / noise);
}

/** The CRC of an Ogg page: polynomial 0x04c11db7, unreflected, from zero. */
function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000_0000 ? (crc << 1) ^ 0x04c1_1db7 : crc << 1) >>> 0;
    }
  }
  return crc;
}

/** One Ogg page of whole packets. */
function oggPage(
  sequence: number,
  granule: number,
  flags: number,
  packets: Uint8Array[],
): Uint8Array {
  const lacing = packets.flatMap((packet) => [
    ...new Array<number>(Math.floor(packet.length / 255)).fill(255),
    packet.length % 255,
  ]);
  const header = new Uint8Array(27 + lacing.length);
  const view = new DataView(header.buffer);
  header.set([0x4f, 0x67, 0x67, 0x53, 0, flags]);
  view.setBigUint64(6, BigInt(granule), true);
  view.setUint32(14, 0x5eed, true);
  view.setUint32(18, sequence, true);
  header[26] = lacing.length;
  header.set(lacing, 27);
  const page = new Uint8Array([...header, ...packets.flatMap((packet) => [...packet])]);
  new DataView(page.buffer).setUint32(22, oggCrc(page), true);
  return page;
}

/**
 * An Ogg Opus file of the encoder's packets, its granule positions as
 * RFC 7845 asks: the pre-skip and every frame of each page's packets, and the
 * end granule on the last page.
 */
function oggOpus(encoder: OpusEncoder, planes: Float32Array[]): Uint8Array {
  const packets: OpusPacket[] = [];
  const blocks = [100, 2_000, 777];
  for (let start = 0, index = 0; start < (planes[0]?.length ?? 0); index += 1) {
    const end = start + (blocks[index % blocks.length] ?? 1);
    const pushed = encoder.push(planes.map((plane) => plane.subarray(start, end)));
    if (!pushed.ok) throw new Error(pushed.failures[0].summary);
    packets.push(...pushed.value);
    start = end;
  }
  const finished = encoder.finish();
  if (!finished.ok) throw new Error(finished.failures[0].summary);
  packets.push(...finished.value.packets);
  const tags = new TextEncoder().encode('OpusTags\u0008\0\0\0testcase\0\0\0\0');
  const pages = [oggPage(0, 0, 0x02, [encoder.head]), oggPage(1, 0, 0, [tags])];
  let granule = encoder.preSkip;
  for (let start = 0; start < packets.length; start += 10) {
    const page = packets.slice(start, start + 10);
    granule += page.reduce((sum, packet) => sum + packet.frames, 0);
    const last = start + 10 >= packets.length;
    pages.push(
      oggPage(
        pages.length,
        last ? finished.value.endGranule : granule,
        last ? 0x04 : 0,
        page.map((packet) => packet.bytes),
      ),
    );
  }
  return new Uint8Array(pages.flatMap((page) => [...page]));
}

describe('an Opus encoder', () => {
  it('gives packets that decode through Ogg to every frame given, aligned, above the floor', async () => {
    const module = await codecModule();
    const encoder = module.createOpusEncoder(STEREO);
    if (!encoder.ok) throw new Error(encoder.failures[0].summary);
    expect(new TextDecoder().decode(encoder.value.head.subarray(0, 8))).toBe('OpusHead');
    expect(encoder.value.head.length).toBe(19);
    expect(encoder.value.preSkip).toBe(312);
    const frames = 48_123;
    const planes = [sine(frames, 997, 0.5), sine(frames, 440, 0.4)];
    const file = oggOpus(encoder.value, planes);
    encoder.value.release();

    const opened = module.openDecoder(memoryBytes(file));
    if (!opened.ok) throw new Error(opened.failures[0].summary);
    expect(opened.value.description).toMatchObject({
      codec: 'opus',
      container: 'ogg',
      sampleRate: 48_000,
      totalFrames: frames,
      priming: 312,
    });
    const decoded = [new Float32Array(frames), new Float32Array(frames)];
    let at = 0;
    const block = [new Float32Array(4_096), new Float32Array(4_096)];
    for (
      let got = opened.value.decode(block);
      got.ok && got.value > 0;
      got = opened.value.decode(block)
    ) {
      decoded.forEach((plane, channel) => {
        plane.set(block[channel]?.subarray(0, got.value) ?? [], at);
      });
      at += got.value;
    }
    opened.value.release();
    expect(at).toBe(frames);
    decoded.forEach((plane, channel) => {
      expect(snrDb(planes[channel] ?? plane, plane)).toBeGreaterThan(SNR_FLOOR_DB);
    });
  });

  it('gives the same packets for the same samples and settings', async () => {
    const module = await codecModule();
    const encode = (): Uint8Array => {
      const encoder = module.createOpusEncoder(STEREO);
      if (!encoder.ok) throw new Error(encoder.failures[0].summary);
      const file = oggOpus(encoder.value, [sine(9_600, 997, 0.5), sine(9_600, 440, 0.4)]);
      encoder.value.release();
      return file;
    };
    expect(encode()).toEqual(encode());
  });

  it('refuses settings Opus does not encode', async () => {
    const module = await codecModule();
    const codeOf = (settings: OpusEncoderSettings): string | undefined => {
      const made = module.createOpusEncoder(settings);
      if (made.ok) made.value.release();
      return made.ok ? undefined : made.failures[0].code;
    };
    expect(codeOf({ ...STEREO, channels: 9 })).toBe('codec-runtime.refused');
    expect(codeOf({ ...STEREO, bitRate: 100 })).toBe('codec-runtime.refused');
    expect(codeOf({ ...STEREO, complexity: 11 })).toBe('codec-runtime.refused');
    expect(codeOf({ ...STEREO, channels: 1.5 })).toBe('codec-runtime.settings-refused');
    const encoder = module.createOpusEncoder(STEREO);
    if (!encoder.ok) throw new Error(encoder.failures[0].summary);
    const pushed = encoder.value.push([new Float32Array(10)]);
    expect(pushed.ok ? undefined : pushed.failures[0].code).toBe('codec-runtime.planes-refused');
    encoder.value.release();
    const after = encoder.value.finish();
    expect(after.ok ? undefined : after.failures[0].code).toBe('codec-runtime.released');
  });
});

describe('an Opus packet decoder', () => {
  it('decodes packets the encoder gives, states its range coder, and conceals a lost packet', async () => {
    const module = await codecModule();
    const encoder = module.createOpusEncoder({ ...STEREO, channels: 1 });
    const decoder = module.createOpusPacketDecoder(1);
    if (!encoder.ok || !decoder.ok) throw new Error('made');
    const pushed = encoder.value.push([sine(9_600, 440, 0.5)]);
    if (!pushed.ok) throw new Error(pushed.failures[0].summary);
    const into = [new Float32Array(MAX_OPUS_PACKET_FRAMES)];
    for (const packet of pushed.value) {
      const decoded = decoder.value.decode(packet.bytes, into);
      expect(decoded.ok ? decoded.value : decoded.failures[0].code).toBe(960);
    }
    expect(decoder.value.finalRange()).toBeGreaterThanOrEqual(0);
    const lost = decoder.value.decode(new Uint8Array(0), into);
    expect(lost.ok ? lost.value : lost.failures[0].code).toBe(960);
    const short = decoder.value.decode(pushed.value[0]?.bytes ?? new Uint8Array(1), [
      new Float32Array(960),
    ]);
    expect(short.ok ? undefined : short.failures[0].code).toBe('codec-runtime.planes-refused');
    encoder.value.release();
    decoder.value.release();
    expect(decoder.value.finalRange()).toBe(-1);
  });
});
