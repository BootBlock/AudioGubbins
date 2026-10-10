/**
 * An M4A file made from an AAC encoder's access units (ISO/IEC 14496-12 and
 * 14496-14), the browser's encoder's output written by the application's own
 * container (ADR-0091).
 *
 * The access units are the body: the samples of the `mdat` box. The head is
 * completed at the end, since the movie box it holds states every unit's size
 * and place: `ftyp` naming the M4A brand, then `moov` before the samples so a
 * player can begin at once, then the `mdat` header. Chunk offsets are 32-bit
 * (`stco`) unless the last chunk lies past four gibibytes (`co64`), and `mdat`
 * takes the 64-bit size only past four gibibytes.
 *
 * Gapless playback is stated twice, as players read one or the other: an edit
 * list whose single edit starts after the encoder's priming and lasts exactly
 * the frames the encoder was given, and iTunes's `iTunSMPB` item stating the
 * priming, the padding and the length. Every time is the one the caller gives,
 * 0 by default, so the same units and settings give the same file.
 */

import { fail, succeed, type DomainFailureResult, type DomainResult } from '@audiogubbins/domain';

import { readAacConfig, type AacConfig } from './aac-config.js';
import { ByteWriter, concatenate } from './byte-writer.js';
import type {
  EncodedStreamLength,
  EncodedStreamWriter,
  FinishedEncodedStream,
} from './encoded-stream-writer.js';
import { invalidEncodedStream, unwritableStream, writerEnded } from './framing-failures.js';
import { encodeIlstItems, gaplessItem } from './ilst-metadata.js';
import type { MetadataMap } from './metadata-map.js';
import { box } from './mp4-box.js';
import { movieBox, type Mp4MovieDescription } from './mp4-movie.js';
import { SizeList } from './size-list.js';

/** What an M4A file states beyond its access units. */
export interface Mp4AacSettings {
  /** The AudioSpecificConfig the encoder answered. */
  readonly audioSpecificConfig: Uint8Array;

  /** The frames of priming the encoder put before the audio, which a player skips. */
  readonly primingFrames: number;
  readonly metadata: MetadataMap;

  /** The creation and modification time, in seconds since 1904-01-01 UTC; 0 where none is given. */
  readonly time?: number;
}

const LARGEST_32 = 0xffffffff;

/**
 * The bytes before the samples: `ftyp`, the movie box and the `mdat` header.
 * The movie box's size depends on whether its chunk offsets are 64-bit, and the
 * offsets on its size, so it is measured before it is placed.
 */
function fileHead(movie: Mp4MovieDescription): Uint8Array {
  const { dataBytes } = movie.stream;
  const ftyp = box('ftyp', new ByteWriter().latin1('M4A ').u32(0).latin1('M4A mp42isom').toBytes());
  const mdatHeader =
    dataBytes + 8 > LARGEST_32
      ? new ByteWriter()
          .u32(1)
          .latin1('mdat')
          .u64(dataBytes + 16)
          .toBytes()
      : new ByteWriter()
          .u32(dataBytes + 8)
          .latin1('mdat')
          .toBytes();
  const around = ftyp.length + mdatHeader.length;
  const narrow = movieBox(movie, 0, false);
  const measured = movieBox(movie, 0, around + narrow.length + dataBytes > LARGEST_32);
  const base = around + measured.length;
  const moov = movieBox(movie, base, base + dataBytes > LARGEST_32);
  return concatenate([ftyp, moov, mdatHeader]);
}

/** An M4A file being written. */
export class Mp4AacWriter implements EncodedStreamWriter<EncodedStreamLength> {
  private readonly settings: Mp4AacSettings;
  private readonly config: AacConfig;
  private readonly sizes = new SizeList();
  private dataBytes = 0;
  private ended = false;

  private constructor(settings: Mp4AacSettings, config: AacConfig) {
    this.settings = settings;
    this.config = config;
  }

  /** A writer for the stream its configuration states, refused where an M4A file cannot hold it. */
  static create(settings: Mp4AacSettings): DomainResult<Mp4AacWriter> {
    const config = readAacConfig(settings.audioSpecificConfig);
    if (!config.ok) return config;
    const time = settings.time ?? 0;
    if (
      !Number.isSafeInteger(settings.primingFrames) ||
      settings.primingFrames < 0 ||
      settings.primingFrames > 0x7fffffff
    ) {
      return fail(
        unwritableStream(
          'The AAC priming must be a whole number of frames an edit list can state.',
        ),
      );
    }
    if (!Number.isSafeInteger(time) || time < 0) {
      return fail(unwritableStream('An MP4 time must be a whole number of seconds since 1904.'));
    }
    return succeed(new Mp4AacWriter(settings, config.value));
  }

  /** Adds one access unit, answering it as the body it is. */
  add(unit: Uint8Array): DomainResult<readonly Uint8Array[]> {
    if (this.ended) return fail(writerEnded());
    if (unit.length === 0)
      return this.failed(fail(invalidEncodedStream('An AAC access unit is empty.')));
    this.sizes.push(unit.length);
    this.dataBytes += unit.length;
    return succeed([unit]);
  }

  finish(end: EncodedStreamLength): DomainResult<FinishedEncodedStream> {
    if (this.ended) return fail(writerEnded());
    this.ended = true;
    const units = this.sizes.length;
    const decoded = units * this.config.frameLength;
    const { primingFrames } = this.settings;
    if (units === 0) return fail(invalidEncodedStream('The AAC encoder answered no access unit.'));
    if (
      !Number.isSafeInteger(end.inputFrames) ||
      end.inputFrames < 0 ||
      primingFrames + end.inputFrames > decoded
    ) {
      return fail(
        invalidEncodedStream(
          'The AAC access units decode to fewer frames than the encoder was given.',
        ),
      );
    }
    const padding = decoded - primingFrames - end.inputFrames;
    const ilst = encodeIlstItems(this.settings.metadata);
    const movie: Mp4MovieDescription = {
      stream: {
        config: this.config,
        audioSpecificConfig: this.settings.audioSpecificConfig,
        sizes: this.sizes,
        dataBytes: this.dataBytes,
      },
      time: this.settings.time ?? 0,
      primingFrames,
      inputFrames: end.inputFrames,
      items: [...ilst.items, gaplessItem(primingFrames, padding, end.inputFrames)],
    };

    return succeed({
      head: fileHead(movie),
      body: [],
      tail: new Uint8Array(),
      dropped: ilst.dropped,
    });
  }

  private failed(result: DomainFailureResult): DomainFailureResult {
    this.ended = true;
    return result;
  }
}
