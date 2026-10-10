/**
 * The codec module's Vorbis decoder on the multichannel streams libvorbis
 * writes, each made here by the Vorbis encoder module and small enough to
 * decode in a moment: one for each of the two defects Symphonia 0.6.1 has and
 * the vendored copy fixes (`third_party/symphonia-codec-vorbis/README.md`).
 *
 * - Three uncoupled channels at quality 5 and 48 kHz: libvorbis's bandwidth
 *   limit ends the residue short of the block, so its partitions are not a
 *   whole number of classwords, and the published crate wrote a channel's last
 *   classword over the next channel's classifications.
 * - Six channels at a nominal 384 kbit/s and 48 kHz, libvorbis's 5.1 setup,
 *   whose mapping couples in four steps, which the published crate inverted
 *   first to last.
 *
 * Each channel carries its own tones, and each must come back within a stated
 * error of what was encoded: a stream decoded from the wrong codebooks or
 * uncoupled in the wrong order falls far below it.
 */

import { writtenChannelOrder } from '@audiogubbins/codecs';
import { ChannelRole, StandardLayouts, type ChannelLayout } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { FormatEncoding } from '@audiogubbins/import-export';
import { describe, expect, it } from 'vitest';

import { codecModule } from '../testing/codec-module.js';
import {
  decodeAll,
  encodeWhole,
  exportRequest,
  snrDb,
  testSignal,
} from '../testing/export-encoding.js';
import { memoryBytes } from '../testing/memory-bytes.js';

const RATE = 48_000;

/** A quarter of a second and a little more, so the stream ends inside a block. */
const FRAMES = 12_345;

/** Each channel must keep this much of its signal; the defects leave a few decibels. */
const FLOOR_DB = 25;

/** The decoded channels' errors against what was encoded, the low-frequency channel aside. */
async function channelErrors(
  layout: ChannelLayout,
  encoding: FormatEncoding,
): Promise<readonly number[]> {
  const source = testSignal(layout.roles.length, FRAMES, RATE);
  const file = await encodeWhole(exportRequest(encoding, RATE, layout), source);
  const module = await codecModule();
  const session = expectSuccess(module.openDecoder(memoryBytes(file)));
  const decoded = decodeAll(session);
  session.release();
  const order = expectSuccess(writtenChannelOrder('vorbis', 'ogg', layout));
  // libvorbis codes the low-frequency channel band-limited, so it is not held here.
  return order.flatMap((index, channel) =>
    layout.roles[index] === ChannelRole.LowFrequency
      ? []
      : [snrDb([source[index] ?? new Float32Array()], [decoded[channel] ?? new Float32Array()])],
  );
}

describe('the codec module’s Vorbis decoder on multichannel streams', () => {
  it('decodes a residue whose partitions are not whole classwords in every channel', async () => {
    const errors = await channelErrors(StandardLayouts.lcr, {
      format: 'ogg-vorbis',
      encoding: { mode: 'quality', quality: 5 },
    });
    expect(errors).toHaveLength(3);
    for (const error of errors) expect(error).toBeGreaterThan(FLOOR_DB);
  });

  it('inverts a coupling of several steps last first, as libvorbis’s 5.1 setup needs', async () => {
    const errors = await channelErrors(StandardLayouts.surround5_1, {
      format: 'ogg-vorbis',
      encoding: { mode: 'bit-rate', nominalBitRate: 384 },
    });
    expect(errors).toHaveLength(5);
    for (const error of errors) expect(error).toBeGreaterThan(FLOOR_DB);
  });
});
