/**
 * A WAV file's chunks carried in FLAC's `APPLICATION` blocks of id `riff`, as
 * the reference encoder's `--keep-foreign-metadata` carries them (ADR-0093).
 *
 * Each block holds one piece of the WAV file the FLAC stream decodes to, in
 * order: the `RIFF` form's header, the `fmt ` chunk, the chunks before the
 * audio, and the `data` chunk's header without its samples. Laid out so, the
 * reference decoder rebuilds the WAV file with its `smpl`, `cue ` and labels,
 * and any reader of the blocks finds the chunks where it looks. The pieces are
 * the head the WAV writer itself writes for those samples (`wave-head.ts`,
 * `wave-format-writing.ts`), so a carried chunk and an exported one are the
 * same bytes: plain PCM for one or two channels of 8 or 16 bits, and
 * `WAVE_FORMAT_EXTENSIBLE` with the speaker mask of FLAC's channel order
 * otherwise. A stream whose WAV file would pass four gibibytes has no plain WAV
 * form, so its chunks are not carried.
 */

import { fourCharacterCode, viewOf } from './byte-reading.js';
import { ByteWriter } from './byte-writer.js';
import { unwritableFile } from './codec-failures.js';
import { CHUNK_HEADER_BYTES, chunkLength } from './field-writer.js';
import { waveFormatChunk, type WaveFormatForm } from './wave-format-writing.js';
import { waveHeadPlan, writeWaveHead, type WaveHeadParts } from './wave-head.js';
import type { WrittenChunk } from './written-chunk.js';

/** The application id of the blocks. */
export const RIFF_APPLICATION = 'riff';

/** The format of the samples the FLAC stream decodes to. */
export interface FlacPcmFormat {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly totalSamples: number;
}

/** FLAC's channel order for each count as a WAV speaker mask (RFC 9639, section 9.1.3). */
const FLAC_SPEAKER_MASKS: readonly number[] = [0x4, 0x3, 0x7, 0x33, 0x37, 0x3f, 0x70f, 0x63f];

/** The form's id, its size and `WAVE`, the first piece of the head. */
const FORM_HEADER_BYTES = 12;

/**
 * How the `fmt ` chunk states the samples: plain where it says all there is to
 * say, as the WAV writer decides, and otherwise extensible with FLAC's order.
 */
function formOf(format: FlacPcmFormat, containerBits: number): WaveFormatForm {
  const plain =
    format.channels <= 2 && containerBits === format.bitsPerSample && containerBits <= 16;
  return plain
    ? { kind: 'plain' }
    : { kind: 'extensible', channelMask: FLAC_SPEAKER_MASKS[format.channels - 1] ?? 0 };
}

/**
 * The bodies of the `APPLICATION` blocks carrying `chunks`, each beginning with
 * the application id, or `undefined` where the WAV file they describe would be
 * too large for a plain RIFF form.
 */
export function riffApplicationBodies(
  chunks: readonly WrittenChunk[],
  format: FlacPcmFormat,
): readonly Uint8Array[] | undefined {
  const bytes = Math.ceil(format.bitsPerSample / 8);
  const blockAlign = bytes * format.channels;
  const parts: WaveHeadParts = {
    form: 'riff',
    format: waveFormatChunk({
      // WAV's eight-bit samples are offset binary, and wider ones two's complement.
      encoding: {
        kind: 'integer',
        bits: format.bitsPerSample,
        bytes,
        byteOrder: 'little',
        signed: bytes !== 1,
      },
      channelCount: format.channels,
      sampleRate: format.sampleRate,
      blockAlign,
      framesPerBlock: 1,
      form: formOf(format, bytes * 8),
    }),
    factFrames: undefined,
    chunks,
    dataLength: format.totalSamples * blockAlign,
    frames: format.totalSamples,
  };
  const plan = waveHeadPlan(parts, () =>
    unwritableFile('The stream is too long for its WAV chunks to be carried.'),
  );
  if (!plan.ok || plan.value.container !== 'wav') return undefined;
  const head = writeWaveHead(plan.value, parts);
  const lengths = [
    FORM_HEADER_BYTES,
    chunkLength(parts.format),
    ...chunks.map(chunkLength),
    CHUNK_HEADER_BYTES,
  ];
  const pieces: Uint8Array[] = [];
  let at = 0;
  for (const length of lengths) {
    pieces.push(
      new ByteWriter()
        .latin1(RIFF_APPLICATION)
        .bytes(head.subarray(at, at + length))
        .toBytes()
        .slice(),
    );
    at += length;
  }
  return pieces;
}

/**
 * The chunk an `APPLICATION` `riff` block's data holds, after the application
 * id, or `undefined` for the form's header, the audio's header, and a block
 * whose chunk runs past it.
 */
export function riffChunkOfApplication(
  data: Uint8Array,
): { readonly id: string; readonly body: Uint8Array } | undefined {
  if (data.length < CHUNK_HEADER_BYTES) return undefined;
  const id = fourCharacterCode(data, 0);
  if (id === 'RIFF' || id === 'data') return undefined;
  const size = viewOf(data).getUint32(4, true);
  if (size > data.length - CHUNK_HEADER_BYTES) return undefined;
  return { id, body: data.subarray(CHUNK_HEADER_BYTES, CHUNK_HEADER_BYTES + size) };
}
