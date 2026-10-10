/**
 * The movie box of an M4A file (ISO/IEC 14496-12): the movie and track
 * headers, the edit list that trims the encoder's priming and padding, the
 * media of the one audio track with its sample table, and the iTunes metadata.
 *
 * Every time is the one given, so the same stream and settings give the same
 * box; a duration or time past 32 bits takes the version 1 boxes.
 */

import { ByteWriter } from './byte-writer.js';
import { box, fullBox } from './mp4-box.js';
import { sampleTableBox, type Mp4AudioStream } from './mp4-sample-table.js';

/** What the movie box states beyond its stream. */
export interface Mp4MovieDescription {
  readonly stream: Mp4AudioStream;

  /** The creation and modification time, in seconds since 1904-01-01 UTC. */
  readonly time: number;
  readonly primingFrames: number;

  /** The frames the encoder was given: the edit's length. */
  readonly inputFrames: number;

  /** The items of the `ilst` box. */
  readonly items: readonly Uint8Array[];
}

const UNITY_MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

/** `und`, the undetermined language, packed as three five-bit letters. */
const UNDETERMINED_LANGUAGE = 0x55c4;

const LARGEST_32 = 0xffffffff;

/** The time and duration fields of version 0 boxes, or of version 1 where a value passes 32 bits. */
class TimedFields {
  readonly version: 0 | 1;

  constructor(long: boolean) {
    this.version = long ? 1 : 0;
  }

  write(writer: ByteWriter, value: number): ByteWriter {
    return this.version === 1 ? writer.u64(value) : writer.u32(value);
  }
}

const matrix = (writer: ByteWriter): ByteWriter => {
  for (const value of UNITY_MATRIX) writer.u32(value);
  return writer;
};

/** The track's `mdia` box: its media header, its handler and its sample table. */
function mediaBox(
  movie: Mp4MovieDescription,
  fields: TimedFields,
  base: number,
  wide: boolean,
): Uint8Array {
  const { sampleRate, frameLength } = movie.stream.config;
  const mdhd = new ByteWriter();
  fields.write(fields.write(mdhd, movie.time), movie.time).u32(sampleRate);
  fields
    .write(mdhd, movie.stream.sizes.length * frameLength)
    .u16(UNDETERMINED_LANGUAGE)
    .u16(0);
  const hdlr = new ByteWriter().u32(0).latin1('soun').zeros(12).latin1('SoundHandler').u8(0);
  const dref = fullBox('dref', 0, 0, new ByteWriter().u32(1).toBytes(), fullBox('url ', 0, 1));
  return box(
    'mdia',
    fullBox('mdhd', fields.version, 0, mdhd.toBytes()),
    fullBox('hdlr', 0, 0, hdlr.toBytes()),
    box(
      'minf',
      fullBox('smhd', 0, 0, new ByteWriter().u16(0).u16(0).toBytes()),
      box('dinf', dref),
      sampleTableBox(movie.stream, base, wide),
    ),
  );
}

/** The `trak` box: the track header, the edit list and the media. */
function trackBox(
  movie: Mp4MovieDescription,
  fields: TimedFields,
  base: number,
  wide: boolean,
): Uint8Array {
  const tkhd = new ByteWriter();
  fields.write(fields.write(tkhd, movie.time), movie.time).u32(1).u32(0);
  fields.write(tkhd, movie.inputFrames).zeros(8).u16(0).u16(0).u16(0x0100).u16(0);
  matrix(tkhd).u32(0).u32(0);

  const elst = new ByteWriter().u32(1);
  fields.write(elst, movie.inputFrames);
  fields.write(elst, movie.primingFrames).u32(0x00010000);

  return box(
    'trak',
    // Enabled and in the movie.
    fullBox('tkhd', fields.version, 0x000003, tkhd.toBytes()),
    box('edts', fullBox('elst', fields.version, 0, elst.toBytes())),
    mediaBox(movie, fields, base, wide),
  );
}

/** The `moov` box, the first unit at `base`, the chunk offsets 64-bit where `wide`. */
export function movieBox(movie: Mp4MovieDescription, base: number, wide: boolean): Uint8Array {
  const { sampleRate, frameLength } = movie.stream.config;
  const decoded = movie.stream.sizes.length * frameLength;
  const fields = new TimedFields(Math.max(decoded, movie.time) > LARGEST_32);

  const mvhd = new ByteWriter();
  fields.write(fields.write(mvhd, movie.time), movie.time).u32(sampleRate);
  fields.write(mvhd, movie.inputFrames).u32(0x00010000).u16(0x0100).zeros(10);
  matrix(mvhd).zeros(24).u32(2);

  const metadataHandler = new ByteWriter().u32(0).latin1('mdirappl').zeros(8).u8(0).toBytes();
  return box(
    'moov',
    fullBox('mvhd', fields.version, 0, mvhd.toBytes()),
    trackBox(movie, fields, base, wide),
    box(
      'udta',
      fullBox('meta', 0, 0, fullBox('hdlr', 0, 0, metadataHandler), box('ilst', ...movie.items)),
    ),
  );
}
