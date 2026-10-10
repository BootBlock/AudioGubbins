/**
 * An MP3 file made from LAME's output (ADR-0091).
 *
 * LAME answers bytes, which the writer reads frame by frame through each
 * frame's header in whatever pieces they arrive, so it never relies on where
 * LAME's buffers end. Its frames are the body. The head is completed at the
 * end: an ID3v2.4 tag of the map, then an information frame stating the frame
 * and byte counts, the table of contents, and the encoder's delay and padding
 * that gapless players trim, all of which only the whole stream shows. An
 * information frame or ID3 tag LAME writes itself is left out, since the head
 * replaces it, and every frame must share the first's version and rate.
 */

import { fail, succeed, type DomainFailureResult, type DomainResult } from '@audiogubbins/domain';

import { concatenate } from './byte-writer.js';
import type {
  EncodedStreamLength,
  EncodedStreamWriter,
  FinishedEncodedStream,
} from './encoded-stream-writer.js';
import { invalidEncodedStream, unwritableStream, writerEnded } from './framing-failures.js';
import { ID3V1_BYTES } from './id3v1-reader.js';
import { ID3V2_HEADER_BYTES, readId3v2Header } from './id3v2-header.js';
import { encodeId3v2 } from './id3v2-writer.js';
import type { MetadataMap } from './metadata-map.js';
import { encodeInfoFrame, lameCrc } from './mp3-info-frame.js';
import { readMpegAudioHeader, type MpegAudioHeader } from './mpeg-audio-header.js';
import { SizeList } from './size-list.js';

/** What an MP3 file states beyond its frames. */
export interface Mp3StreamSettings {
  readonly metadata: MetadataMap;

  /** The samples of delay the encoder puts before the audio, 576 for LAME. */
  readonly encoderDelay: number;

  /** LAME's name and version as its tag states it, at most nine ASCII characters, as `LAME3.100`. */
  readonly encoder: string;
}

/** The most samples of delay or padding LAME's tag states: twelve bits. */
const LARGEST_TRIM = 0xfff;

const ENCODER_NAME = /^[\x20-\x7e]{0,9}$/;

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

/** Whether a frame is an information frame rather than audio. */
function isInformationFrame(frame: Uint8Array, header: MpegAudioHeader): boolean {
  const tag = ascii(frame, header.sideInfoEnd, 4);
  return tag === 'Xing' || tag === 'Info' || ascii(frame, 36, 4) === 'VBRI';
}

/** An MP3 file being written. */
export class Mp3StreamWriter implements EncodedStreamWriter<EncodedStreamLength> {
  private readonly settings: Mp3StreamSettings;
  private readonly sizes = new SizeList();
  private pending: Uint8Array = new Uint8Array();
  private model: MpegAudioHeader | undefined;
  private constantBitrate = true;
  private audioBytes = 0;
  private musicCrc = 0;
  private atStart = true;
  private ended = false;

  private constructor(settings: Mp3StreamSettings) {
    this.settings = settings;
  }

  /** A writer for a stream of these settings, refused where LAME's tag cannot state them. */
  static create(settings: Mp3StreamSettings): DomainResult<Mp3StreamWriter> {
    if (
      !Number.isInteger(settings.encoderDelay) ||
      settings.encoderDelay < 0 ||
      settings.encoderDelay > LARGEST_TRIM
    ) {
      return fail(unwritableStream('An MP3 encoder delay must be 0 to 4,095 samples.'));
    }
    if (!ENCODER_NAME.test(settings.encoder)) {
      return fail(
        unwritableStream("LAME's tag names its encoder in at most nine ASCII characters."),
      );
    }
    return succeed(new Mp3StreamWriter(settings));
  }

