/**
 * The block coding of each sample encoding the read contract reads in place:
 * the one place an encoding's kind chooses its coding, so a reader and a
 * descriptor's checks reach every encoding the same way.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { imaBlockCoding, msBlockCoding } from './adpcm-blocks.js';
import { LINEAR_16_SCALE, frameCoding, type BlockCoding } from './block-coding.js';
import { malformed } from './codec-failures.js';
import { ALAW_EXPANSION, ULAW_EXPANSION } from './g711.js';
import { decodeFrames } from './sample-conversion.js';
import type { G711SampleEncoding, PcmSampleEncoding, SampleEncoding } from './sample-encoding.js';

/** Uncompressed PCM, whose frame is one container of each channel. */
function pcmCoding(encoding: PcmSampleEncoding, channelCount: number): BlockCoding {
  return frameCoding(channelCount * encoding.bytes, (bytes, _skip, frames, into, at) => {
    decodeFrames(encoding, bytes, frames, into, at);
    return succeed(undefined);
  });
}

/** G.711, whose frame is one companded byte of each channel. */
function g711Coding(encoding: G711SampleEncoding, channelCount: number): BlockCoding {
  const table = encoding.kind === 'g711-alaw' ? ALAW_EXPANSION : ULAW_EXPANSION;
  return frameCoding(channelCount, (bytes, _skip, frames, into, at) => {
    for (const [channel, target] of into.entries()) {
      for (let frame = 0; frame < frames; frame += 1) {
        target[at + frame] =
          (table[bytes[frame * channelCount + channel] ?? 0] ?? 0) / LINEAR_16_SCALE;
      }
    }
    return succeed(undefined);
  });
}

/** Why `blockAlign` cannot be a frame of `frameBytes`, or `undefined` where it is. */
function frameProblem(
  blockAlign: number,
  channelCount: number,
  sampleBytes: number,
): string | undefined {
  if (blockAlign === 0) return 'The header states that each frame takes no bytes.';
  if (blockAlign === channelCount * sampleBytes) return undefined;
  return `The header states ${String(blockAlign)} bytes per frame, but ${String(channelCount)} channels of ${String(sampleBytes)}-byte samples take ${String(channelCount * sampleBytes)}.`;
}

/**
 * The block coding of an encoding for `channelCount` channels and a header's
 * `blockAlign`, or why the header's block cannot be one of that encoding.
 */
export function blockCoding(
  encoding: SampleEncoding,
  channelCount: number,
  blockAlign: number,
): DomainResult<BlockCoding> {
  switch (encoding.kind) {
    case 'integer':
    case 'float': {
      const problem = frameProblem(blockAlign, channelCount, encoding.bytes);
      return problem === undefined
        ? succeed(pcmCoding(encoding, channelCount))
        : fail(malformed(problem));
    }
    case 'g711-alaw':
    case 'g711-ulaw': {
      const problem = frameProblem(blockAlign, channelCount, 1);
      return problem === undefined
        ? succeed(g711Coding(encoding, channelCount))
        : fail(malformed(problem));
    }
    case 'ima-adpcm':
      return imaBlockCoding(encoding, channelCount, blockAlign);
    case 'ms-adpcm':
      return msBlockCoding(encoding, channelCount, blockAlign);
  }
}
