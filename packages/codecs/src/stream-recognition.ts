/**
 * Naming a stream format from its contents (REQ-AUDIO-220): FLAC, MPEG audio,
 * ADTS AAC, Ogg with the codec of its first packet, WebM and Matroska by their
 * EBML DocType, and MPEG-4 by its `ftyp` box.
 *
 * Each is named from a few bytes at a known place, read within bounds: an ID3v2
 * tag in front of FLAC, MP3 or ADTS is stepped over by its stated size, and the
 * frame after it looked for in a bounded window; an Ogg page's first packet
 * lies after a segment table of at most 255 bytes; an EBML header is read to
 * its DocType within its first bytes. The codec is named where these bytes
 * state it, and left unstated where the container states it only further in,
 * as MP4's and Matroska's track lists do, for the decoder to find.
 */

import { succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode, type HeaderSource } from './byte-reading.js';
import type { ContainerId } from './codec-descriptor.js';
import { namedFormat, unnamedFormat, type RecognisedFormat } from './recognised-format.js';

/** The ID3v2 tag's header, and its footer where its flags say it has one. */
const ID3_HEADER_BYTES = 10;
const ID3_FOOTER_FLAG = 0x10;

/** The most ID3v2 tags stepped over in front of the audio: one is usual, a second is seen. */
const MAXIMUM_ID3_TAGS = 4;

/** The bytes after a tag searched for the first frame, past the padding some taggers leave. */
const FRAME_SEARCH_BYTES = 4_096;

/** The bytes of an Ogg page header before its segment table, and the first packet's bytes read. */
const OGG_PAGE_HEADER_BYTES = 27;
const OGG_PACKET_BYTES = 8;

/** The most bytes of an EBML header read for its DocType: far more than any header holds. */
const EBML_HEADER_BYTES = 256;
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const;
const EBML_DOCTYPE_ID = 0x4282;

/** The codecs an Ogg stream's first packet names, by the bytes it begins with. */
const OGG_CODECS: readonly {
  readonly magic: readonly number[];
  readonly format: RecognisedFormat;
}[] = [
  { magic: [0x01, ...bytesOf('vorbis')], format: namedFormat('ogg', 'vorbis') },
  { magic: bytesOf('OpusHead'), format: namedFormat('ogg', 'opus') },
  { magic: [0x7f, ...bytesOf('FLAC')], format: namedFormat('ogg', 'flac') },
  { magic: bytesOf('Speex   '), format: unnamedFormat('ogg', 'Speex') },
  { magic: [0x80, ...bytesOf('theora')], format: unnamedFormat('ogg', 'Theora video') },
];

/** The AAC profiles an ADTS header names; only Low Complexity has a descriptor. */
const ADTS_PROFILES: readonly string[] = ['AAC Main', 'AAC-LC', 'AAC SSR', 'AAC LTP'];

/** The MPEG audio layers a frame header names, by its two layer bits. */
const MPEG_LAYERS: ReadonlyMap<number, RecognisedFormat> = new Map([
  [0b01, namedFormat('mp3', 'mp3')],
  [0b10, unnamedFormat('mp3', 'MPEG Layer II')],
  [0b11, unnamedFormat('mp3', 'MPEG Layer I')],
]);

/** The EBML document types of the containers AudioGubbins names. */
const DOCUMENT_TYPES: ReadonlyMap<string, ContainerId> = new Map([
  ['webm', 'webm'],
  ['matroska', 'matroska'],
]);

function bytesOf(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

/** Whether `bytes` begins, at `offset`, with `magic`. */
function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  return magic.every((byte, index) => bytes[offset + index] === byte);
}

/** The format an MPEG audio or ADTS frame header at `offset` names, or `undefined` where none starts there. */
function frameFormat(bytes: Uint8Array, offset: number): RecognisedFormat | undefined {
  const sync = bytes[offset] ?? 0;
  const flags = bytes[offset + 1] ?? 0;
  const third = bytes[offset + 2] ?? 0;
  if (sync !== 0xff || (flags & 0xe0) !== 0xe0) return undefined;
  const layer = (flags >> 1) & 0b11;
  if (layer === 0) {
    // ADTS: a twelve-bit sync and layer zero, then the profile and a rate index of thirteen at most.
    if ((flags & 0xf0) !== 0xf0 || ((third >> 2) & 0b1111) > 12) return undefined;
    const profile = ADTS_PROFILES[third >> 6] ?? '';
    return profile === 'AAC-LC' ? namedFormat('adts', 'aac-lc') : unnamedFormat('adts', profile);
  }
  const version = (flags >> 3) & 0b11;
  const bitRate = third >> 4;
  const sampleRate = (third >> 2) & 0b11;
  if (version === 0b01 || bitRate === 0xf || sampleRate === 0b11) return undefined;
  return MPEG_LAYERS.get(layer);
}

