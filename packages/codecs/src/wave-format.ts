/**
 * The WAV `fmt ` chunk: which codec the samples are in and, for uncompressed
 * PCM, how they are stored.
 *
 * Three format tags are uncompressed: 1, integer PCM; 3, IEEE floating point;
 * and 0xFFFE, WAVE_FORMAT_EXTENSIBLE, whose sub-format GUID carries one of the
 * other two codes and which adds the valid bits within each container and the
 * speaker mask. Every other tag, and an extensible sub-format outside the
 * standard GUID family, is a compressed or foreign codec this package names and
 * refuses. Plain PCM wider than a whole number of bytes is held left-justified
 * in the next whole byte, as the extensible form's valid bits are, so both
 * become the same encoding.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { floatEncoding, integerEncoding, type SampleEncoding } from './format-descriptor.js';
import type { CompressedWaveFormat, RiffContainer } from './recognised-format.js';

const WAVE_FORMAT_PCM = 0x0001;
export const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
export const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** The bytes every format chunk holds, and those the extensible form adds. */
const PLAIN_FORMAT_BYTES = 16;
export const EXTENSIBLE_FORMAT_BYTES = 40;
export const EXTENSION_BYTES = 22;

/**
 * The last twelve bytes of the GUID family KSDATAFORMAT_SUBTYPE_PCM and
 * KSDATAFORMAT_SUBTYPE_IEEE_FLOAT belong to,
 * `xxxxxxxx-0000-0010-8000-00aa00389b71`, whose first four bytes are the format
 * code.
 */
export const STANDARD_SUBTYPE_TAIL: readonly number[] = [
  0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
];

/** How the samples of an uncompressed WAV are stored. */
export interface WaveShape {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly blockAlign: number;
  readonly encoding: SampleEncoding;

  /** The extensible form's speaker mask, absent from the plain form. */
  readonly channelMask: number | undefined;
}

/** What a format chunk says: an uncompressed shape, or the codec it is not. */
export type WaveFormatReading =
  | { readonly readable: true; readonly shape: WaveShape }
  | { readonly readable: false; readonly format: CompressedWaveFormat };

/** The codec code of a format chunk, the valid bits in each container and the speaker mask. */
interface CodeFacts {
  readonly code: number;
  readonly validBits: number;
  readonly mask: number | undefined;
}

/** A GUID in its registry form, from the mixed-endian bytes Windows stores it in. */
function guidText(bytes: Uint8Array): string {
  const view = viewOf(bytes);
  const hex = (value: number, digits: number) => value.toString(16).padStart(digits, '0');
  const tail = Array.from(bytes.subarray(8, 16), (byte) => hex(byte, 2)).join('');
  return `${hex(view.getUint32(0, true), 8)}-${hex(view.getUint16(4, true), 4)}-${hex(view.getUint16(6, true), 4)}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** The encoding of a format code's samples of these bits, or `undefined` where the code is compressed. */
function uncompressedEncoding(
  code: number,
  containerBits: number,
  validBits: number,
): DomainResult<SampleEncoding> | undefined {
  if (code === WAVE_FORMAT_IEEE_FLOAT) {
    if (validBits !== containerBits) {
      return fail(
        malformed('Floating-point samples cannot have fewer valid bits than they occupy.'),
      );
    }
    return floatEncoding(containerBits, 'little');
  }
  if (code !== WAVE_FORMAT_PCM) return undefined;
  const bytes = Math.ceil(containerBits / 8);
  // WAV stores eight-bit samples as offset binary and wider ones as two's complement.
  return integerEncoding(validBits, bytes, 'little', bytes !== 1);
}

/** The code, valid bits and speaker mask of the extensible form, or the codec it is not. */
function readExtension(
  body: Uint8Array,
  container: RiffContainer,
  containerBits: number,
): DomainResult<CodeFacts | CompressedWaveFormat> {
  const view = viewOf(body);
  if (body.length < EXTENSIBLE_FORMAT_BYTES || view.getUint16(16, true) < EXTENSION_BYTES) {
    return fail(
      malformed(
        'The format chunk names the extensible form but is too short to hold its extension.',
      ),
    );
  }
  const subFormat = body.subarray(24, 40);
  const code = view.getUint32(24, true);
  if (!STANDARD_SUBTYPE_TAIL.every((byte, index) => subFormat[index + 4] === byte)) {
    return succeed({
      kind: 'compressed-wav',
      container,
      formatTag: WAVE_FORMAT_EXTENSIBLE,
      subFormat: guidText(subFormat),
    });
  }
  if (containerBits % 8 !== 0) {
    return fail(
      malformed(
        `The extensible format chunk states ${String(containerBits)}-bit containers, which are not whole bytes.`,
      ),
    );
  }
  // Some writers leave the valid bits at zero, meaning every bit of the container.
  const validBits = view.getUint16(18, true);
  return succeed({
    code,
    validBits: validBits === 0 ? containerBits : validBits,
    mask: view.getUint32(20, true),
  });
}

/** Reads a format chunk's body, at least the first `EXTENSIBLE_FORMAT_BYTES` of it. */
export function readWaveFormat(
  body: Uint8Array,
  container: RiffContainer,
): DomainResult<WaveFormatReading> {
  if (body.length < PLAIN_FORMAT_BYTES) {
    return fail(malformed('The format chunk is shorter than the 16 bytes every WAV format holds.'));
  }
  const view = viewOf(body);
  const tag = view.getUint16(0, true);
  const containerBits = view.getUint16(14, true);
  let facts: CodeFacts = { code: tag, validBits: containerBits, mask: undefined };
  if (tag === WAVE_FORMAT_EXTENSIBLE) {
    const extension = readExtension(body, container, containerBits);
    if (!extension.ok) return extension;
    if ('kind' in extension.value) return succeed({ readable: false, format: extension.value });
    facts = extension.value;
  }
  const encoding = uncompressedEncoding(facts.code, containerBits, facts.validBits);
  if (encoding === undefined) {
    return succeed({
      readable: false,
      format: { kind: 'compressed-wav', container, formatTag: facts.code },
    });
  }
  if (!encoding.ok) return encoding;
  return succeed({
    readable: true,
    shape: {
      sampleRate: view.getUint32(4, true),
      channelCount: view.getUint16(2, true),
      blockAlign: view.getUint16(12, true),
      encoding: encoding.value,
      channelMask: facts.mask,
    },
  });
}
