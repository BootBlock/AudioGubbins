/**
 * The sample table of an M4A file's one audio track (ISO/IEC 14496-12, section
 * 8.5): the `mp4a` sample entry with its decoder configuration, and every
 * access unit's duration, size and place, the units grouped about a second's
 * worth to a chunk.
 */

import { elementaryStreamDescriptor, type AacConfig } from './aac-config.js';
import { ByteWriter } from './byte-writer.js';
import { box, fullBox } from './mp4-box.js';
import type { SizeList } from './size-list.js';

/** The access units of an AAC stream, as the writer gathered them. */
export interface Mp4AudioStream {
  readonly config: AacConfig;

  /** The AudioSpecificConfig the encoder answered. */
  readonly audioSpecificConfig: Uint8Array;
  readonly sizes: SizeList;
  readonly dataBytes: number;
}

/** The `mp4a` sample entry, with the decoder configuration and its rates. */
function sampleEntry(stream: Mp4AudioStream): Uint8Array {
  const { sampleRate, channels, frameLength } = stream.config;
  const { sizes } = stream;
  let largest = 0;
  let maximumBits = 0;
  const perSecond = Math.max(1, Math.round(sampleRate / frameLength));
  let windowBytes = 0;
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes.at(index);
    largest = Math.max(largest, size);
    windowBytes += size - (index >= perSecond ? sizes.at(index - perSecond) : 0);
    maximumBits = Math.max(maximumBits, windowBytes * 8);
  }
  const seconds = (sizes.length * frameLength) / sampleRate;
  const entry = new ByteWriter()
    .zeros(6)
    .u16(1)
    .zeros(8)
    .u16(channels)
    .u16(16)
    .u16(0)
    .u16(0)
    // The rate as 16.16 fixed point, where it fits; past it the media's timescale states it.
    .u32(sampleRate <= 0xffff ? sampleRate * 65_536 : 0)
    .toBytes();
  const esds = fullBox(
    'esds',
    0,
    0,
    elementaryStreamDescriptor(stream.audioSpecificConfig, {
      bufferBytes: largest,
      maximumBitrate: maximumBits,
      averageBitrate: Math.round((stream.dataBytes * 8) / seconds),
    }),
  );
  return box('mp4a', entry, esds);
}

/** `stsc`, `stsz` and the chunk offsets, the first unit at `base`, 64-bit where `wide`. */
function chunkBoxes(stream: Mp4AudioStream, base: number, wide: boolean): readonly Uint8Array[] {
  const { sampleRate, frameLength } = stream.config;
  const { sizes } = stream;
  const units = sizes.length;
  const perChunk = Math.max(1, Math.ceil(sampleRate / frameLength));
  const chunks = Math.ceil(units / perChunk);
  const remainder = units - (chunks - 1) * perChunk;

  const stsc = new ByteWriter().u32(remainder === perChunk || chunks === 1 ? 1 : 2);
  stsc
    .u32(1)
    .u32(chunks === 1 ? remainder : perChunk)
    .u32(1);
  if (chunks > 1 && remainder !== perChunk) stsc.u32(chunks).u32(remainder).u32(1);

  const stsz = new ByteWriter().u32(0).u32(units);
  const offsets = new ByteWriter().u32(chunks);
  let offset = base;
  for (let index = 0; index < units; index += 1) {
    if (index % perChunk === 0) {
      if (wide) offsets.u64(offset);
      else offsets.u32(offset);
    }
    const size = sizes.at(index);
    stsz.u32(size);
    offset += size;
  }
  return [
    fullBox('stsc', 0, 0, stsc.toBytes()),
    fullBox('stsz', 0, 0, stsz.toBytes()),
    fullBox(wide ? 'co64' : 'stco', 0, 0, offsets.toBytes()),
  ];
}

/** The `stbl` box of the stream, its first unit at `base`, its chunk offsets 64-bit where `wide`. */
export function sampleTableBox(stream: Mp4AudioStream, base: number, wide: boolean): Uint8Array {
  const timing = new ByteWriter().u32(1).u32(stream.sizes.length).u32(stream.config.frameLength);
  return box(
    'stbl',
    fullBox('stsd', 0, 0, new ByteWriter().u32(1).toBytes(), sampleEntry(stream)),
    fullBox('stts', 0, 0, timing.toBytes()),
    ...chunkBoxes(stream, base, wide),
  );
}
