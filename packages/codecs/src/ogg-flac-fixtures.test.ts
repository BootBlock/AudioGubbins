/**
 * Ogg FLAC's metadata (ADR-0093): the blocks a FLAC writer makes, mapped into
 * Ogg as the FLAC-to-Ogg mapping lays them, read back through the Ogg
 * metadata reader to the map the native FLAC reader reads from the same
 * blocks, and the header packets it refuses.
 */

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { describe, expect, it } from 'vitest';

import { concatenate } from './byte-writer.js';
import { readFlacMetadata } from './flac-metadata-reader.js';
import { FlacSampleDigest } from './flac-sample-digest.js';
import { FlacStreamWriter } from './flac-stream-writer.js';
import type { MetadataMap } from './metadata-map.js';
import { OggPageWriter } from './ogg-page-writer.js';
import { readOggMetadata } from './ogg-metadata-reader.js';
import {
  frames,
  fullMetadata,
  memoryBytes,
  oggFlacFile,
  type OggFlacFrame,
} from './testing/index.js';

const crc8 = (bytes: Uint8Array) => {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
};

/** A frame of a 4,096-sample block of 16-bit stereo at 48 kHz, numbered `number`, and filler. */
const flacFrame = (number: number): OggFlacFrame => {
  const header = Uint8Array.of(0xff, 0xf8, 0xca, 0x18, number);
  const bytes = new Uint8Array(header.length + 31);
  bytes.set(header);
  bytes[header.length] = crc8(header);
  return { bytes, samples: 4_096 };
};

/** Every part FLAC holds: the comments, the cover, and the WAV chunks' loops, cues and tuning. */
const METADATA: MetadataMap = {
  ...fullMetadata(),
  loops: [
    { start: frames(100), length: frames(1_000), playCount: 'endless', direction: 'forward' },
    { start: frames(2_000), length: frames(500), playCount: 3, direction: 'alternating' },
  ],
  cues: [{ position: frames(10), name: 'Attack' }],
  tuning: { unityNote: 62, fineTuneCents: -12 },
};

/** A native FLAC file of two frames and `metadata`, and its head and frames apart. */
function nativeFlac(metadata: MetadataMap) {
  const writer = expectSuccess(
    FlacStreamWriter.create({
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 16,
      blockSize: 4_096,
      vendor: 'flacenc',
      metadata,
      keepRiffChunks: true,
    }),
  );
  const audio = [flacFrame(0), flacFrame(1)];
  for (const frame of audio) expectSuccess(writer.add(frame.bytes));
  const digest = new FlacSampleDigest(16);
  digest.add([new Int32Array(8_192), new Int32Array(8_192)], 8_192);
  const { head } = expectSuccess(writer.finish({ samples: digest }));
  const file = new Uint8Array(head.length + audio.reduce((sum, one) => sum + one.bytes.length, 0));
  file.set(head);
  let at = head.length;
  for (const frame of audio) {
    file.set(frame.bytes, at);
    at += frame.bytes.length;
  }
  return { head, audio, file };
}

/** The `index`th metadata block of a FLAC head, as its bytes. */
function blockAt(head: Uint8Array, index: number): Uint8Array {
  let offset = 4;
  for (let at = 0; ; at += 1) {
    const length = new DataView(head.buffer, head.byteOffset + offset).getUint32(0) & 0xffffff;
    if (at === index) return head.subarray(offset, offset + 4 + length);
    offset += 4 + length;
  }
}

