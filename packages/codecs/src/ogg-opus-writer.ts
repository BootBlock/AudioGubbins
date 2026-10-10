/**
 * An Opus stream framed into an Ogg file (RFC 7845).
 *
 * The identification header goes alone on the first page and the comment
 * header, the map's Vorbis comments, on the pages after it, ending on a page of
 * its own; these are the head, since they depend on nothing the encoder says.
 * The audio packets follow with granule positions counting every decoded
 * sample at 48 kHz, the pre-skip included.
 *
 * End trimming: the last page's granule position is the pre-skip plus the
 * frames the encoder was given, so a player discards the encoder's padding.
 * RFC 7845 asks that no more be trimmed than the last packet decodes to, and a
 * trim may not reach back past a page already written, so the last packet is
 * held back until the stream ends, and a stream padded by more than its last
 * packet is refused as one no player can trim exactly.
 *
 * The stream's serial number is fixed, so the same packets and settings give
 * the same file on every machine (ADR-0091).
 */

import { fail, succeed, type DomainFailureResult, type DomainResult } from '@audiogubbins/domain';

import { concatenate } from './byte-writer.js';
import type {
  EncodedStreamLength,
  EncodedStreamWriter,
  FinishedEncodedStream,
} from './encoded-stream-writer.js';
import { invalidEncodedStream, unwritableStream, writerEnded } from './framing-failures.js';
import type { MetadataMap } from './metadata-map.js';
import { OggPageWriter } from './ogg-page-writer.js';
import { encodeOpusHead, opusPacketDuration, type OpusHeadSettings } from './opus-header.js';
import { encodeVorbisComment } from './vorbis-comment.js';

/** The serial number of every Opus stream AudioGubbins writes: `AGOp`. */
const OPUS_SERIAL = 0x41474f70;

const OPUS_TAGS = Uint8Array.from('OpusTags', (character) => character.charCodeAt(0));

/** What an Ogg Opus file states beyond its packets. */
export interface OggOpusSettings extends OpusHeadSettings {
  /** The encoder's name and version, written as the comment header's vendor string. */
  readonly vendor: string;
  readonly metadata: MetadataMap;
}

/** A packet held back until the next one shows it is not the last. */
interface HeldPacket {
  readonly packet: Uint8Array;
  readonly start: number;
  readonly end: number;
}

/** An Ogg Opus file being written. */
export class OggOpusWriter implements EncodedStreamWriter<EncodedStreamLength> {
  private readonly pages: OggPageWriter;
  private readonly head: Uint8Array;
  private readonly settings: OggOpusSettings;
  private readonly dropped: FinishedEncodedStream['dropped'];
  private held: HeldPacket | undefined;
  private decoded = 0;
  private ended = false;

  private constructor(
    settings: OggOpusSettings,
    pages: OggPageWriter,
    head: Uint8Array,
    dropped: FinishedEncodedStream['dropped'],
  ) {
    this.settings = settings;
    this.pages = pages;
    this.head = head;
    this.dropped = dropped;
  }

  /** A writer for a stream of these settings, refused where the header cannot state them. */
  static create(settings: OggOpusSettings): DomainResult<OggOpusWriter> {
    const identification = encodeOpusHead(settings);
    if (!identification.ok) return identification;
    const comments = encodeVorbisComment(settings.metadata, {
      vendor: settings.vendor,
      pictureField: true,
    });
    const pages = new OggPageWriter(OPUS_SERIAL);
    const head = [
      ...pages.addPacket(identification.value, 0),
      ...pages.flush(),
      ...pages.addPacket(concatenate([OPUS_TAGS, comments.bytes]), 0),
      ...pages.flush(),
    ];
    return succeed(new OggOpusWriter(settings, pages, concatenate(head), comments.dropped));
  }

  add(packet: Uint8Array): DomainResult<readonly Uint8Array[]> {
    if (this.ended) return fail(writerEnded());
    const duration = opusPacketDuration(packet);
    if (!duration.ok) return this.failed(duration);
    const start = this.decoded;
    this.decoded += duration.value;
    if (!Number.isSafeInteger(this.decoded)) {
      return this.failed(
        fail(unwritableStream('The Opus stream is longer than an exact granule position.')),
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
    const held = this.held;
    if (held === undefined)
      return fail(invalidEncodedStream('The Opus encoder answered no packet.'));
    const final = this.settings.preSkip + end.inputFrames;
    if (!Number.isSafeInteger(end.inputFrames) || end.inputFrames < 0 || final > held.end) {
      return fail(
        invalidEncodedStream(
          'The Opus packets decode to fewer samples than the encoder was given.',
        ),
      );
    }
    if (final < held.start) {
      return fail(
        invalidEncodedStream(
          "The Opus encoder's padding is longer than its last packet, more than a player trims.",
        ),
      );
    }
    const body = [...this.pages.addPacket(held.packet, final), ...this.pages.flush(true)];
    return succeed({ head: this.head, body, tail: new Uint8Array(), dropped: this.dropped });
  }

  private failed(result: DomainFailureResult): DomainFailureResult {
    this.ended = true;
    return result;
  }
}
