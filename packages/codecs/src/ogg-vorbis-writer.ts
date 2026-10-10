/**
 * A Vorbis stream framed into an Ogg file (Vorbis I, appendix A; RFC 3533).
 *
 * libvorbis answers packets: its identification, comment and setup headers,
 * then the audio. The identification header goes alone on the first page; the
 * comment header, written here from the map with the encoder's vendor string,
 * and the setup header go on the pages after it, ending on a page of their
 * own, as the specification requires. The audio packets follow, each page's
 * granule position counting the samples decoded by the end of its last
 * packet: a quarter of the previous packet's block and a quarter of its own,
 * by the mode the packet names (`vorbis-headers.ts`), and nothing for the
 * first.
 *
 * End trimming: the last page's granule position is the frames the encoder
 * was given, so a player discards the encoder's padding. The specification
 * lets the last page state fewer samples than its packets decode to, and no
 * more than the last packet's may be trimmed, so the last packet is held back
 * until the stream ends, and a stream padded by more is refused.
 *
 * The stream's serial number is fixed, so the same packets and settings give
 * the same file on every machine (ADR-0091).
 */

import { fail, succeed, type DomainFailureResult, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { concatenate } from './byte-writer.js';
import type {
  EncodedStreamLength,
  EncodedStreamWriter,
  FinishedEncodedStream,
} from './encoded-stream-writer.js';
import { invalidEncodedStream, unwritableStream, writerEnded } from './framing-failures.js';
import type { MetadataMap, MetadataPart } from './metadata-map.js';
import { decodeText } from './metadata-text.js';
import { OggPageWriter } from './ogg-page-writer.js';
import { encodeVorbisComment } from './vorbis-comment.js';
import {
  VORBIS_HEADER_PREFIX_BYTES,
  VorbisHeaderType,
  isVorbisHeader,
  readVorbisBlockSizes,
  vorbisPacketBlockSize,
  type VorbisBlockSizes,
} from './vorbis-headers.js';

/** The serial number of every Vorbis stream AudioGubbins writes: `AGVo`. */
const VORBIS_SERIAL = 0x4147566f;

/** The header packets, in the order a stream begins with them. */
const HEADER_ORDER = [
  VorbisHeaderType.Identification,
  VorbisHeaderType.Comment,
  VorbisHeaderType.Setup,
] as const;

/** An audio packet held back until the next one shows it is not the last. */
interface HeldPacket {
  readonly packet: Uint8Array;
  readonly start: number;
  readonly end: number;
}

/** An Ogg Vorbis file being written. */
export class OggVorbisWriter implements EncodedStreamWriter<EncodedStreamLength> {
  private readonly metadata: MetadataMap;
  private readonly pages = new OggPageWriter(VORBIS_SERIAL);
  private readonly headers: Uint8Array[] = [];
  private sizes: VorbisBlockSizes | undefined;
  private previousBlock: number | undefined;
  private held: HeldPacket | undefined;
  private decoded = 0;
  private dropped: readonly MetadataPart[] = [];
  private ended = false;

  constructor(metadata: MetadataMap) {
    this.metadata = metadata;
  }

  /** Adds the encoder's next packet, answering the pages it completes. */
  add(packet: Uint8Array): DomainResult<readonly Uint8Array[]> {
    if (this.ended) return fail(writerEnded());
    if (this.sizes === undefined) return this.header(packet);
    const block = vorbisPacketBlockSize(packet, this.sizes);
    if (!block.ok) return this.failed(block);
    const start = this.decoded;
    if (this.previousBlock !== undefined) this.decoded += (this.previousBlock + block.value) / 4;
    this.previousBlock = block.value;
    if (!Number.isSafeInteger(this.decoded)) {
      return this.failed(
        fail(unwritableStream('The Vorbis stream is longer than an exact granule position.')),
      );
    }
    const pages =
      this.held === undefined ? [] : this.pages.addPacket(this.held.packet, this.held.end);
    this.held = { packet: packet.slice(), start, end: this.decoded };
    return succeed(pages);
  }

  finish(end: EncodedStreamLength): DomainResult<FinishedEncodedStream> {
    if (this.ended) return fail(writerEnded());
    this.ended = true;
    if (this.sizes === undefined) {
      return fail(invalidEncodedStream('The Vorbis encoder answered no setup header.'));
    }
    const final = end.inputFrames;
    const held = this.held ?? { packet: undefined, start: 0, end: 0 };
    if (!Number.isSafeInteger(final) || final < 0 || final > held.end) {
      return fail(
        invalidEncodedStream(
          'The Vorbis packets decode to fewer samples than the encoder was given.',
        ),
      );
    }
    if (final < held.start) {
      return fail(
        invalidEncodedStream(
          "The Vorbis encoder's padding is longer than its last packet, more than a player trims.",
        ),
      );
    }
    const last = held.packet === undefined ? [] : this.pages.addPacket(held.packet, final);
    return succeed({
      head: new Uint8Array(),
      body: [...last, ...this.pages.flush(true)],
      tail: new Uint8Array(),
      dropped: this.dropped,
    });
  }

  /** Takes one of the three headers, answering their pages once the third arrives. */
  private header(packet: Uint8Array): DomainResult<readonly Uint8Array[]> {
    const type = HEADER_ORDER[this.headers.length] ?? VorbisHeaderType.Setup;
    if (!isVorbisHeader(packet, type)) {
      return this.failed(
        fail(invalidEncodedStream('The Vorbis stream does not begin with its three headers.')),
      );
    }
    this.headers.push(packet.slice());
    const [identification, comment, setup] = this.headers;
    if (identification === undefined || comment === undefined || setup === undefined) {
      return succeed([]);
    }
    const sizes = readVorbisBlockSizes(identification, setup);
    if (!sizes.ok) return this.failed(sizes);
    const vendor = vendorOf(comment);
    if (vendor === undefined) {
      return this.failed(
        fail(invalidEncodedStream("The Vorbis comment header's vendor string runs past it.")),
      );
    }
    this.sizes = sizes.value;
    const written = encodeVorbisComment(this.metadata, { vendor, pictureField: true });
    this.dropped = written.dropped;
    return succeed([
      ...this.pages.addPacket(identification, 0),
      ...this.pages.flush(),
      // The comment header ends in the framing bit, set.
      ...this.pages.addPacket(
        concatenate([
          comment.subarray(0, VORBIS_HEADER_PREFIX_BYTES),
          written.bytes,
          Uint8Array.of(1),
        ]),
        0,
      ),
      ...this.pages.addPacket(setup, 0),
      ...this.pages.flush(),
    ]);
  }

  private failed(result: DomainFailureResult): DomainFailureResult {
    this.ended = true;
    return result;
  }
}

/** The vendor string of an encoder's comment header, or `undefined` where its length runs past it. */
function vendorOf(comment: Uint8Array): string | undefined {
  const start = VORBIS_HEADER_PREFIX_BYTES + 4;
  if (comment.length < start) return undefined;
  const length = viewOf(comment).getUint32(VORBIS_HEADER_PREFIX_BYTES, true);
  if (length > comment.length - start) return undefined;
  return decodeText(comment.subarray(start, start + length), 'utf-8');
}
