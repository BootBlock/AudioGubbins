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

import { elementaryStreamDescriptor, readAacConfig, type AacConfig } from './aac-config.js';
import { ByteWriter, concatenate } from './byte-writer.js';
import type {
  EncodedStreamLength,
  EncodedStreamWriter,
  FinishedEncodedStream,
} from './encoded-stream-writer.js';
import { invalidEncodedStream, unwritableStream, writerEnded } from './framing-failures.js';
import { GAPLESS_NAME, ITUNES_MEAN, encodeIlstItems, freeFormItem } from './ilst-metadata.js';
import type { MetadataMap } from './metadata-map.js';
import { box, fullBox } from './mp4-box.js';

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

const UNITY_MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

/** `und`, the undetermined language, packed as three five-bit letters. */
const UNDETERMINED_LANGUAGE = 0x55c4;

const LARGEST_32 = 0xffffffff;

/** A growing list of 32-bit sizes, held as a typed array rather than an array of numbers. */
class SizeList {
  private sizes = new Uint32Array(1_024);
  length = 0;

  push(size: number): void {
    if (this.length === this.sizes.length) {
      const grown = new Uint32Array(this.sizes.length * 2);
      grown.set(this.sizes);
      this.sizes = grown;
    }
    this.sizes[this.length] = size;
    this.length += 1;
  }

  at(index: number): number {
    return this.sizes[index] ?? 0;
  }
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
    const gapless = [0, primingFrames, padding].map((value) =>
      value.toString(16).toUpperCase().padStart(8, '0'),
    );
    const smpb = ` ${gapless.join(' ')} ${end.inputFrames.toString(16).toUpperCase().padStart(16, '0')}${' 00000000'.repeat(8)}`;
    const ilst = encodeIlstItems(this.settings.metadata);
    const items = [...ilst.items, freeFormItem(ITUNES_MEAN, GAPLESS_NAME, smpb)];

    const ftyp = box(
      'ftyp',
      new ByteWriter().latin1('M4A ').u32(0).latin1('M4A mp42isom').toBytes(),
    );
    const largeData = this.dataBytes + 8 > LARGEST_32;
    const mdatHeader = largeData
      ? new ByteWriter()
          .u32(1)
          .latin1('mdat')
          .u64(this.dataBytes + 16)
          .toBytes()
      : new ByteWriter()
          .u32(this.dataBytes + 8)
          .latin1('mdat')
          .toBytes();