describe('Ogg FLAC metadata', () => {
  it('reads every block the native reader reads, to the same map', async () => {
    const { head, audio, file } = nativeFlac(METADATA);
    const native = expectSuccess(await readFlacMetadata(memoryBytes(file)));
    const ogg = expectSuccess(await readOggMetadata(memoryBytes(oggFlacFile(head, audio))));
    expect(ogg).toEqual(native);
    expect(ogg.text).toEqual(METADATA.text);
    expect(ogg.coverArt).toEqual(METADATA.coverArt);
    expect(ogg.loops).toEqual(METADATA.loops);
    expect(ogg.cues).toEqual(METADATA.cues);
    expect(ogg.tuning).toEqual(METADATA.tuning);
  });

  it('reads a stream whose first packet leaves its count of headers unstated', async () => {
    const { head, audio } = nativeFlac(METADATA);
    const map = expectSuccess(await readOggMetadata(memoryBytes(oggFlacFile(head, audio, 0))));
    expect(map.text?.title).toBe(METADATA.text?.title);
  });

  it('reads a stream of its stream information alone as no metadata', async () => {
    const { head, audio } = nativeFlac({});
    const streamInfo = blockAt(head, 0).slice();
    streamInfo[0] = 0x80;
    const only = new Uint8Array(4 + streamInfo.length);
    only.set([0x66, 0x4c, 0x61, 0x43]);
    only.set(streamInfo, 4);
    expect(expectSuccess(await readOggMetadata(memoryBytes(oggFlacFile(only, audio))))).toEqual({});
  });

  it('refuses a count of headers its last block disagrees with', async () => {
    const { head, audio } = nativeFlac(METADATA);
    const file = oggFlacFile(head, audio, 2);
    expect(expectFailureCode(await readOggMetadata(memoryBytes(file)))).toBe('codecs.malformed');
  });

  it('refuses headers that end without a last block, reading the frame after them as one', async () => {
    const { head, audio } = nativeFlac(METADATA);
    const unflagged = head.slice();
    // The last block's flag is the first byte of the block before the padding's end.
    let offset = 4;
    for (;;) {
      const length = new DataView(unflagged.buffer, offset).getUint32(0) & 0xffffff;
      if ((unflagged[offset] ?? 0) & 0x80) {
        unflagged[offset] = (unflagged[offset] ?? 0) & 0x7f;
        break;
      }
      offset += 4 + length;
    }
    const file = oggFlacFile(unflagged, audio, 0);
    expect(expectFailureCode(await readOggMetadata(memoryBytes(file)))).toBe('codecs.malformed');
    // Counted, the headers end at their count, still without a last block.
    const counted = await readOggMetadata(memoryBytes(oggFlacFile(unflagged, [])));
    expect(counted.ok ? undefined : counted.failures[0].summary).toBe(
      "The Ogg FLAC stream's headers end without a last metadata block.",
    );
  });

  it('refuses a first packet of another version of the mapping, or without its marker', async () => {
    const { head } = nativeFlac({ text: { title: 'One' } });
    const comments = blockAt(head, 1).slice();
    comments[0] = (comments[0] ?? 0) | 0x80;
    const versioned = firstPacket(blockAt(head, 0), 1);
    versioned[5] = 2;
    const unmarked = firstPacket(blockAt(head, 0), 1);
    unmarked[9] = 0x46;
    for (const first of [versioned, unmarked]) {
      const read = await readOggMetadata(memoryBytes(oggStream([first, comments])));
      expect(expectFailureCode(read)).toBe('codecs.malformed');
    }
  });

  it('refuses a header packet that holds other than one block', async () => {
    const { head } = nativeFlac({ text: { title: 'One' } });
    const comments = blockAt(head, 1);
    // The comments, flagged last, and a byte past the block their header states.
    const longer = new Uint8Array(comments.length + 1);
    longer.set(comments);
    longer[0] = (longer[0] ?? 0) | 0x80;
    const file = oggStream([firstPacket(blockAt(head, 0), 1), longer]);
    expect(expectFailureCode(await readOggMetadata(memoryBytes(file)))).toBe('codecs.malformed');
  });
});

/** The first packet of the mapping: its signature, version 1.0, the count, `fLaC` and the stream information. */
function firstPacket(streamInfo: Uint8Array, headers: number): Uint8Array {
  const packet = new Uint8Array(13 + streamInfo.length);
  packet.set([0x7f, 0x46, 0x4c, 0x41, 0x43, 1, 0, 0, headers, 0x66, 0x4c, 0x61, 0x43]);
  packet.set(streamInfo, 13);
  return packet;
}

/** An Ogg stream of these packets, the first alone on its page. */
function oggStream(packets: readonly Uint8Array[]): Uint8Array {
  const pages = new OggPageWriter(7);
  const [first = new Uint8Array(), ...rest] = packets;
  const out = [...pages.addPacket(first, 0), ...pages.flush()];
  for (const packet of rest) out.push(...pages.addPacket(packet, 0));
  out.push(...pages.flush(true));
  return concatenate(out);
}
