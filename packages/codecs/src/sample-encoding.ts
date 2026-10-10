/**
 * How a file stores its samples: the encodings the read contract reads in place
 * (ADR-0052, ADR-0090).
 *
 * Uncompressed PCM, integer or floating point, and the compressed codes WAV and
 * AIFF-C carry that decode in independent blocks: G.711's A-law and µ-law, a
 * byte a sample, and IMA and Microsoft ADPCM, four bits a sample in blocks that
 * each start from a header of their own. Each kind is the codec's id, so what a
 * reader found and what the registry names agree without a table between them.
 */

import type { CodecId } from './codec-descriptor.js';

/** The order of a sample's bytes. */
export type ByteOrder = 'little' | 'big';

/**
 * Integer PCM: `bits` valid bits, left-justified in `bytes` container bytes.
 * `signed` is false only for offset-binary samples, WAV's and AIFF-C `raw `'s
 * eight-bit form.
 */
export interface IntegerSampleEncoding {
  readonly kind: 'integer';
  readonly bits: number;
  readonly bytes: number;
  readonly byteOrder: ByteOrder;
  readonly signed: boolean;
}

/** IEEE-754 floating-point PCM. */
export interface FloatSampleEncoding {
  readonly kind: 'float';
  readonly bits: 32 | 64;
  readonly bytes: 4 | 8;
  readonly byteOrder: ByteOrder;
}

/** ITU-T G.711, one companded byte a sample: A-law or µ-law. */
export interface G711SampleEncoding {
  readonly kind: 'g711-alaw' | 'g711-ulaw';
}

/**
 * IMA ADPCM, four bits a sample in blocks that each restart the predictor.
 * `packing` is how a block lays out its channels: WAV's (code 0x11), a
 * four-byte header per channel and then four-byte words of each channel in
 * turn, or AIFF-C `ima4`'s, one 34-byte packet of 64 samples per channel.
 */
export interface ImaAdpcmEncoding {
  readonly kind: 'ima-adpcm';
  readonly packing: 'wav' | 'ima4';
  readonly framesPerBlock: number;
}

/**
 * Microsoft ADPCM (WAV code 2), four bits a sample in blocks that each start
 * from two whole samples, predicted by the pair of coefficients a block's
 * header chooses from the format chunk's table.
 */
export interface MsAdpcmEncoding {
  readonly kind: 'ms-adpcm';
  readonly framesPerBlock: number;
  readonly coefficients: readonly (readonly [number, number])[];
}

/** How each sample is stored. */
export type SampleEncoding =
  | IntegerSampleEncoding
  | FloatSampleEncoding
  | G711SampleEncoding
  | ImaAdpcmEncoding
  | MsAdpcmEncoding;

/** The uncompressed encodings, each sample in a container of whole bytes. */
export type PcmSampleEncoding = IntegerSampleEncoding | FloatSampleEncoding;

/** The codec an encoding is: PCM for the uncompressed ones, and each compressed one its own. */
export function codecOfEncoding(encoding: SampleEncoding): CodecId {
  return encoding.kind === 'integer' || encoding.kind === 'float' ? 'pcm' : encoding.kind;
}
