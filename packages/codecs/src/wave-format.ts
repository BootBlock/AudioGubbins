/**
 * The WAV `fmt ` chunk: which codec the samples are in and, for one this
 * package reads in place, how they are stored.
 *
 * The format tag names the codec through the registry's codes. 0xFFFE,
 * WAVE_FORMAT_EXTENSIBLE, is a wrapper whose sub-format GUID carries the code
 * and which adds the valid bits within each container and the speaker mask.
 * Uncompressed PCM and G.711 need nothing past the plain fields; IMA and
 * Microsoft ADPCM add their samples per block, and Microsoft's its table of
 * coefficient pairs, after the plain fields, which the extensible form has no
 * room for. Plain PCM wider than a whole number of bytes is held left-justified
 * in the next whole byte, as the extensible form's valid bits are, so both
 * become the same encoding.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import type { CodecId } from './codec-descriptor.js';
import { WAVE_TAG_CODECS } from './codec-registry.js';
import { malformed } from './codec-failures.js';
import { floatEncoding, integerEncoding } from './format-descriptor.js';
import {
  hexCode,
  namedFormat,
  unnamedFormat,
  type RecognisedFormat,
  type RiffContainer,
} from './recognised-format.js';
import type { SampleEncoding } from './sample-encoding.js';

export const WAVE_FORMAT_PCM = 0x0001;
export const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
export const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** The bytes every format chunk holds, and those the extensible form adds. */
const PLAIN_FORMAT_BYTES = 16;
export const EXTENSIBLE_FORMAT_BYTES = 40;
export const EXTENSION_BYTES = 22;

/**
 * The most coefficient pairs a Microsoft ADPCM format chunk is read with: the
 * seven every file holds, and room for far more than any encoder adds.
 */
const MAXIMUM_COEFFICIENTS = 256;

/** The format chunk's longest body read: Microsoft ADPCM's, with its largest table. */
export const FORMAT_BYTES_READ = 22 + 4 * MAXIMUM_COEFFICIENTS;

/**
 * The last twelve bytes of the GUID family KSDATAFORMAT_SUBTYPE_PCM and
 * KSDATAFORMAT_SUBTYPE_IEEE_FLOAT belong to,
 * `xxxxxxxx-0000-0010-8000-00aa00389b71`, whose first four bytes are the format
 * code.
 */
export const STANDARD_SUBTYPE_TAIL: readonly number[] = [
  0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
];

/** The codes no descriptor covers that a refusal still names, by their documentation's names. */
const OTHER_CODE_NAMES: ReadonlyMap<number, string> = new Map([[0x0050, 'MPEG']]);

/** How the samples of a WAV this package reads are stored. */
export interface WaveShape {
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly blockAlign: number;
  readonly encoding: SampleEncoding;

  /** The extensible form's speaker mask, absent from the plain form. */
  readonly channelMask: number | undefined;
}

/** What a format chunk says: a shape read in place, or the format it is instead. */
export type WaveFormatReading =
  | { readonly readable: true; readonly shape: WaveShape }
  | { readonly readable: false; readonly format: RecognisedFormat };

/** The fields of a format chunk an encoding is read from. */
interface FormatFields {
  readonly body: Uint8Array;
  readonly view: DataView;
  readonly container: RiffContainer;
  readonly code: number;
  readonly containerBits: number;
  readonly validBits: number;
  readonly extensible: boolean;
}

/** An encoding read from a format chunk, or the format the chunk names instead. */
type EncodingReading = DomainResult<
  | { readonly readable: true; readonly encoding: SampleEncoding }
  | { readonly readable: false; readonly format: RecognisedFormat }
>;

/** A reading of an encoding read in place. */
function inPlace(encoding: DomainResult<SampleEncoding>): EncodingReading {
  return encoding.ok ? succeed({ readable: true, encoding: encoding.value }) : encoding;
}

/** A reading of a format the chunk names but this package does not read in place. */
function namedInstead(format: RecognisedFormat): EncodingReading {
  return succeed({ readable: false, format });
}

/** A GUID in its registry form, from the mixed-endian bytes Windows stores it in. */
function guidText(bytes: Uint8Array): string {
  const view = viewOf(bytes);
  const hex = (value: number, digits: number) => value.toString(16).padStart(digits, '0');
  const tail = Array.from(bytes.subarray(8, 16), (byte) => hex(byte, 2)).join('');
  return `${hex(view.getUint32(0, true), 8)}-${hex(view.getUint16(4, true), 4)}-${hex(view.getUint16(6, true), 4)}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** Uncompressed PCM, integer or floating point. */
function pcmEncoding(fields: FormatFields): EncodingReading {
  const { code, containerBits, validBits } = fields;
  if (code === WAVE_FORMAT_IEEE_FLOAT) {
    if (validBits !== containerBits) {
      return fail(
        malformed('Floating-point samples cannot have fewer valid bits than they occupy.'),
      );
    }
    return inPlace(floatEncoding(containerBits, 'little'));
  }
  const bytes = Math.ceil(containerBits / 8);
  // WAV stores eight-bit samples as offset binary and wider ones as two's complement.
  return inPlace(integerEncoding(validBits, bytes, 'little', bytes !== 1));
}

/** G.711, whose samples are always one byte. */
function g711Encoding(kind: 'g711-alaw' | 'g711-ulaw'): (fields: FormatFields) => EncodingReading {
  return ({ containerBits }) =>
    containerBits === 8
      ? inPlace(succeed({ kind }))
      : fail(
          malformed(
            `The header states ${String(containerBits)}-bit G.711 samples, which are always 8 bits.`,
          ),
        );
}

/**
 * Reads an ADPCM format chunk's samples per block, after `extraBytes` of its
 * own fields are checked present, into an encoding; or names the format where
 * it is not four-bit ADPCM in the plain form, which are the only ADPCM forms
 * whose block layout the chunk can state.
 */
function adpcmEncoding(
  fields: FormatFields,
  name: string,
  extraBytes: number,
  encoding: (framesPerBlock: number) => DomainResult<SampleEncoding>,
): EncodingReading {
  if (fields.extensible)
    return namedInstead(unnamedFormat(fields.container, `${name} in the extensible form`));
  if (fields.containerBits !== 4) {
    return namedInstead(
      unnamedFormat(fields.container, `${name} of ${String(fields.containerBits)} bits a sample`),
    );
  }
  if (fields.body.length < 18 + extraBytes || fields.view.getUint16(16, true) < extraBytes) {
    return fail(malformed(`The format chunk is too short to hold ${name}'s block layout.`));
  }
  return inPlace(encoding(fields.view.getUint16(18, true)));
}