  /** Adds the next bytes of LAME's output, answering the frames they complete. */
  add(unit: Uint8Array): DomainResult<readonly Uint8Array[]> {
    if (this.ended) return fail(writerEnded());
    this.pending = this.pending.length === 0 ? unit.slice() : concatenate([this.pending, unit]);
    const frames: Uint8Array[] = [];
    let offset = 0;
    for (;;) {
      const rest = this.pending.subarray(offset);
      if (this.atStart && rest.length >= 3 && ascii(rest, 0, 3) === 'ID3') {
        const header = readId3v2Header(rest.subarray(0, ID3V2_HEADER_BYTES));
        if (!header.ok) return this.failed(header);
        if (header.value === undefined || rest.length < header.value.length) break;
        offset += header.value.length;
        continue;
      }
      if (rest.length < 4) break;
      const header = readMpegAudioHeader(rest);
      if (header === undefined) {
        // An ID3v1 tag can only end the stream, so it is held until the end shows whether it does.
        if (ascii(rest, 0, 3) === 'TAG' && rest.length <= ID3V1_BYTES) break;
        return this.failed(
          fail(invalidEncodedStream('The encoder answered bytes that are not an MP3 frame.')),
        );
      }
      if (rest.length < header.frameBytes) break;
      const frame = rest.subarray(0, header.frameBytes);
      offset += header.frameBytes;
      const first = this.atStart;
      this.atStart = false;
      if (first && isInformationFrame(frame, header)) continue;
      const accepted = this.accept(frame, header);
      if (!accepted.ok) return this.failed(accepted);
      frames.push(frame);
    }
    this.pending = this.pending.subarray(offset);
    return succeed(frames);
  }

  finish(end: EncodedStreamLength): DomainResult<FinishedEncodedStream> {
    if (this.ended) return fail(writerEnded());
    this.ended = true;
    const leftover = this.pending;
    if (
      leftover.length > 0 &&
      !(leftover.length === ID3V1_BYTES && ascii(leftover, 0, 3) === 'TAG')
    ) {
      return fail(invalidEncodedStream('The MP3 stream ends inside a frame.'));
    }
    const info = this.informationFrame(end.inputFrames);
    if (!info.ok) return info;
    const tag = encodeId3v2(this.settings.metadata);
    return succeed({
      head: concatenate([tag.bytes, info.value]),
      body: [],
      tail: new Uint8Array(),
      dropped: tag.dropped,
    });
  }

  /**
   * The information frame of the frames written, refused where they decode to
   * fewer samples than the encoder was given or the padding is past what the
   * tag states.
   */
  private informationFrame(inputFrames: number): DomainResult<Uint8Array> {
    const model = this.model;
    if (model === undefined)
      return fail(invalidEncodedStream('The MP3 encoder answered no frame.'));
    const frames = this.sizes.length;
    const delay = this.settings.encoderDelay;
    const padding = frames * model.samples - delay - inputFrames;
    if (!Number.isSafeInteger(inputFrames) || inputFrames < 0 || padding < 0) {
      return fail(
        invalidEncodedStream('The MP3 frames decode to fewer samples than the encoder was given.'),
      );
    }
    if (padding > LARGEST_TRIM) {
      return fail(
        invalidEncodedStream("The MP3 stream's padding is longer than LAME's tag can state."),
      );
    }
    const offsets = new Float64Array(frames + 1);
    for (let index = 0; index < frames; index += 1) {
      offsets[index + 1] = (offsets[index] ?? 0) + this.sizes.at(index);
    }
    const info = encodeInfoFrame({
      model,
      constantBitrate: this.constantBitrate,
      audioFrames: frames,
      audioBytes: this.audioBytes,
      audioOffset: (frame) => offsets[frame] ?? 0,
      encoder: this.settings.encoder,
      delay,
      padding,
      musicCrc: this.musicCrc,
    });
    return info === undefined
      ? fail(unwritableStream('No frame of this MP3 format holds the information frame.'))
      : succeed(info);
  }

  /** Counts an audio frame, refusing one of another version or rate than the first. */
  private accept(frame: Uint8Array, header: MpegAudioHeader): DomainResult<undefined> {
    const model = (this.model ??= header);
    if (header.version !== model.version || header.sampleRate !== model.sampleRate) {
      return fail(
        invalidEncodedStream('An MP3 frame is of another version or rate than the stream.'),
      );
    }
    if (header.bitrateIndex !== model.bitrateIndex) this.constantBitrate = false;
    this.sizes.push(frame.length);
    this.audioBytes += frame.length;
    this.musicCrc = lameCrc(frame, this.musicCrc);
    return succeed(undefined);
  }

  private failed(result: DomainFailureResult): DomainFailureResult {
    this.ended = true;
    return result;
  }
}
