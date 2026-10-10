/**
 * The `fmt ` chunk a WAV writer states its samples by: the plain form, or
 * WAVE_FORMAT_EXTENSIBLE with its valid bits, its speaker mask and the
 * sub-format GUID of the standard family, which carries the same code.
 *
 * Integer PCM in the plain form is the 16-byte PCMWAVEFORMAT every reader
 * takes; every other plain code carries the extension size its format defines,
 * none for floating point and G.711, and for IMA and Microsoft ADPCM the
 * samples of each block and, for Microsoft's, the seven standard coefficient
 * pairs.
 */

import type { ImaAdpcmEncoding, MsAdpcmEncoding, SampleEncoding } from './sample-encoding.js';
import { chunkOf } from './field-writer.js';
import {
  EXTENSIBLE_FORMAT_BYTES,
  EXTENSION_BYTES,
  STANDARD_SUBTYPE_TAIL,
  WAVE_FORMAT_EXTENSIBLE,
  WAVE_FORMAT_IEEE_FLOAT,
  WAVE_FORMAT_PCM,
} from './wave-format.js';
import type { WrittenChunk } from './written-chunk.js';

/** How the chunk states the layout: plain, or extensible with a speaker mask. */
export type WaveFormatForm =
  { readonly kind: 'plain' } | { readonly kind: 'extensible'; readonly channelMask: number };

/** The fields every format chunk holds, and those an ADPCM chunk adds before its own. */
const PLAIN_BYTES = 16;
const EXTENSION_SIZE_BYTES = 2;

/** Each encoding's format code and the bits each sample is stated with. */
function codeOf(encoding: SampleEncoding): { readonly code: number; readonly bits: number } {
  switch (encoding.kind) {
    case 'integer':
      return { code: WAVE_FORMAT_PCM, bits: encoding.bytes * 8 };
    case 'float':
      return { code: WAVE_FORMAT_IEEE_FLOAT, bits: encoding.bits };
    case 'g711-alaw':
      return { code: 0x0006, bits: 8 };
    case 'g711-ulaw':
      return { code: 0x0007, bits: 8 };
    case 'ima-adpcm':
      return { code: 0x0011, bits: 4 };
    case 'ms-adpcm':
      return { code: 0x0002, bits: 4 };
  }
}

/** The bytes an ADPCM format chunk adds after its extension size. */
function adpcmExtension(encoding: ImaAdpcmEncoding | MsAdpcmEncoding): number {
  return encoding.kind === 'ima-adpcm' ? 2 : 4 + 4 * encoding.coefficients.length;
}

/** What a format chunk states, beyond the encoding. */
export interface WaveFormatFacts {
  readonly encoding: SampleEncoding;
  readonly channelCount: number;
  readonly sampleRate: number;
  readonly blockAlign: number;
  readonly framesPerBlock: number;
  readonly form: WaveFormatForm;
}

/** The format chunk of `facts`. */
export function waveFormatChunk(facts: WaveFormatFacts): WrittenChunk {
  const { encoding, form } = facts;
  const { code, bits } = codeOf(encoding);
  const adpcm = encoding.kind === 'ima-adpcm' || encoding.kind === 'ms-adpcm';
  const extension = adpcm ? adpcmExtension(encoding) : 0;
  const length =
    form.kind === 'extensible'
      ? EXTENSIBLE_FORMAT_BYTES
      : encoding.kind === 'integer'
        ? PLAIN_BYTES
        : PLAIN_BYTES + EXTENSION_SIZE_BYTES + extension;
  return chunkOf('fmt ', length, true, (out) => {
    out.uint16(form.kind === 'extensible' ? WAVE_FORMAT_EXTENSIBLE : code);
    out.uint16(facts.channelCount);
    out.uint32(facts.sampleRate);
    out.uint32(Math.floor((facts.sampleRate * facts.blockAlign) / facts.framesPerBlock));
    out.uint16(facts.blockAlign);
    out.uint16(bits);
    if (form.kind === 'extensible') {
      out.uint16(EXTENSION_BYTES);
      out.uint16(encoding.kind === 'integer' ? encoding.bits : bits);
      out.uint32(form.channelMask);
      out.uint32(code);
      out.raw(STANDARD_SUBTYPE_TAIL);
      return;
    }
    if (encoding.kind === 'integer') return;
    out.uint16(extension);
    if (encoding.kind === 'ima-adpcm') out.uint16(encoding.framesPerBlock);
    if (encoding.kind === 'ms-adpcm') {
      out.uint16(encoding.framesPerBlock);
      out.uint16(encoding.coefficients.length);
      for (const [first, second] of encoding.coefficients) {
        out.int16(first);
        out.int16(second);
      }
    }
  });
}
