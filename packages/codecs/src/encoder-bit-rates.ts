/**
 * The bit rates the encoder modules take (ADR-0091, ADR-0092), as the
 * libraries they are built from decide them, so the export settings refuse
 * what an encoder would otherwise replace by its nearest or refuse at encode.
 *
 * LAME 3.100 codes the bit rates of its MPEG version's table at a sample rate
 * (`bitrate_table` in `libmp3lame/tables.c`): MPEG-1's at 32, 44.1 and
 * 48 kHz, MPEG-2's at 16, 22.05 and 24 kHz, and at MPEG-2.5's 8, 11.025 and
 * 12 kHz only MPEG-2's up to 64 kbit/s, though the format codes up to 160. An
 * average bit rate is held to the same bounds (`lame_init_params`), for the
 * whole stream.
 *
 * libvorbis 1.3.7 sets up its encoder from the first of its templates that
 * serves the stream's rate and channel count and holds the bit rate asked for
 * a channel (`get_setup_template` in `lib/vorbisenc.c`, the templates in
 * `lib/modes/setup_*.h`), so the bit rates it holds a stream's average to are
 * the union of those templates' ranges. A template made for two channels or
 * for six serves that count alone; the uncoupled ones serve any. Above 50 kHz,
 * and below 8 kHz, only templates that hold no bit rate serve, so a nominal
 * bit rate is refused there (save six channels to 70 kHz) and a quality is
 * not. libvorbis takes every quality from -1 to 10 at every rate and count.
 */

import type { BitRateBand } from './codec-descriptor.js';

/** MPEG-1 Layer III's bit rates, in kbit/s. */
const MPEG1_BIT_RATES: readonly number[] = [
  32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];

/** MPEG-2 Layer III's bit rates, in kbit/s. */
const MPEG2_BIT_RATES: readonly number[] = [
  8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];

/** LAME's table for MPEG-2.5, which ends at 64 kbit/s. */
const LAME_MPEG25_BIT_RATES: readonly number[] = MPEG2_BIT_RATES.filter((rate) => rate <= 64);

/** A band of LAME's: its rates and the bit rates of its table. */
function lameBand(minimum: number, maximum: number, rates: readonly number[]): BitRateBand {
  return {
    sampleRates: { minimum, maximum },
    constant: rates,
    average: {
      minimum: (rates[0] ?? 0) * 1000,
      maximum: (rates.at(-1) ?? 0) * 1000,
      per: 'stream',
    },
  };
}

/** LAME 3.100's bit rates, by MPEG version. */
export const LAME_BIT_RATES: readonly BitRateBand[] = [
  lameBand(8_000, 12_000, LAME_MPEG25_BIT_RATES),
  lameBand(16_000, 24_000, MPEG2_BIT_RATES),
  lameBand(32_000, 48_000, MPEG1_BIT_RATES),
];

/**
 * One of libvorbis's templates that holds a bit rate: the rates it serves, the
 * channel count it is made for (absent: any), and the range of its rate
 * mapping, its first and last entries, in bit/s a channel.
 */
function vorbisTemplate(
  rates: readonly [number, number],
  channels: number | undefined,
  perChannel: readonly [number, number],
): BitRateBand {
  const [minimum, maximum] = rates;
  const average = { minimum: perChannel[0], maximum: perChannel[1], per: 'channel' } as const;
  return channels === undefined
    ? { sampleRates: { minimum, maximum }, average }
    : { channels, sampleRates: { minimum, maximum }, average };
}

/** libvorbis 1.3.7's templates that hold a bit rate, in its order. */
export const LIBVORBIS_BIT_RATES: readonly BitRateBand[] = [
  vorbisTemplate([40_000, 50_000], 2, [22_500, 250_001]),
  vorbisTemplate([40_000, 70_000], 6, [14_000, 240_001]),
  vorbisTemplate([40_000, 50_000], undefined, [32_000, 240_001]),
  vorbisTemplate([26_000, 40_000], 2, [18_000, 190_000]),
  vorbisTemplate([26_000, 40_000], undefined, [30_000, 190_000]),
  vorbisTemplate([19_000, 26_000], 2, [15_000, 86_000]),
  vorbisTemplate([19_000, 26_000], undefined, [16_000, 90_000]),
  vorbisTemplate([15_000, 19_000], 2, [12_000, 86_000]),
  vorbisTemplate([15_000, 19_000], undefined, [16_000, 100_000]),
  vorbisTemplate([9_000, 15_000], 2, [8_000, 44_000]),
  vorbisTemplate([9_000, 15_000], undefined, [12_000, 50_000]),
  vorbisTemplate([8_000, 9_000], 2, [6_000, 32_000]),
  vorbisTemplate([8_000, 9_000], undefined, [8_000, 42_000]),
];
