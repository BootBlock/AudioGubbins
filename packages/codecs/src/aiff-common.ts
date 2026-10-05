/**
 * The AIFF `COMM` chunk: channels, frames, sample size, the sample rate as an
 * 80-bit IEEE-754 extended float, and for AIFF-C the compression type.
 *
 * The rate is decoded with integer arithmetic on its 64-bit mantissa, so a rate
 * is known to be whole, or not, exactly: rounding it through a double first
 * could make 44 100 plus a fraction too small for 53 bits look whole. Plain
 * AIFF samples are big-endian two's complement. Of AIFF-C's compression types,
 * those below are uncompressed and read; any other is a codec this package
 * names and refuses.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode, viewOf } from './byte-reading.js';
import { malformed, unsupportedSampleRate } from './codec-failures.js';
import {
  floatEncoding,
  integerEncoding,
  type ByteOrder,
  type SampleEncoding,
} from './format-descriptor.js';
import { quotedCode } from './recognised-format.js';

/** The bytes of an AIFF `COMM` body, and of an AIFF-C one up to its compression type. */
const AIFF_COMM_BYTES = 18;
export const AIFC_COMM_BYTES = 22;

/**
 * An uncompressed AIFF-C sample type: its byte order and, where the type fixes
 * it rather than the `COMM` chunk's sample size, its width.
 */
type UncompressedType =
  | {
      readonly kind: 'integer';
      readonly byteOrder: ByteOrder;
      readonly signed: boolean;
      readonly bits?: number;
    }
  | { readonly kind: 'float'; readonly byteOrder: ByteOrder; readonly bits: 32 | 64 };

/** The AIFF-C compression types whose samples are uncompressed PCM. */
const UNCOMPRESSED_TYPES: ReadonlyMap<string, UncompressedType> = new Map([
  ['NONE', { kind: 'integer', byteOrder: 'big', signed: true }],
  ['twos', { kind: 'integer', byteOrder: 'big', signed: true }],
  ['sowt', { kind: 'integer', byteOrder: 'little', signed: true }],
  ['in24', { kind: 'integer', byteOrder: 'big', signed: true, bits: 24 }],
  ['in32', { kind: 'integer', byteOrder: 'big', signed: true, bits: 32 }],
  ['23ni', { kind: 'integer', byteOrder: 'little', signed: true, bits: 24 }],
  ['42ni', { kind: 'integer', byteOrder: 'little', signed: true, bits: 32 }],
  ['raw ', { kind: 'integer', byteOrder: 'big', signed: false, bits: 8 }],
  ['fl32', { kind: 'float', byteOrder: 'big', bits: 32 }],
  ['FL32', { kind: 'float', byteOrder: 'big', bits: 32 }],
  ['fl64', { kind: 'float', byteOrder: 'big', bits: 64 }],
  ['FL64', { kind: 'float', byteOrder: 'big', bits: 64 }],
]);

/** Plain AIFF's samples, as the AIFF-C type that means the same. */
const PLAIN_AIFF_TYPE = 'NONE';

/** What a `COMM` chunk states, its sample rate not yet checked. */
export interface CommonFacts {
  readonly channelCount: number;
  readonly declaredFrames: number;
  readonly sampleSize: number;
  readonly sampleRate: DomainResult<number>;

  /** The compression type: `NONE` for plain AIFF. */
  readonly compressionType: string;
}

/** The exponent bias of the extended format, and of its 64-bit mantissa's binary point. */
const EXPONENT_BIAS = 16_383;
const MANTISSA_POINT = 63;

/**
 * The whole number of hertz an 80-bit extended float states, or why it is no
 * rate: a sign, a fraction or an infinity, naming the value as near as a double
 * can.
 */
function extendedRate(bytes: Uint8Array, offset: number): DomainResult<number> {
  const view = viewOf(bytes);
  const signAndExponent = view.getUint16(offset, false);
  const exponent = signAndExponent & 0x7fff;
  const mantissa =
    (BigInt(view.getUint32(offset + 2, false)) << 32n) | BigInt(view.getUint32(offset + 6, false));
  if (exponent === 0x7fff) {
    // The format's top exponent is an infinity where the fraction is clear, and otherwise not a number.
    const fraction = mantissa & 0x7fff_ffff_ffff_ffffn;
    return fail(unsupportedSampleRate(fraction === 0n ? 'Infinity' : 'NaN'));
  }
  const scale = exponent - EXPONENT_BIAS - MANTISSA_POINT;
  const approximate = Number(mantissa) * 2 ** scale * (signAndExponent > 0x7fff ? -1 : 1);
  if (mantissa === 0n) return succeed(0);
  if (signAndExponent > 0x7fff) return fail(unsupportedSampleRate(String(approximate)));
  if (scale >= 0) return succeed(approximate);
  const shift = BigInt(-scale);
  const whole = (mantissa & ((1n << shift) - 1n)) === 0n;
  return whole
    ? succeed(Number(mantissa >> shift))
    : fail(unsupportedSampleRate(String(approximate)));
}

/** Reads a `COMM` body of at least `AIFF_COMM_BYTES`, or `AIFC_COMM_BYTES` for AIFF-C. */
export function readCommon(body: Uint8Array, compressed: boolean): DomainResult<CommonFacts> {
  const needed = compressed ? AIFC_COMM_BYTES : AIFF_COMM_BYTES;
  if (body.length < needed) {
    return fail(
      malformed(`The COMM chunk is shorter than the ${String(needed)} bytes it must hold.`),
    );
  }
  const view = viewOf(body);
  return succeed({
    channelCount: view.getInt16(0, false),
    declaredFrames: view.getUint32(2, false),
    sampleSize: view.getInt16(6, false),
    sampleRate: extendedRate(body, 8),
    compressionType: compressed ? fourCharacterCode(body, 18) : PLAIN_AIFF_TYPE,
  });
}

/** Whether a compression type is one whose samples this package reads. */
export function isUncompressed(compressionType: string): boolean {
  return UNCOMPRESSED_TYPES.has(compressionType);
}

/**
 * The encoding of an uncompressed type's samples of the `COMM` chunk's sample
 * size, refusing a size the type's own width contradicts.
 */
export function commonEncoding(facts: CommonFacts): DomainResult<SampleEncoding> {
  const type = UNCOMPRESSED_TYPES.get(facts.compressionType);
  if (type === undefined) {
    return fail(
      malformed(`The compression type ${quotedCode(facts.compressionType)} is not uncompressed.`),
    );
  }
  const bits = type.bits ?? facts.sampleSize;
  if (bits !== facts.sampleSize) {
    return fail(
      malformed(
        `The compression type ${quotedCode(facts.compressionType)} holds ${String(bits)}-bit samples, but the COMM chunk states ${String(facts.sampleSize)}.`,
      ),
    );
  }
  if (type.kind === 'float') return floatEncoding(bits, type.byteOrder);
  return integerEncoding(bits, Math.ceil(bits / 8), type.byteOrder, type.signed);
}