/** IMA ADPCM in WAV's packing. */
function imaEncoding(fields: FormatFields): EncodingReading {
  return adpcmEncoding(fields, 'IMA ADPCM', 2, (framesPerBlock) =>
    succeed({ kind: 'ima-adpcm', packing: 'wav', framesPerBlock }),
  );
}

/** Microsoft ADPCM, with the coefficient table its blocks choose from. */
function msEncoding(fields: FormatFields): EncodingReading {
  const { body, view } = fields;
  return adpcmEncoding(fields, 'Microsoft ADPCM', 4, (framesPerBlock) => {
    const count = view.getUint16(20, true);
    const held = Math.max(0, Math.floor((body.length - 22) / 4));
    if (count === 0 || count > MAXIMUM_COEFFICIENTS || count > held) {
      return fail(
        malformed(
          `The format chunk states ${String(count)} Microsoft ADPCM coefficient pairs, where it holds 1 to ${String(Math.min(MAXIMUM_COEFFICIENTS, held))}.`,
        ),
      );
    }
    const coefficients = Array.from(
      { length: count },
      (_, pair) =>
        [view.getInt16(22 + 4 * pair, true), view.getInt16(24 + 4 * pair, true)] as const,
    );
    return succeed({ kind: 'ms-adpcm', framesPerBlock, coefficients });
  });
}

/** How each codec this package reads in place is read from a format chunk. */
const IN_PLACE: ReadonlyMap<CodecId, (fields: FormatFields) => EncodingReading> = new Map([
  ['pcm', pcmEncoding],
  ['g711-alaw', g711Encoding('g711-alaw')],
  ['g711-ulaw', g711Encoding('g711-ulaw')],
  ['ima-adpcm', imaEncoding],
  ['ms-adpcm', msEncoding],
]);

/** The codecs this package reads in place from a WAV file. */
export const WAVE_IN_PLACE_CODECS: ReadonlySet<CodecId> = new Set(IN_PLACE.keys());

/** The code, valid bits and speaker mask of the extensible form, or the format it names instead. */
function readExtension(
  body: Uint8Array,
  container: RiffContainer,
  containerBits: number,
): DomainResult<{ code: number; validBits: number; mask: number } | RecognisedFormat> {
  const view = viewOf(body);
  if (body.length < EXTENSIBLE_FORMAT_BYTES || view.getUint16(16, true) < EXTENSION_BYTES) {
    return fail(
      malformed(
        'The format chunk names the extensible form but is too short to hold its extension.',
      ),
    );
  }
  const subFormat = body.subarray(24, 40);
  if (!STANDARD_SUBTYPE_TAIL.every((byte, index) => subFormat[index + 4] === byte)) {
    return succeed(unnamedFormat(container, `sub-format ${guidText(subFormat)}`));
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
    code: view.getUint32(24, true),
    validBits: validBits === 0 ? containerBits : validBits,
    mask: view.getUint32(20, true),
  });
}

/** Reads a format chunk's body, at least the first `FORMAT_BYTES_READ` of it. */
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
  let fields: FormatFields = {
    body,
    view,
    container,
    code: tag,
    containerBits,
    validBits: containerBits,
    extensible: false,
  };
  let mask: number | undefined;
  if (tag === WAVE_FORMAT_EXTENSIBLE) {
    const extension = readExtension(body, container, containerBits);
    if (!extension.ok) return extension;
    if ('kind' in extension.value) return succeed({ readable: false, format: extension.value });
    fields = { ...fields, ...extension.value, extensible: true };
    mask = extension.value.mask;
  }
  const codec = WAVE_TAG_CODECS.get(fields.code);
  const read = codec === undefined ? undefined : IN_PLACE.get(codec);
  if (codec === undefined || read === undefined) {
    const format =
      codec === undefined
        ? unnamedFormat(
            container,
            OTHER_CODE_NAMES.get(fields.code) ?? `code ${hexCode(fields.code)}`,
          )
        : namedFormat(container, codec);
    return succeed({ readable: false, format });
  }
  const reading = read(fields);
  if (!reading.ok) return reading;
  if (!reading.value.readable) return succeed(reading.value);
  return succeed({
    readable: true,
    shape: {
      sampleRate: view.getUint32(4, true),
      channelCount: view.getUint16(2, true),
      blockAlign: view.getUint16(12, true),
      encoding: reading.value.encoding,
      channelMask: mask,
    },
  });
}
