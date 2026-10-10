/**
 * A WAV file's chunks carried in FLAC's `APPLICATION` blocks of id `riff`, as
 * the reference encoder's `--keep-foreign-metadata` carries them (ADR-0093).
 *
 * Each block holds one piece of the WAV file the FLAC stream decodes to, in
 * order: the `RIFF` form's header, the `fmt ` chunk, the chunks before the
 * audio, and the `data` chunk's header without its samples. Laid out so, the
 * reference decoder rebuilds the WAV file with its `smpl`, `cue ` and labels,
 * and any reader of the blocks finds the chunks where it looks. The `fmt `
 * chunk states the stream's own format: plain PCM for one or two channels of 8
 * or 16 bits, and `WAVE_FORMAT_EXTENSIBLE` with the speaker mask of FLAC's
 * channel order otherwise. A stream whose WAV file would pass four gibibytes
 * has no plain WAV form, so its chunks are not carried.
 */

import { fourCharacterCode, viewOf } from './byte-reading.js';
import { ByteWriter } from './byte-writer.js';
import type { RiffChunk } from './riff-loop-chunks.js';

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

/** The PCM sub-format's identifier, after its first two bytes, the format code. */
const PCM_SUBFORMAT_TAIL = Uint8Array.from([
  0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

const LARGEST_RIFF_SIZE = 0xffffffff;

/** A chunk's bytes: its id, size and body, padded to an even length. */
function chunkBytes(id: string, body: Uint8Array): Uint8Array {
  const writer = new ByteWriter().latin1(id).u32(body.length, true).bytes(body);
  if (body.length % 2 === 1) writer.u8(0);
  return writer.toBytes();
}

/** The `fmt ` chunk's body for the stream's format. */
function formatBody(format: FlacPcmFormat): Uint8Array {
  const containerBits = Math.ceil(format.bitsPerSample / 8) * 8;
  const blockAlign = (containerBits / 8) * format.channels;
  const plain =
    format.channels <= 2 && containerBits === format.bitsPerSample && containerBits <= 16;
  const writer = new ByteWriter()
    .u16(plain ? 1 : 0xfffe, true)
    .u16(format.channels, true)
    .u32(format.sampleRate, true)
    .u32(format.sampleRate * blockAlign, true)
    .u16(blockAlign, true)
    .u16(containerBits, true);
  if (!plain) {
    writer
      .u16(22, true)
      .u16(format.bitsPerSample, true)
      .u32(FLAC_SPEAKER_MASKS[format.channels - 1] ?? 0, true)
      .u16(1, true)
      .bytes(PCM_SUBFORMAT_TAIL);
  }
  return writer.toBytes();
}

/**
 * The bodies of the `APPLICATION` blocks carrying `chunks`, each beginning
 * with the application id, or `undefined` where the WAV file they describe
 * would be too large for a plain RIFF form.
 */
export function riffApplicationBodies(
  chunks: readonly RiffChunk[],
  format: FlacPcmFormat,
): readonly Uint8Array[] | undefined {
  const pieces = [
    chunkBytes('fmt ', formatBody(format)),
    ...chunks.map((chunk) => chunkBytes(chunk.id, chunk.body)),
  ];
  const dataBytes = format.totalSamples * format.channels * Math.ceil(format.bitsPerSample / 8);
  let formSize = 4 + 8 + dataBytes + (dataBytes % 2);
  for (const piece of pieces) formSize += piece.length;
  if (formSize > LARGEST_RIFF_SIZE) return undefined;
  const dataHeader = new ByteWriter().latin1('data').u32(dataBytes, true).toBytes();
  const formHeader = new ByteWriter().latin1('RIFF').u32(formSize, true).latin1('WAVE').toBytes();
  return [formHeader, ...pieces, dataHeader].map((piece) =>
    new ByteWriter().latin1(RIFF_APPLICATION).bytes(piece).toBytes().slice(),
  );
}

/**
 * The chunk an `APPLICATION` `riff` block's data holds, after the application
 * id, or `undefined` for the form's header, the audio's header, and a block
 * whose chunk runs past it.
 */
export function riffChunkOfApplication(data: Uint8Array): RiffChunk | undefined {
  if (data.length < 8) return undefined;
  const id = fourCharacterCode(data, 0);
  if (id === 'RIFF' || id === 'data') return undefined;
  const size = viewOf(data).getUint32(4, true);
  if (size > data.length - 8) return undefined;
  return { id, body: data.subarray(8, 8 + size) };
}
