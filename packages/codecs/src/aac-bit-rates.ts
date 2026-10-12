/**
 * The bit rates AAC's own syntax allows a stream (ISO/IEC 14496-3), whatever
 * encoder codes it: at least 8 kbit/s, and at most 6144 bits a channel for
 * each frame of 1024 samples, the size of the decoder's input buffer. An
 * encoder may take far fewer, as the browser's does (`CodecEnvironment`'s
 * `browserBitRates`); these are the bounds within which its bit rates are
 * looked for and the export's settings are first held to.
 */

/** The lowest bit rate AAC is written at, in kbit/s. */
export const AAC_LOWEST_BIT_RATE = 8;

const BITS_PER_CHANNEL_FRAME = 6144;
const FRAME_SAMPLES = 1024;

/** The highest bit rate, in whole kbit/s, AAC holds for `channels` channels at `sampleRate` hertz. */
export function aacHighestBitRate(channels: number, sampleRate: number): number {
  return Math.floor((channels * BITS_PER_CHANNEL_FRAME * sampleRate) / FRAME_SAMPLES / 1000);
}
