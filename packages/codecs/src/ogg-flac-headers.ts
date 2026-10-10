/**
 * The metadata of an Ogg FLAC stream, as the FLAC-to-Ogg mapping carries it
 * (ADR-0093).
 *
 * The stream's first packet is `0x7F`, `FLAC`, the mapping's version, the
 * count of header packets after it (0 where unknown), then `fLaC` and the
 * stream information block. Each header packet after it is one metadata
 * block, header and body, the Vorbis comments first, the last flagged as the
 * last; the audio frames follow. The blocks are read into the map by the
 * native FLAC reader's own code (`flac-metadata-gathering.ts`), so an Ogg
 * FLAC file and a FLAC file of the same blocks give the same map.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode, viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { FlacMetadataGathering } from './flac-metadata-gathering.js';
import { FlacBlockType } from './flac-metadata-blocks.js';
import { metadataOverBound } from './framing-failures.js';
import { MAXIMUM_METADATA_FIELDS } from './metadata-limits.js';
import type { MetadataMap } from './metadata-map.js';

/** The first packet's signature: `0x7F` and `FLAC`. */
const SIGNATURE = [0x7f, 0x46, 0x4c, 0x41, 0x43] as const;

/** The mapping's major version this reader reads. */
const MAPPING_MAJOR_VERSION = 1;

/** Where the first packet holds its fields. */
const MAJOR_VERSION_AT = 5;
const HEADER_COUNT_AT = 7;
const NATIVE_MARKER_AT = 9;
const STREAM_INFO_AT = 13;

const BLOCK_HEADER_BYTES = 4;
const STREAM_INFO_BYTES = 34;
const LAST_BLOCK = 0x80;
const RESERVED_BLOCK_TYPE = 127;

/** The first packet's length: its fields, then the stream information block. */
const FIRST_PACKET_BYTES = STREAM_INFO_AT + BLOCK_HEADER_BYTES + STREAM_INFO_BYTES;

/** Whether a stream's first packet is Ogg FLAC's. */
export function isOggFlac(identification: Uint8Array): boolean {
  return SIGNATURE.every((byte, index) => identification[index] === byte);
}

/** Whether a metadata block's header, the first byte of its packet, flags it the last. */
function isLast(packet: Uint8Array | undefined): boolean {
  return ((packet?.[0] ?? 0) & LAST_BLOCK) !== 0;
}

/** The count of header packets after the first that the first states, 0 where unknown. */
function statedHeaderCount(first: Uint8Array): number {
  return first.length >= HEADER_COUNT_AT + 2 ? viewOf(first).getUint16(HEADER_COUNT_AT) : 0;
}

/**
 * Whether the packets read so far hold every header: through the block
 * flagged last, or as many as the first packet counts, whichever comes
 * first, or a first packet too short to say, which reading refuses.
 */
export function oggFlacHeadersComplete(packets: readonly Uint8Array[]): boolean {
  const [first] = packets;
  if (first === undefined) return false;
  if (first.length < FIRST_PACKET_BYTES || isLast(first.subarray(STREAM_INFO_AT))) return true;
  const stated = statedHeaderCount(first);
  return packets.slice(1).some(isLast) || (stated > 0 && packets.length > stated);
}

/** Why the first packet is not the mapping's, or `undefined` where it is. */
function firstPacketProblem(first: Uint8Array): string | undefined {
  if (first.length < FIRST_PACKET_BYTES) return "The Ogg FLAC stream's first packet is too short.";
  if (first[MAJOR_VERSION_AT] !== MAPPING_MAJOR_VERSION) {
    return `The Ogg FLAC stream is of version ${String(first[MAJOR_VERSION_AT])} of its mapping, not 1.`;
  }
  if (fourCharacterCode(first, NATIVE_MARKER_AT) !== 'fLaC') {
    return "The Ogg FLAC stream's first packet lacks FLAC's marker, 'fLaC'.";
  }
  const type = (first[STREAM_INFO_AT] ?? 0) & 0x7f;
  const length = viewOf(first).getUint32(STREAM_INFO_AT) & 0xffffff;
  if (type !== FlacBlockType.StreamInfo || length !== STREAM_INFO_BYTES) {
    return "The Ogg FLAC stream's first packet does not hold one stream information block of 34 bytes.";
  }
  return undefined;
}

/** The metadata of the header packets of an Ogg FLAC stream, `packets[0]` its first. */
export function readOggFlacHeaders(packets: readonly Uint8Array[]): DomainResult<MetadataMap> {
  const [first = new Uint8Array()] = packets;
  const problem = firstPacketProblem(first);
  if (problem !== undefined) return fail(malformed(problem));
  const gathering = new FlacMetadataGathering();
  if (isLast(first.subarray(STREAM_INFO_AT))) return succeed(gathering.toMap());

  const end = packets.findIndex((packet, index) => index > 0 && isLast(packet));
  const stated = statedHeaderCount(first);
  if (end < 0) {
    return fail(malformed("The Ogg FLAC stream's headers end without a last metadata block."));
  }
  if (stated > 0 && stated !== end) {
    return fail(
      malformed(
        `The Ogg FLAC stream counts ${String(stated)} header packets, and its last metadata block is its ${String(end)}th.`,
      ),
    );
  }
  if (end > MAXIMUM_METADATA_FIELDS) {
    return fail(metadataOverBound('count of FLAC metadata blocks', MAXIMUM_METADATA_FIELDS));
  }
  for (const packet of packets.slice(1, end + 1)) {
    const taken = readBlockPacket(packet, gathering);
    if (!taken.ok) return taken;
  }
  return succeed(gathering.toMap());
}

/** Reads one header packet, which holds exactly one metadata block, into the map. */
function readBlockPacket(
  packet: Uint8Array,
  gathering: FlacMetadataGathering,
): DomainResult<undefined> {
  if (packet.length < BLOCK_HEADER_BYTES) {
    return fail(malformed('An Ogg FLAC header packet is too short to hold a metadata block.'));
  }
  const header = viewOf(packet).getUint32(0);
  const type = (header >>> 24) & 0x7f;
  const length = header & 0xffffff;
  if (length !== packet.length - BLOCK_HEADER_BYTES) {
    return fail(malformed('An Ogg FLAC header packet holds other than one metadata block.'));
  }
  if (type === RESERVED_BLOCK_TYPE || type === FlacBlockType.StreamInfo) {
    return fail(
      malformed(
        'An Ogg FLAC header packet holds a block of the reserved type or a second stream information block.',
      ),
    );
  }
  const body = packet.subarray(BLOCK_HEADER_BYTES);
  const applicationId =
    type === FlacBlockType.Application && body.length >= 4 ? fourCharacterCode(body, 0) : undefined;
  return gathering.reads(type, applicationId) ? gathering.add(type, body) : succeed(undefined);
}
