/**
 * The AIFF and AIFF-C writer of exports (ADR-0091, ADR-0093): AIFF's big-endian
 * integer PCM, and AIFF-C's `NONE`, `sowt`, `fl32`, `fl64`, `alaw`, `ulaw` and
 * `ima4`, with the file's metadata and a `CHAN` chunk for a layout the format's
 * default is not, over the streaming write contract.
 *
 * Every size in an IFF file is 32 bits, so the writer knows its head's length
 * from the start and refuses a stream the moment it would pass four gibibytes,
 * naming WAV, whose RF64 form holds it. `ima4` counts whole 64-frame packets in
 * its `COMM` chunk and has no field for a shorter end, so a stream that ends
 * inside a packet ends in silence up to the packet's end, as every `ima4` file
 * does. A compressed type's sample size states the 16 bits it decodes to, as
 * Apple's files state it.
 */

import {
  fail,
  succeed,
  type ChannelLayout,
  type DomainResult,
  type SampleRate,
} from '@audiogubbins/domain';

import { imaEncodingFor } from './adpcm-encoding.js';
import { IMA4_FRAMES } from './adpcm-blocks.js';
import { aiffMetadataChunks } from './aiff-metadata-writing.js';
import { coreAudioLayoutOf, type CoreAudioLayout } from './channel-layouts.js';
import { unwritableFile, writeInvalid } from './codec-failures.js';
import { CHUNK_HEADER_BYTES, FieldWriter, chunkLength, chunkOf } from './field-writer.js';
import { encoderOf } from './frame-encoding.js';
import type { MetadataMap } from './metadata-map.js';
import type { SampleEncoding } from './sample-encoding.js';
import { streamingWriter } from './streaming-writer.js';
import type { OpenedFileWriter } from './wav-file-writer.js';
import type { WrittenChunk } from './written-chunk.js';

/** How an AIFF or AIFF-C export stores its samples. */
export type AiffSampleFormat =
  | {
      readonly kind: 'integer';
      readonly bits: 8 | 16 | 24 | 32;
      /** `little` is AIFF-C's `sowt`; plain AIFF is big-endian alone. */
      readonly byteOrder: 'big' | 'little';
    }
  | { readonly kind: 'float'; readonly bits: 32 | 64 }
  | { readonly kind: 'g711-alaw' | 'g711-ulaw' | 'ima-adpcm' };

/** An AIFF or AIFF-C export. */
export interface AiffWriterSettings {
  readonly container: 'aiff' | 'aifc';
  readonly sampleRate: SampleRate;
  readonly layout: ChannelLayout;
  readonly sampleFormat: AiffSampleFormat;
  readonly metadata: MetadataMap;
}

/** AIFF-C's version chunk's one timestamp, of the specification of 1990. */
const AIFC_VERSION_1 = 0xa2805140;

/** The largest value of a 32-bit size, and the bytes of `SSND`'s offset and block size. */
const LARGEST_SIZE = 0xffffffff;
const SOUND_HEADER_BYTES = 8;

/** The bytes of a `CHAN` chunk's head and of each channel's description. */
const CHANNEL_LAYOUT_BYTES = 12;
const CHANNEL_DESCRIPTION_BYTES = 20;

/** The AIFF-C type, its name and its sample size, of each format. */
function compression(format: AiffSampleFormat): {
  readonly type: string;
  readonly name: string;
  readonly sampleSize: number;
} {
  switch (format.kind) {
    case 'integer':
      return format.byteOrder === 'big'
        ? { type: 'NONE', name: 'not compressed', sampleSize: format.bits }
        : { type: 'sowt', name: 'little-endian', sampleSize: format.bits };
    case 'float':
      return format.bits === 32
        ? { type: 'fl32', name: '32-bit floating point', sampleSize: 32 }
        : { type: 'fl64', name: '64-bit floating point', sampleSize: 64 };
    case 'g711-alaw':
      return { type: 'alaw', name: 'ALaw 2:1', sampleSize: 16 };
    case 'g711-ulaw':
      return { type: 'ulaw', name: 'uLaw 2:1', sampleSize: 16 };
    case 'ima-adpcm':
      return { type: 'ima4', name: 'IMA 4:1', sampleSize: 16 };
  }
}

/** The sample encoding of a format, for `channelCount` channels. */
function aiffEncoding(
  format: AiffSampleFormat,
  sampleRate: number,
  channelCount: number,
): SampleEncoding {
  switch (format.kind) {
    case 'integer':
      return {
        kind: 'integer',
        bits: format.bits,
        bytes: format.bits / 8,
        byteOrder: format.byteOrder,
        signed: true,
      };
    case 'float':
      return {
        kind: 'float',
        bits: format.bits,
        bytes: format.bits === 32 ? 4 : 8,
        byteOrder: 'big',
      };
    case 'ima-adpcm':
      return imaEncodingFor('ima4', sampleRate, channelCount);
    default:
      return { kind: format.kind };
  }
}

/** A whole rate as an 80-bit extended float: its exponent, and its mantissa shifted to the top bit. */
function extendedRate(out: FieldWriter, rate: number): void {
  const exponent = Math.floor(Math.log2(rate));
  out.uint16(16_383 + exponent);
  // A rate below 2^20 shifted to bit 63 leaves the low word clear.
  out.uint32(rate * 2 ** (31 - exponent));
  out.uint32(0);
}

