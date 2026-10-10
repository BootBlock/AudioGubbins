/**
 * The head of a WAV, RF64 or BW64 file: every byte before the first sample,
 * written once the stream's length is known (ADR-0071, ADR-0090).
 *
 * The form is RIFF while every size fits its 32-bit field, and RF64 (EBU Tech
 * 3306) the moment one would not, decided from the whole length; BW64 (ITU-R
 *       BS.2088) is always written with its ds64 chunk. Where the ds64 chunk
 *       holds the sizes, the form's, the data's and the fact chunk's 32-bit
 *       fields state 0xFFFFFFFF, which sends a reader to it. The chunks follow
 *       in one order: the form, ds64, `fmt `, `fact`, the caller's chunks, then
 *       the data chunk's header; a pad byte follows odd data, counted by the
 *       form's size.
 *
 * The recorded-media writer and the export writer both take their heads here,
 * so a recording's header and an export's are one layout.
 */

import { fail, succeed, type DomainFailure, type DomainResult } from '@audiogubbins/domain';

import { CHUNK_HEADER_BYTES, FieldWriter, chunkLength } from './field-writer.js';
import { DS64_FIXED_BYTES, SIZE_IN_DS64 } from './riff-container.js';
import type { WrittenChunk } from './written-chunk.js';

/** The form's id, its size and `WAVE`. */
const FORM_HEADER_BYTES = 12;

/** The `fact` chunk's body: the frames, as samples of each channel. */
const FACT_BYTES = 4;

/**
 * The largest size a 32-bit field states in the plain form. One more is RF64's
 * marker, which sends a reader to the ds64 chunk, so a plain file never states
 * it.
 */
const LARGEST_PLAIN_SIZE = SIZE_IN_DS64 - 1;

/** What a head holds, before its sizes are decided. */
export interface WaveHeadParts {
  /** `riff` becomes RF64 where a size passes 32 bits; `bw64` is always BW64. */
  readonly form: 'riff' | 'bw64';
  readonly format: WrittenChunk;

  /** The frames a `fact` chunk states, or `undefined` for none. */
  readonly factFrames: number | undefined;

  /** The chunks after `fact` and before the data, such as metadata. */
  readonly chunks: readonly WrittenChunk[];

  /** The bytes of the samples. */
  readonly dataLength: number;

  /** The frames of the samples, which ds64 states. */
  readonly frames: number;
}

/** Every size of a head, decided before a byte of it is written. */
export interface WaveHeadPlan {
  readonly container: 'wav' | 'rf64' | 'bw64';

  /** The offset of the first sample's first byte, which is the head's length. */
  readonly dataOffset: number;

  /** The whole file's length: the head, the samples and the pad after odd samples. */
  readonly fileLength: number;
}

/** The bytes of the chunks between `fmt ` and the data's header. */
function middleLength(parts: WaveHeadParts): number {
  const fact = parts.factFrames === undefined ? 0 : CHUNK_HEADER_BYTES + FACT_BYTES;
  return parts.chunks.reduce((total, chunk) => total + chunkLength(chunk), fact);
}

/**
 * The sizes of the head of `parts`, or `tooLong`'s failure where the file's
 * byte offsets would not be exact numbers.
 */
export function waveHeadPlan(
  parts: WaveHeadParts,
  tooLong: () => DomainFailure,
): DomainResult<WaveHeadPlan> {
  const plainHead =
    FORM_HEADER_BYTES + chunkLength(parts.format) + middleLength(parts) + CHUNK_HEADER_BYTES;
  const pad = parts.dataLength % 2;
  // The form's size counts everything after its own id and size field.
  const plainFormSize = plainHead - CHUNK_HEADER_BYTES + parts.dataLength + pad;
  const container =
    parts.form === 'bw64' ? 'bw64' : plainFormSize <= LARGEST_PLAIN_SIZE ? 'wav' : 'rf64';
  const dataOffset =
    container === 'wav' ? plainHead : plainHead + CHUNK_HEADER_BYTES + DS64_FIXED_BYTES;
  const fileLength = dataOffset + parts.dataLength + pad;
  if (!Number.isSafeInteger(fileLength)) return fail(tooLong());
  return succeed({ container, dataOffset, fileLength });
}

/** Writes the head a plan sized. */
export function writeWaveHead(plan: WaveHeadPlan, parts: WaveHeadParts): Uint8Array {
  const out = new FieldWriter(plan.dataOffset, true);
  const large = plan.container !== 'wav';
  out.code(plan.container === 'wav' ? 'RIFF' : plan.container.toUpperCase());
  out.uint32(large ? SIZE_IN_DS64 : plan.fileLength - CHUNK_HEADER_BYTES);
  out.code('WAVE');
  if (large) {
    // EBU Tech 3306: the form's, the data's and the samples' true sizes, and no table.
    out.code('ds64');
    out.uint32(DS64_FIXED_BYTES);
    out.uint64(plan.fileLength - CHUNK_HEADER_BYTES);
    out.uint64(parts.dataLength);
    out.uint64(parts.frames);
    out.uint32(0);
  }
  out.chunk(parts.format);
  if (parts.factFrames !== undefined) {
    out.code('fact');
    out.uint32(FACT_BYTES);
    out.uint32(large ? SIZE_IN_DS64 : parts.factFrames);
  }
  for (const chunk of parts.chunks) out.chunk(chunk);
  out.code('data');
  out.uint32(large ? SIZE_IN_DS64 : parts.dataLength);
  return out.bytes;
}