    // The movie box's size depends on whether its chunk offsets are 64-bit, and the offsets on its size.
    let moov = this.movie(0, false, items, end.inputFrames);
    let wide = ftyp.length + moov.length + mdatHeader.length + this.dataBytes > LARGEST_32;
    moov = this.movie(0, wide, items, end.inputFrames);
    const base = ftyp.length + moov.length + mdatHeader.length;
    wide = base + this.dataBytes > LARGEST_32;
    moov = this.movie(base, wide, items, end.inputFrames);
    return succeed({
      head: concatenate([ftyp, moov, mdatHeader]),
      body: [],
      tail: new Uint8Array(),
      dropped: ilst.dropped,
    });
  }

  /** The movie box, its chunks placed from `base`, the offset of the first sample. */
  private movie(
    base: number,
    wide: boolean,
    items: readonly Uint8Array[],
    inputFrames: number,
  ): Uint8Array {
    const { sampleRate, frameLength } = this.config;
    const time = this.settings.time ?? 0;
    const units = this.sizes.length;
    const decoded = units * frameLength;
    const long = Math.max(decoded, time) > LARGEST_32;
    const timed = (writer: ByteWriter, value: number) =>
      long ? writer.u64(value) : writer.u32(value);
    const matrix = (writer: ByteWriter) => {
      for (const value of UNITY_MATRIX) writer.u32(value);
      return writer;
    };

    const mvhd = new ByteWriter();
    timed(timed(mvhd, time), time).u32(sampleRate);
    timed(mvhd, inputFrames).u32(0x00010000).u16(0x0100).zeros(10);
    matrix(mvhd).zeros(24).u32(2);

    const tkhd = new ByteWriter();
    timed(timed(tkhd, time), time).u32(1).u32(0);
    timed(tkhd, inputFrames).zeros(8).u16(0).u16(0).u16(0x0100).u16(0);
    matrix(tkhd).u32(0).u32(0);

    const elst = new ByteWriter().u32(1);
    timed(elst, inputFrames);
    if (long) elst.u64(this.settings.primingFrames);
    else elst.u32(this.settings.primingFrames);
    elst.u32(0x00010000);

    const mdhd = new ByteWriter();
    timed(timed(mdhd, time), time).u32(sampleRate);
    timed(mdhd, decoded).u16(UNDETERMINED_LANGUAGE).u16(0);

    const hdlr = new ByteWriter().u32(0).latin1('soun').zeros(12).latin1('SoundHandler').u8(0);

    const stbl = box(
      'stbl',
      fullBox('stsd', 0, 0, new ByteWriter().u32(1).toBytes(), this.sampleEntry()),
      fullBox('stts', 0, 0, new ByteWriter().u32(1).u32(units).u32(frameLength).toBytes()),
      ...this.chunkBoxes(base, wide),
    );

    return box(
      'moov',
      fullBox('mvhd', long ? 1 : 0, 0, mvhd.toBytes()),
      box(
        'trak',
        fullBox('tkhd', long ? 1 : 0, 0x000003, tkhd.toBytes()),
        box('edts', fullBox('elst', long ? 1 : 0, 0, elst.toBytes())),
        box(
          'mdia',
          fullBox('mdhd', long ? 1 : 0, 0, mdhd.toBytes()),
          fullBox('hdlr', 0, 0, hdlr.toBytes()),
          box(
            'minf',
            fullBox('smhd', 0, 0, new ByteWriter().u16(0).u16(0).toBytes()),
            box(
              'dinf',
              fullBox('dref', 0, 0, new ByteWriter().u32(1).toBytes(), fullBox('url ', 0, 1)),
            ),
            stbl,
          ),
        ),
      ),
      box(
        'udta',
        fullBox(
          'meta',
          0,
          0,
          fullBox(
            'hdlr',
            0,
            0,
            new ByteWriter().u32(0).latin1('mdirappl').zeros(8).u8(0).toBytes(),
          ),
          box('ilst', ...items),
        ),
      ),
    );
  }

  /** The `mp4a` sample entry, with the decoder configuration and its rates. */
  private sampleEntry(): Uint8Array {
    const { sampleRate, channels, frameLength } = this.config;
    let largest = 0;
    let maximumBits = 0;
    const perSecond = Math.max(1, Math.round(sampleRate / frameLength));
    let windowBytes = 0;
    for (let index = 0; index < this.sizes.length; index += 1) {
      const size = this.sizes.at(index);
      largest = Math.max(largest, size);
      windowBytes += size - (index >= perSecond ? this.sizes.at(index - perSecond) : 0);
      maximumBits = Math.max(maximumBits, windowBytes * 8);
    }
    const seconds = (this.sizes.length * frameLength) / sampleRate;
    const entry = new ByteWriter()
      .zeros(6)
      .u16(1)
      .zeros(8)
      .u16(channels)
      .u16(16)
      .u16(0)
      .u16(0)
      // The rate as 16.16 fixed point, where it fits; past it the media's timescale states it.
      .u32(sampleRate <= 0xffff ? sampleRate * 65_536 : 0)
      .toBytes();
    const esds = fullBox(
      'esds',
      0,
      0,
      elementaryStreamDescriptor(this.settings.audioSpecificConfig, {
        bufferBytes: largest,
        maximumBitrate: maximumBits,
        averageBitrate: Math.round((this.dataBytes * 8) / seconds),
      }),
    );
    return box('mp4a', entry, esds);
  }

  /** `stsc`, `stsz` and the chunk offsets, the units grouped a second's worth to a chunk. */
  private chunkBoxes(base: number, wide: boolean): readonly Uint8Array[] {
    const { sampleRate, frameLength } = this.config;
    const units = this.sizes.length;
    const perChunk = Math.max(1, Math.ceil(sampleRate / frameLength));
    const chunks = Math.ceil(units / perChunk);
    const remainder = units - (chunks - 1) * perChunk;

    const stsc = new ByteWriter().u32(remainder === perChunk || chunks === 1 ? 1 : 2);
    stsc
      .u32(1)
      .u32(chunks === 1 ? remainder : perChunk)
      .u32(1);
    if (chunks > 1 && remainder !== perChunk) stsc.u32(chunks).u32(remainder).u32(1);

    const stsz = new ByteWriter().u32(0).u32(units);
    const offsets = new ByteWriter().u32(chunks);
    let offset = base;
    for (let index = 0; index < units; index += 1) {
      if (index % perChunk === 0) {
        if (wide) offsets.u64(offset);
        else offsets.u32(offset);
      }
      const size = this.sizes.at(index);
      stsz.u32(size);
      offset += size;
    }
    return [
      fullBox('stsc', 0, 0, stsc.toBytes()),
      fullBox('stsz', 0, 0, stsz.toBytes()),
      fullBox(wide ? 'co64' : 'stco', 0, 0, offsets.toBytes()),
    ];
  }

  private failed(result: DomainFailureResult): DomainFailureResult {
    this.ended = true;
    return result;
  }
}