/** The format an Ogg stream's first page names by its first packet. */
async function oggFormat(
  source: HeaderSource,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<RecognisedFormat>> {
  const header = await source.read(0, Math.min(OGG_PAGE_HEADER_BYTES, source.size), signal);
  if (!header.ok) return header;
  const segments = header.value[OGG_PAGE_HEADER_BYTES - 1] ?? 0;
  const packetAt = OGG_PAGE_HEADER_BYTES + segments;
  const packet = await source.read(
    packetAt,
    Math.max(0, Math.min(OGG_PACKET_BYTES, source.size - packetAt)),
    signal,
  );
  if (!packet.ok) return packet;
  const known = OGG_CODECS.find((codec) => startsWith(packet.value, codec.magic));
  return succeed(known?.format ?? unnamedFormat('ogg', 'a codec AudioGubbins does not know'));
}

/** An EBML variable-length integer at `offset`: its value without the length marker, and its length. */
function variableInteger(
  bytes: Uint8Array,
  offset: number,
  keepMarker: boolean,
): { readonly value: number; readonly length: number } | undefined {
  const first = bytes[offset] ?? 0;
  const length = first === 0 ? 0 : Math.clz32(first) - 23;
  if (length === 0 || length > 8 || offset + length > bytes.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let index = 1; index < length; index += 1)
    value = value * 256 + (bytes[offset + index] ?? 0);
  return { value, length };
}

/** The container an EBML header's DocType names, or `undefined` where it names none AudioGubbins knows. */
function ebmlContainer(header: Uint8Array): ContainerId | undefined {
  const size = variableInteger(header, EBML_MAGIC.length, false);
  if (size === undefined) return undefined;
  const start = EBML_MAGIC.length + size.length;
  const end = Math.min(header.length, start + size.value);
  for (let at = start; at < end;) {
    const id = variableInteger(header, at, true);
    const length = id === undefined ? undefined : variableInteger(header, at + id.length, false);
    if (id === undefined || length === undefined) return undefined;
    const body = at + id.length + length.length;
    if (id.value === EBML_DOCTYPE_ID) {
      return DOCUMENT_TYPES.get(String.fromCharCode(...header.subarray(body, body + length.value)));
    }
    at = body + length.value;
  }
  return undefined;
}

/** The size of an ID3v2 tag whose header is at the start of `bytes`, footer included. */
function id3Size(bytes: Uint8Array): number {
  // The size is four seven-bit bytes, so no byte of it can look like a sync.
  const size = [6, 7, 8, 9].reduce((total, at) => total * 128 + ((bytes[at] ?? 0) & 0x7f), 0);
  return (
    ID3_HEADER_BYTES + size + (((bytes[5] ?? 0) & ID3_FOOTER_FLAG) !== 0 ? ID3_HEADER_BYTES : 0)
  );
}

/**
 * The format of what follows ID3v2 tags: FLAC, or the first MPEG audio or ADTS
 * frame within the search window, or MPEG audio whose layer is unstated where
 * no frame is found, since a tag is MP3's.
 */
async function afterTags(
  source: HeaderSource,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<RecognisedFormat>> {
  let offset = 0;
  for (let tags = 0; tags < MAXIMUM_ID3_TAGS; tags += 1) {
    const window = await source.read(
      offset,
      Math.max(0, Math.min(FRAME_SEARCH_BYTES, source.size - offset)),
      signal,
    );
    if (!window.ok) return window;
    const bytes = window.value;
    if (fourCharacterCode(bytes, 0).startsWith('ID3')) {
      offset += id3Size(bytes);
      continue;
    }
    if (fourCharacterCode(bytes, 0) === 'fLaC') return succeed(namedFormat('flac', 'flac'));
    for (let at = 0; at + 3 <= bytes.length; at += 1) {
      const format = frameFormat(bytes, at);
      if (format !== undefined) return succeed(format);
    }
    break;
  }
  return succeed({ kind: 'audio', container: 'mp3', codec: { kind: 'unstated' } });
}

/**
 * The stream format a file's first bytes name, reading further within the
 * bounds above where the format states its codec there, or `unknown`.
 */
export async function recogniseStream(
  source: HeaderSource,
  head: Uint8Array,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<RecognisedFormat>> {
  const first = fourCharacterCode(head, 0);
  if (first === 'fLaC') return succeed(namedFormat('flac', 'flac'));
  if (first === 'OggS') return await oggFormat(source, signal);
  if (first.startsWith('ID3')) return await afterTags(source, signal);
  if (startsWith(head, EBML_MAGIC)) {
    const header = await source.read(0, Math.min(EBML_HEADER_BYTES, source.size), signal);
    if (!header.ok) return header;
    const container = ebmlContainer(header.value);
    return succeed(
      container === undefined
        ? { kind: 'unknown' }
        : { kind: 'audio', container, codec: { kind: 'unstated' } },
    );
  }
  if (fourCharacterCode(head, 4) === 'ftyp') {
    return succeed({ kind: 'audio', container: 'mp4', codec: { kind: 'unstated' } });
  }
  return succeed(frameFormat(head, 0) ?? { kind: 'unknown' });
}
