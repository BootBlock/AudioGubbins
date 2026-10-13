/**
 * What a codec is, and what one runtime can do with it (ADR-0090).
 *
 * A descriptor is a value: the formats a codec covers, the directions it
 * serves, and for each direction the implementation that serves it and what
 * that implementation accepts. A runtime's probe turns a descriptor into a
 * capability, available or unavailable with the reason and the codecs that
 * serve instead, so no caller assumes a codec a browser lacks.
 */

/** The codecs AudioGubbins names. */
export type CodecId =
  | 'pcm'
  | 'g711-alaw'
  | 'g711-ulaw'
  | 'ima-adpcm'
  | 'ms-adpcm'
  | 'flac'
  | 'alac'
  | 'mp3'
  | 'vorbis'
  | 'opus'
  | 'aac-lc'
  | 'he-aac';

/** The containers a codec's stream is carried in. */
export type ContainerId =
  | 'wav'
  | 'rf64'
  | 'bw64'
  | 'aiff'
  | 'aifc'
  | 'flac'
  | 'mp3'
  | 'ogg'
  | 'mp4'
  | 'adts'
  | 'webm'
  | 'matroska';

/**
 * Who serves a direction: the application's own TypeScript codecs, the Rust
 * codec module, an encoder module built from a C library and loaded from its
 * own file, or the browser's WebCodecs (ADR-0091).
 */
export type CodecImplementation = 'application' | 'codec-module' | 'encoder-module' | 'browser';

/**
 * The implementation that decoded a stream into a rendition, and its version,
 * which the codec worker reports and the asset's provenance records
 * (ADR-0090, REQ-STOR-166).
 */
export interface DecoderIdentity {
  readonly implementation: CodecImplementation;

  /** The decoder's own name, such as a crate's or a browser's. */
  readonly name: string;
  readonly version: string;
}

/** The sample rates a direction accepts. */
export type SampleRateSupport =
  | { readonly kind: 'any'; readonly minimum: number; readonly maximum: number }
  | { readonly kind: 'listed'; readonly rates: readonly number[] };

/** One direction of a codec: how it is served and what it accepts. */
export interface CodecDirection {
  readonly implementation: CodecImplementation;

  /** The containers this direction reads or writes the codec in. */
  readonly containers: readonly ContainerId[];

  /** Whether the same input gives the same bytes or samples on every machine. */
  readonly reproducible: boolean;

  /** The implementation's licence, as an SPDX expression. */
  readonly licence: string;

  readonly sampleRates: SampleRateSupport;
  readonly maximumChannels: number;

  /**
   * The bit rates the direction's encoder takes, by the streams it serves,
   * where they depend on the stream; absent where it takes whatever bit rate
   * the format's own rules allow.
   */
  readonly bitRates?: readonly BitRateBand[];
}

/** A range of numbers, both ends included. */
export interface NumberRange {
  readonly minimum: number;
  readonly maximum: number;
}

/**
 * The bit rates an encoder takes for the streams of one band of sample rates,
 * of one channel count where it is made for one: the constant bit rates it
 * codes, and the range it holds an average bit rate to, where it does either.
 * A stream takes a bit rate that any band serving it takes, so a bit rate the
 * encoder would replace by its nearest is refused before anything is rendered
 * (ADR-0092).
 */
export interface BitRateBand {
  /** The channel count the band serves, or every count where absent. */
  readonly channels?: number;

  /** The sample rates the band serves, in hertz. */
  readonly sampleRates: NumberRange;

  /** The constant bit rates the encoder codes, in kbit/s. */
  readonly constant?: readonly number[];

  /** The average bit rates it holds a stream to, in bit/s, of the whole stream or of each channel. */
  readonly average?: NumberRange & { readonly per: 'stream' | 'channel' };
}

/**
 * The codes a RIFF or AIFF-C file names a codec by in its own header: the WAV
 * format tags, as `fmt ` or the extensible sub-format states them, and the
 * AIFF-C compression types. A stream format names its codec its own way, which
 * recognition reads, so it has none here.
 */
export interface CodecCodes {
  readonly waveFormatTags: readonly number[];
  readonly aifcCompressionTypes: readonly string[];
}

/** A codec, and the directions AudioGubbins serves it in. */
export interface CodecDescriptor {
  readonly id: CodecId;

  /** The codec's name as a sentence gives it, such as "Vorbis". */
  readonly name: string;
  readonly lossless: boolean;

  /** The codes a WAV or AIFF-C header names this codec by, so recognition asks the registry. */
  readonly codes: CodecCodes;
  readonly read: CodecDirection | undefined;
  readonly write: CodecDirection | undefined;
}

/** Which way a codec is used. */
export type CodecUse = 'read' | 'write';

/** What one runtime can do with one codec in one direction. */
export type CodecCapability =
  | {
      readonly kind: 'available';
      readonly codec: CodecId;
      readonly use: CodecUse;
      readonly implementation: CodecImplementation;
    }
  | {
      readonly kind: 'unavailable';
      readonly codec: CodecId;
      readonly use: CodecUse;

      /** A sentence saying why, for the person. */
      readonly reason: string;

      /** The codecs that serve this use instead, in the order to offer them. */
      readonly alternatives: readonly CodecId[];
    };
