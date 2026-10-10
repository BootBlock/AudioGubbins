/**
 * The segmentation of one logical stream's packets into Ogg pages (RFC 3533).
 *
 * A packet is laced as segments of 255 bytes and a last one shorter, zero
 * bytes long where the packet is a multiple of 255. Segments fill a page until
 * it holds 255 of them or its body reaches the target, about 4 KiB as libogg
 * makes them, so a long packet continues over pages and a page holds many
 * short ones. A page's granule position is that of the last packet completed
 * on it, and -1 where none is. The first page is marked as the stream's
 * beginning; a caller ends a page at a packet boundary, as headers need, with
 * `flush`, and marks the last page as the stream's end.
 */

import {
  BEGINNING_OF_STREAM,
  CONTINUED_PACKET,
  END_OF_STREAM,
  MAXIMUM_SEGMENTS,
  encodeOggPage,
  type GranulePosition,
} from './ogg-page.js';

/** The body a page is filled to before another is begun, as libogg fills them. */
export const PAGE_TARGET_BYTES = 4_096;

/** The pages of one logical stream, made as its packets are added. */
export class OggPageWriter {
  private readonly serial: number;
  private sequence = 0;
  private lacing: number[] = [];
  private parts: Uint8Array[] = [];
  private bodyBytes = 0;
  private granule: GranulePosition = 'none';
  private continued = false;

  constructor(serial: number) {
    this.serial = serial >>> 0;
  }

  /** The sequence number the next page is given. */
  get nextSequence(): number {
    return this.sequence;
  }

  /**
   * Adds a packet that ends at `granule`, answering the pages it completes. The
   * page it ends on stays open for the packets after it.
   */
  addPacket(packet: Uint8Array, granule: number): Uint8Array[] {
    const pages: Uint8Array[] = [];
    let offset = 0;
    for (;;) {
      if (this.lacing.length === MAXIMUM_SEGMENTS || this.bodyBytes >= PAGE_TARGET_BYTES) {
        pages.push(this.page(0));
        // The page just ended inside this packet where it has bytes left, or where its
        // last segment was full and the zero-length segment that ends it is still to come.
        this.continued = offset > 0;
      }
      const length = Math.min(255, packet.length - offset);
      this.lacing.push(length);
      if (length > 0) this.parts.push(packet.subarray(offset, offset + length));
      this.bodyBytes += length;
      offset += length;
      if (length < 255) break;
    }
    this.granule = granule;
    return pages;
  }

  /**
   * Ends the open page, answering it, or nothing where it holds no segment and
   * the stream is not ending. The stream's end is marked on the page answered,
   * an empty page where the last one has gone already.
   */
  flush(endOfStream = false): Uint8Array[] {
    if (this.lacing.length === 0 && !endOfStream) return [];
    return [this.page(endOfStream ? END_OF_STREAM : 0)];
  }

  private page(flags: number): Uint8Array {
    const headerType =
      flags |
      (this.continued ? CONTINUED_PACKET : 0) |
      (this.sequence === 0 ? BEGINNING_OF_STREAM : 0);
    const body = new Uint8Array(this.bodyBytes);
    let at = 0;
    for (const part of this.parts) {
      body.set(part, at);
      at += part.length;
    }
    const bytes = encodeOggPage({
      headerType,
      granule: this.granule,
      serial: this.serial,
      sequence: this.sequence,
      lacing: Uint8Array.from(this.lacing),
      body,
    });
    this.sequence += 1;
    this.lacing = [];
    this.parts = [];
    this.bodyBytes = 0;
    this.granule = 'none';
    this.continued = false;
    return bytes;
  }
}
