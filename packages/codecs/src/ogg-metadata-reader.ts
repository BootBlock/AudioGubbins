/**
 * The metadata of an Ogg Vorbis or Ogg Opus file: the Vorbis comments of its
 * first logical stream (ADR-0093).
 *
 * The stream's first packet names its codec. Opus keeps its comments in the
 * second packet after `OpusTags`, which may be followed by padding; Vorbis
 * keeps them in the second packet after `\x03vorbis`, ending in a framing bit
 * that must be set. A stream of any other codec is refused with its reason,
 * since its comments, if it has any, are laid out otherwise.
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
import { readOggHeaderPackets } from './ogg-header-packets.js';
import { decodeVorbisComment } from './vorbis-comment.js';

const ascii = (text: string): Uint8Array =>
  Uint8Array.from(text, (character) => character.charCodeAt(0));

const OPUS_HEAD = ascii('OpusHead');
const OPUS_TAGS = ascii('OpusTags');
const VORBIS_IDENTIFICATION = ascii('\x01vorbis');
const VORBIS_COMMENT = ascii('\x03vorbis');

const startsWith = (packet: Uint8Array, prefix: Uint8Array): boolean =>
  packet.length >= prefix.length && prefix.every((byte, index) => packet[index] === byte);

/** The metadata of an Ogg file's first stream, Vorbis or Opus. */
export async function readOggMetadata(
  bytes: AudioBytes,
  signal?: CancellationSignal,
): Promise<DomainResult<MetadataMap>> {
  const headers = await readOggHeaderPackets(bytes, 2, signal);
  if (!headers.ok) return headers;
  const [identification = new Uint8Array(), comments = new Uint8Array()] = headers.value;

  let prefix: Uint8Array;
  let framingBit: boolean;
  if (startsWith(identification, OPUS_HEAD)) {
    prefix = OPUS_TAGS;
    framingBit = false;
  } else if (startsWith(identification, VORBIS_IDENTIFICATION)) {
    prefix = VORBIS_COMMENT;
    framingBit = true;
  } else {
    return fail(
      failure(
        'codecs.metadata-unread',
        FailureKind.Rejected,
        "This Ogg file's stream is neither Vorbis nor Opus, whose comments AudioGubbins reads.",
      ),
    );
  }
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
}