/** A Pascal string, padded so its count byte and characters fill whole words. */
function pascalString(out: FieldWriter, text: string): void {
  out.uint8(text.length);
  out.raw(Array.from(text, (character) => character.charCodeAt(0)));
  if ((text.length + 1) % 2 !== 0) out.uint8(0);
}

/** The `CHAN` chunk of a CoreAudio layout. */
function channelChunk(layout: CoreAudioLayout): WrittenChunk {
  const length = CHANNEL_LAYOUT_BYTES + layout.labels.length * CHANNEL_DESCRIPTION_BYTES;
  return chunkOf('CHAN', length, false, (out) => {
    out.uint32(layout.tag);
    out.uint32(layout.bitmap);
    out.uint32(layout.labels.length);
    // Each description's flags and coordinates are zero: the label alone places the channel.
    for (const label of layout.labels) {
      out.uint32(label);
      out.raw(new Uint8Array(CHANNEL_DESCRIPTION_BYTES - 4));
    }
  });
}

/** Why a container cannot hold a format, or `undefined` where it can. */
function containerProblem(
  container: AiffWriterSettings['container'],
  format: AiffSampleFormat,
): string | undefined {
  if (container === 'aifc') return undefined;
  return format.kind === 'integer' && format.byteOrder === 'big'
    ? undefined
    : 'An AIFF file holds only big-endian integer samples; AIFF-C holds the others.';
}

/** Everything an AIFF head holds but the stream's length, and the bytes it takes. */
interface AiffHead {
  readonly settings: AiffWriterSettings;
  readonly compression: ReturnType<typeof compression>;
  readonly framesPerCount: number;
  readonly commonLength: number;
  readonly chunks: readonly WrittenChunk[];
  readonly length: number;
}

/** The head of `settings`, its `CHAN` chunk and metadata among its chunks. */
function aiffHead(
  settings: AiffWriterSettings,
  framesPerCount: number,
  chunks: readonly WrittenChunk[],
): AiffHead {
  const named = compression(settings.sampleFormat);
  const compressed = settings.container === 'aifc';
  const nameBytes = 1 + named.name.length + ((named.name.length + 1) % 2);
  const commonLength = 18 + (compressed ? 4 + nameBytes : 0);
  const version = compressed ? CHUNK_HEADER_BYTES + 4 : 0;
  const length =
    12 +
    version +
    CHUNK_HEADER_BYTES +
    commonLength +
    chunks.reduce((total, chunk) => total + chunkLength(chunk), 0) +
    CHUNK_HEADER_BYTES +
    SOUND_HEADER_BYTES;
  return { settings, compression: named, framesPerCount, commonLength, chunks, length };
}

/** Writes a head for a stream of `frames` frames in `dataLength` bytes. */
function writeAiffHead(head: AiffHead, frames: number, dataLength: number): Uint8Array {
  const { settings, compression: named } = head;
  const compressed = settings.container === 'aifc';
  const out = new FieldWriter(head.length, false);
  out.code('FORM');
  out.uint32(head.length - CHUNK_HEADER_BYTES + dataLength + (dataLength % 2));
  out.code(compressed ? 'AIFC' : 'AIFF');
  if (compressed) {
    out.chunk(
      chunkOf('FVER', 4, false, (field) => {
        field.uint32(AIFC_VERSION_1);
      }),
    );
  }
  out.chunk(
    chunkOf('COMM', head.commonLength, false, (field) => {
      field.int16(settings.layout.roles.length);
      field.uint32(Math.ceil(frames / head.framesPerCount));
      field.int16(named.sampleSize);
      extendedRate(field, settings.sampleRate);
      if (compressed) {
        field.code(named.type);
        pascalString(field, named.name);
      }
    }),
  );
  for (const chunk of head.chunks) out.chunk(chunk);
  out.code('SSND');
  out.uint32(SOUND_HEADER_BYTES + dataLength);
  out.uint32(0);
  out.uint32(0);
  return out.bytes;
}

/** Opens an AIFF or AIFF-C writer for `settings`, or says why no such file can hold them. */
export function createAiffWriter(settings: AiffWriterSettings): DomainResult<OpenedFileWriter> {
  const { container, sampleFormat, layout } = settings;
  const problem = containerProblem(container, sampleFormat);
  if (problem !== undefined) return fail(writeInvalid(problem));
  const stated = coreAudioLayoutOf(layout);
  if (!stated.ok) return stated;
  const channelCount = layout.roles.length;
  const encoding = aiffEncoding(sampleFormat, settings.sampleRate, channelCount);
  const framesPerCount = encoding.kind === 'ima-adpcm' ? IMA4_FRAMES : 1;
  const metadata = aiffMetadataChunks(settings.metadata);
  const head = aiffHead(settings, framesPerCount, [
    ...(stated.value === undefined ? [] : [channelChunk(stated.value)]),
    ...metadata.chunks,
  ]);
  const writer = streamingWriter({
    order: layout.roles.map((_, index) => index),
    encoder: encoderOf(encoding, channelCount),
    // The form's size field counts everything after it, and odd samples take a pad byte.
    maximumDataLength: LARGEST_SIZE + CHUNK_HEADER_BYTES - head.length - 1,
    maximumFrames: LARGEST_SIZE * framesPerCount,
    tooLong: () =>
      unwritableFile(
        'An AIFF file cannot hold more than four gibibytes; WAV, written as RF64, can.',
      ),
    dropped: metadata.dropped,
    head: ({ frames, dataLength }) => succeed(writeAiffHead(head, frames, dataLength)),
  });
  return succeed({ writer, layout });
}
