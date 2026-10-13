/**
 * The packets of one logical Ogg stream, joined from its pages' segments.
 *
 * A packet ends at its first segment shorter than 255 bytes, and a packet left
 * open at a page's end continues on the next page, which says so in its flags.
 * A page that claims to continue nothing, or that fails to continue an open
 * packet, breaks the stream, as does a packet past the bound the caller sets,
 * so a hostile stream cannot make the assembly hold more than that.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { concatenate } from './byte-writer.js';
import { malformed } from './codec-failures.js';
import { metadataOverBound } from './framing-failures.js';
import { CONTINUED_PACKET, type OggPage } from './ogg-page.js';

/** The packets a page completes, and how they lie within it. */
export interface AssembledPage {
  readonly packets: readonly Uint8Array[];

  /** The segments at the page's start that end a packet begun on an earlier page. */
  readonly continuingSegments: number;
}

/** Packets joined from pages added in order. */
export class OggPacketAssembler {
  private readonly maximumPacketBytes: number;
  private open: Uint8Array[] = [];
  private openBytes = 0;

  /** Whether a packet is open at the end of the last page added, which a full last segment leaves. */
  private packetOpen = false;

  constructor(maximumPacketBytes: number) {
    this.maximumPacketBytes = maximumPacketBytes;
  }

  /** Adds the next page of the stream, answering the packets it completes. */
  add(page: OggPage): DomainResult<AssembledPage> {
    const continues = (page.headerType & CONTINUED_PACKET) !== 0;
    if (continues !== this.packetOpen) {
      return fail(
        malformed(
          continues
            ? 'An Ogg page continues a packet no earlier page began.'
            : 'An Ogg page begins a new packet while the one before it is unfinished.',
        ),
      );
    }
    const packets: Uint8Array[] = [];
    let continuingSegments = -1;
    let offset = 0;
    for (let segment = 0; segment < page.lacing.length; segment += 1) {
      const length = page.lacing[segment] ?? 0;
      if (this.openBytes + length > this.maximumPacketBytes) {
        return fail(metadataOverBound('Ogg packet', this.maximumPacketBytes));
      }
      this.open.push(page.body.subarray(offset, offset + length));
      this.openBytes += length;
      this.packetOpen = true;
      offset += length;
      if (length < 255) {
        packets.push(
          this.open.length === 1 ? (this.open[0] ?? new Uint8Array()) : concatenate(this.open),
        );
        if (continuingSegments < 0 && continues) continuingSegments = segment + 1;
        this.open = [];
        this.openBytes = 0;
        this.packetOpen = false;
      }
    }
    return succeed({
      packets,
      continuingSegments: continues
        ? continuingSegments < 0
          ? page.lacing.length
          : continuingSegments
        : 0,
    });
  }
}
