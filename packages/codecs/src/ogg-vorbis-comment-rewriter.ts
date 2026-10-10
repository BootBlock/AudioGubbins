/**
 * The map's metadata written into an Ogg Vorbis stream an encoder made whole,
 * without decoding it (ADR-0091, ADR-0093).
 *
 * libvorbis answers a complete Ogg stream with its own comment header. The
 * rewriter takes that stream's bytes in pieces of any size, reads its three
 * header packets, and writes them again with the map's comments in place of
 * the encoder's, keeping its vendor string: the identification header alone on
 * the first page and the comment and setup headers on the pages after it,
 * ending on a page of their own, as the Vorbis specification requires. Every
 * audio page then follows as it was, with its granule position, its flags and
 * its packets unchanged, renumbered after the new header pages and given a new
 * checksum. A page that ends the setup header and begins audio is cut after
 * the header, its audio segments kept on a page of their own with its granule
 * position.
 *
 * Only one logical stream is read: a chained or multiplexed stream is not what
 * the encoder makes, and is refused.
 */

import { fail, succeed, type DomainFailureResult, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { concatenate } from './byte-writer.js';
import type { EncodedStreamWriter, FinishedEncodedStream } from './encoded-stream-writer.js';
import { invalidEncodedStream, writerEnded } from './framing-failures.js';
import { MAXIMUM_METADATA_BYTES } from './metadata-limits.js';
import type { MetadataMap, MetadataPart } from './metadata-map.js';
import { decodeUtf8 } from './metadata-text.js';
import {
  BEGINNING_OF_STREAM,
  END_OF_STREAM,
  OGG_HEADER_BYTES,
  encodeOggPage,
  lacedLength,
  readOggPage,
  readOggPageHeader,
  type OggPage,
} from './ogg-page.js';
import { OggPageWriter } from './ogg-page-writer.js';
import { encodeVorbisComment } from './vorbis-comment.js';

/** Each header packet's type byte and `vorbis`, in order. */
const HEADER_PREFIXES: readonly Uint8Array[] = [1, 3, 5].map((type) =>
  Uint8Array.from([type, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]),
);

const PREFIX_BYTES = 7;

const COMMENT_PREFIX = Uint8Array.from([3, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);

const startsWith = (packet: Uint8Array, prefix: Uint8Array | undefined): boolean =>
  prefix !== undefined &&
  packet.length >= prefix.length &&
  prefix.every((byte, index) => packet[index] === byte);

/** Where the rewriter is in the stream. */
type Phase = 'headers' | 'audio' | 'ended';

/** An Ogg Vorbis stream being given the map's comments. */
export class OggVorbisCommentRewriter implements EncodedStreamWriter<undefined> {
  private readonly metadata: MetadataMap;
  private phase: Phase = 'headers';
  private started = false;
  private failedOrFinished = false;
  private pending: Uint8Array = new Uint8Array();
  private serial = 0;
  private expectedSequence = 0;
  private sequence = 0;
  private readonly headers: Uint8Array[] = [];
  private open: Uint8Array[] = [];
  private openBytes = 0;
  private dropped: readonly MetadataPart[] = [];

  constructor(metadata: MetadataMap) {
    this.metadata = metadata;
  }

  /** Adds the next bytes of the encoder's stream, answering the pages they complete. */
  add(unit: Uint8Array): DomainResult<readonly Uint8Array[]> {
    if (this.failedOrFinished) return fail(writerEnded());
    this.pending = this.pending.length === 0 ? unit.slice() : concatenate([this.pending, unit]);
    const out: Uint8Array[] = [];
    let offset = 0;
    for (;;) {
      const length = this.pageLength(offset);
      if (length === undefined) break;
      if (!length.ok) return this.failed(length);
      const page = readOggPage(this.pending.subarray(offset, offset + length.value));
      if (!page.ok) return this.failed(page);
      offset += length.value;
      const written = this.page(page.value);
      if (!written.ok) return this.failed(written);
      out.push(...written.value);
    }
    this.pending = this.pending.slice(offset);
    return succeed(out);
  }

  finish(): DomainResult<FinishedEncodedStream> {
    if (this.failedOrFinished) return fail(writerEnded());
    this.failedOrFinished = true;
    if (this.phase !== 'ended' || this.pending.length > 0) {
      return fail(invalidEncodedStream('The Ogg Vorbis stream ends before its last page.'));
    }
    return succeed({
      head: new Uint8Array(),
      body: [],
      tail: new Uint8Array(),
      dropped: this.dropped,
    });
  }

  /** The length of the whole page at `offset`, `undefined` where its bytes have not all arrived. */
  private pageLength(offset: number): DomainResult<number> | undefined {
    if (this.pending.length - offset < OGG_HEADER_BYTES) return undefined;
    const header = readOggPageHeader(this.pending.subarray(offset, offset + OGG_HEADER_BYTES));
    if (!header.ok) return header;
    const lacingEnd = offset + OGG_HEADER_BYTES + header.value.segments;
    if (this.pending.length < lacingEnd) return undefined;
    const length =
      lacingEnd - offset + lacedLength(this.pending.subarray(offset + OGG_HEADER_BYTES, lacingEnd));
    return this.pending.length - offset < length ? undefined : succeed(length);
  }

  /** The pages one page of the encoder's stream becomes. */
  private page(page: OggPage): DomainResult<readonly Uint8Array[]> {
    if (this.phase === 'ended') {
      return fail(invalidEncodedStream('The Ogg Vorbis stream continues after its last page.'));
    }
    if (!this.started) {
      this.started = true;
      if ((page.headerType & BEGINNING_OF_STREAM) === 0) {
        return fail(
          invalidEncodedStream('The Ogg Vorbis stream does not begin with its first page.'),
        );
      }
      this.serial = page.serial;
      this.expectedSequence = page.sequence;
    } else if (page.serial !== this.serial || (page.headerType & BEGINNING_OF_STREAM) !== 0) {
      return fail(
        invalidEncodedStream(
          'The Ogg stream is chained or multiplexed, which an encoder does not make.',
        ),
      );
    }
    if (page.sequence !== this.expectedSequence) {
      return fail(
        invalidEncodedStream('A page of the Ogg Vorbis stream is missing or out of order.'),
      );
    }
    this.expectedSequence = (this.expectedSequence + 1) >>> 0;
    if ((page.headerType & END_OF_STREAM) !== 0) this.phase = 'ended';
    return this.phase === 'audio' || this.headers.length === HEADER_PREFIXES.length
      ? succeed([this.renumbered(page, page.lacing, page.body, page.headerType)])
      : this.headerPage(page);
  }

  /** A page holding header segments: the headers written anew once the third ends, and any audio after it. */
  private headerPage(page: OggPage): DomainResult<readonly Uint8Array[]> {
    let offset = 0;
    for (let segment = 0; segment < page.lacing.length; segment += 1) {
      const length = page.lacing[segment] ?? 0;
      if (this.openBytes + length > MAXIMUM_METADATA_BYTES) {
        return fail(
          invalidEncodedStream('A Vorbis header packet is larger than any encoder writes.'),
        );
      }
      this.open.push(page.body.subarray(offset, offset + length));
      this.openBytes += length;
      offset += length;
      if (length === 255) continue;
      const packet = concatenate(this.open);
      this.open = [];
      this.openBytes = 0;
      if (!startsWith(packet, HEADER_PREFIXES[this.headers.length])) {
        return fail(
          invalidEncodedStream('The Ogg stream does not begin with the three Vorbis headers.'),
        );
      }
      this.headers.push(packet);
      if (this.headers.length === HEADER_PREFIXES.length) {
        const headerPages = this.writeHeaders();
        if (!headerPages.ok) return headerPages;
        const rest = page.lacing.subarray(segment + 1);
        if (rest.length === 0) {
          if (this.phase !== 'ended') this.phase = 'audio';
          return headerPages;
        }
        if (this.phase !== 'ended') this.phase = 'audio';
        // The audio after the setup header starts a packet, so its page continues nothing.
        const flags = page.headerType & END_OF_STREAM;
        return succeed([
          ...headerPages.value,
          this.renumbered(page, rest, page.body.subarray(offset), flags),
        ]);
      }
    }
    if (this.phase === 'ended') {
      return fail(invalidEncodedStream('The Ogg Vorbis stream ends inside its headers.'));
    }
    return succeed([]);
  }

  /** The three headers' pages, the comment header holding the map's comments and the encoder's vendor. */
  private writeHeaders(): DomainResult<readonly Uint8Array[]> {
    const [identification, comment, setup] = this.headers;
    if (identification === undefined || comment === undefined || setup === undefined) {
      return fail(
        invalidEncodedStream('The Ogg stream does not begin with the three Vorbis headers.'),
      );
    }
    const vendor = this.vendorOf(comment);
    if (vendor === undefined) {
      return fail(invalidEncodedStream("The Vorbis comment header's vendor string runs past it."));
    }
    const written = encodeVorbisComment(this.metadata, { vendor, pictureField: true });
    this.dropped = written.dropped;
    const pages = new OggPageWriter(this.serial);
    const out = [
      ...pages.addPacket(identification, 0),
      ...pages.flush(),
      // The comment header ends in the framing bit, set.
      ...pages.addPacket(concatenate([COMMENT_PREFIX, written.bytes, Uint8Array.of(1)]), 0),
      ...pages.addPacket(setup, 0),
      ...pages.flush(),
    ];
    this.sequence = pages.nextSequence;
    return succeed(out);
  }

  /** The vendor string of the encoder's comment header, or `undefined` where its length runs past it. */
  private vendorOf(comment: Uint8Array): string | undefined {
    if (comment.length < PREFIX_BYTES + 4) return undefined;
    const length = viewOf(comment).getUint32(PREFIX_BYTES, true);
    const start = PREFIX_BYTES + 4;
    if (length > comment.length - start) return undefined;
    return decodeUtf8(comment.subarray(start, start + length));
  }

  /** A page of the encoder's stream as it is written, given the next sequence number. */
  private renumbered(
    page: OggPage,
    lacing: Uint8Array,
    body: Uint8Array,
    headerType: number,
  ): Uint8Array {
    const bytes = encodeOggPage({
      headerType,
      granule: page.granule,
      serial: this.serial,
      sequence: this.sequence,
      lacing,
      body,
    });
    this.sequence = (this.sequence + 1) >>> 0;
    return bytes;
  }

  private failed(result: DomainFailureResult): DomainFailureResult {
    this.failedOrFinished = true;
    return result;
  }
}
