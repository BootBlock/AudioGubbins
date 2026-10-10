/**
 * Real compressed audio for a test, made by the codec module's own encoders
 * and framed by the codecs' own writers: a FLAC file of given integer
 * samples, and an Ogg Opus file of given float samples. Nothing is stored
 * (REQ-REPO-191); each file is made from its samples as the test runs, so a
 * decode can be compared with exactly what was encoded.
 */

import {
  FlacSampleDigest,
  FlacStreamWriter,
  OggOpusWriter,
  type MetadataMap,
  type OpusChannelMapping,
} from '@audiogubbins/codecs';

import type { CodecModule } from '../codec-module.js';
import type { OpusEncoderSettings } from '../opus-encoder.js';

/** A result's value, or a thrown error naming why there is none. */
function expectValue<T>(
  result: { ok: true; value: T } | { ok: false; failures: readonly { summary: string }[] },
): T {
  if (!result.ok) throw new Error(result.failures[0]?.summary);
  return result.value;
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
  const file = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}

/** What a FLAC file is made with. */
export interface FlacFixture {
  readonly sampleRate: number;
  readonly bitsPerSample: 8 | 12 | 16 | 20 | 24;
  readonly blockSize: number;
  readonly metadata?: MetadataMap;
}

/**
 * A FLAC file of `planes`, one integer plane per channel in FLAC's order, the
 * speaker mask's, encoded by the module's FLAC encoder at level 5.
 */
export function flacFile(
  module: CodecModule,
  planes: readonly Int32Array[],
  fixture: FlacFixture,
): Uint8Array {
  const channels = planes.length;
  const settings = { ...fixture, channels, level: 5 };
  const encoder = expectValue(module.createFlacFrameEncoder(settings));
  const writer = expectValue(
    FlacStreamWriter.create({
      ...fixture,
      channels,
      vendor: 'flacenc',
      metadata: fixture.metadata ?? {},
      keepRiffChunks: false,
    }),
  );
  const total = planes[0]?.length ?? 0;
  const digest = new FlacSampleDigest(fixture.bitsPerSample);
  const body: Uint8Array[] = [];
  for (let start = 0, number = 0; start < total; start += fixture.blockSize, number += 1) {
    const block = planes.map((plane) => plane.subarray(start, start + fixture.blockSize));
    digest.add(block, block[0]?.length ?? 0);
    body.push(...expectValue(writer.add(expectValue(encoder.encodeFrame(block, number)))));
  }
  encoder.release();
  const finished = expectValue(writer.finish({ samples: digest }));
  return joined([finished.head, ...body, ...finished.body, finished.tail]);
}

/** The channel mapping an `OpusHead` states, read from its bytes (RFC 7845, 5.1.1). */
function mappingOf(head: Uint8Array): OpusChannelMapping {
  if (head[18] === 0) return { family: 0 };
  const channels = head[9] ?? 0;
  return {
    family: 1,
    streams: head[19] ?? 0,
    coupledStreams: head[20] ?? 0,
    table: [...head.subarray(21, 21 + channels)],
  };
}

/**
 * An Ogg Opus file of `planes`, one float plane per channel in speaker-mask
 * order at 48 kHz, encoded by the module's Opus encoder.
 */
export function oggOpusFile(
  module: CodecModule,
  planes: readonly Float32Array[],
  settings: Omit<OpusEncoderSettings, 'channels' | 'sampleRate'>,
): Uint8Array {
  const encoder = expectValue(
    module.createOpusEncoder({ ...settings, channels: planes.length, sampleRate: 48_000 }),
  );
  const view = new DataView(encoder.head.buffer, encoder.head.byteOffset);
  const writer = expectValue(
    OggOpusWriter.create({
      channels: planes.length,
      preSkip: encoder.preSkip,
      inputRate: view.getUint32(12, true),
      outputGain: view.getInt16(16, true),
      mapping: mappingOf(encoder.head),
      vendor: 'ropus',
      metadata: {},
    }),
  );
  const total = planes[0]?.length ?? 0;
  const body: Uint8Array[] = [];
  const add = (packets: readonly { readonly bytes: Uint8Array }[]): void => {
    for (const packet of packets) body.push(...expectValue(writer.add(packet.bytes)));
  };
  for (let start = 0; start < total; start += 4_800) {
    add(expectValue(encoder.push(planes.map((plane) => plane.subarray(start, start + 4_800)))));
  }
  add(expectValue(encoder.finish()).packets);
  encoder.release();
  const finished = expectValue(writer.finish({ inputFrames: total }));
  return joined([finished.head, ...body, ...finished.body, finished.tail]);
}
