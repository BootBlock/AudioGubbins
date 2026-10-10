/**
 * The metadata of an Ogg Vorbis, Ogg Opus or Ogg FLAC file: the comments and
 * pictures of its first logical stream (ADR-0093).
 *
 * The stream's first packet names its codec, and each codec keeps its
 * metadata its own way. Opus keeps its comments in the second packet after
 * `OpusTags`, which may be followed by padding; Vorbis keeps them in the
 * second packet after `\x03vorbis`, ending in a framing bit that must be set;
 * FLAC keeps its metadata blocks in the header packets after the first
 * (`ogg-flac-headers.ts`). A stream of any other codec is refused with its
 * reason, since its metadata, if it has any, is laid out otherwise.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type CancellationSignal,
  type DomainResult,
} from '@audiogubbins/domain';

import type { AudioBytes } from './audio-bytes.js';
import { malformed } from './codec-failures.js';
import { MetadataGathering } from './metadata-gathering.js';
import type { MetadataMap } from './metadata-map.js';
import { isOggFlac, oggFlacHeadersComplete, readOggFlacHeaders } from './ogg-flac-headers.js';
import { readOggHeaderPackets } from './ogg-header-packets.js';
import { decodeVorbisComment } from './vorbis-comment.js';

const ascii = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const startsWith = (packet: Uint8Array, prefix: Uint8Array): boolean =>
  packet.length >= prefix.length && prefix.every((byte, index) => packet[index] === byte);

/** How one codec's metadata is found in its stream's header packets and read. */
interface OggCodecMetadata {
  /** Whether the stream's first packet is this codec's. */
  readonly identifies: (identification: Uint8Array) => boolean;
  /** Whether the packets read so far hold every header the metadata lies in. */
  readonly complete: (packets: readonly Uint8Array[]) => boolean;
  readonly read: (packets: readonly Uint8Array[]) => DomainResult<MetadataMap>;
}

/**
 * The comment header of a Vorbis or Opus stream: its second packet, after
 * `prefix`, a Vorbis comment block, then, for Vorbis, a framing bit.
 */
function commentHeader(
  identification: Uint8Array,
  prefix: Uint8Array,
  framingBit: boolean,
): OggCodecMetadata {
  return {
    identifies: (first) => startsWith(first, identification),
    complete: (packets) => packets.length >= 2,
    read: ([, comments = new Uint8Array()]) => {
      if (!startsWith(comments, prefix)) {
        return fail(malformed("The Ogg stream's second packet is not its comment header."));
      }
      const gathering = new MetadataGathering();
      const block = comments.subarray(prefix.length);
      const taken = decodeVorbisComment(block, gathering);
      if (!taken.ok) return taken;
      if (framingBit && ((block[taken.value] ?? 0) & 0x01) === 0) {
        return fail(malformed("The Vorbis comment header's framing bit is not set."));
      }
      return succeed(gathering.toMap());
    },
  };
}

/** Each codec whose metadata is read, by its first packet. */
const OGG_CODECS: readonly OggCodecMetadata[] = [
  commentHeader(ascii('OpusHead'), ascii('OpusTags'), false),
  commentHeader(ascii('\x01vorbis'), ascii('\x03vorbis'), true),
  { identifies: isOggFlac, complete: oggFlacHeadersComplete, read: readOggFlacHeaders },
];

/** The codec whose first packet `identification` is, if any is read. */
function codecOf(identification: Uint8Array): OggCodecMetadata | undefined {
  return OGG_CODECS.find((codec) => codec.identifies(identification));
}

/** The metadata of an Ogg file's first stream, Vorbis, Opus or FLAC. */
export async function readOggMetadata(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<MetadataMap>> {
  const headers = await readOggHeaderPackets(
    bytes,
    (packets) => {
      const [first] = packets;
      if (first === undefined) return false;
      // A stream of a codec no entry reads needs no more packets to be refused.
      return codecOf(first)?.complete(packets) ?? true;
    },
    signal,
  );
  if (!headers.ok) return headers;
  const codec = codecOf(headers.value[0] ?? new Uint8Array());
  if (codec === undefined) {
    return fail(
      failure(
        'codecs.metadata-unread',
        FailureKind.Rejected,
        "This Ogg file's stream is not Vorbis, Opus or FLAC, whose metadata AudioGubbins reads.",
      ),
    );
  }
  return codec.read(headers.value);
}
