/**
 * What a browser's encoder was found to take, for tests that stand in for a
 * browser: the bands Chromium's AAC encoder on Windows answers
 * `isConfigSupported` by, Media Foundation's mono, stereo and 5.1 at 44.1 and
 * 48 kHz, each at 96, 128, 160 or 192 kbit/s and nothing else, as the probe
 * found them in Chromium's bundled build.
 */

import type { BitRateBand, CodecId } from '../codec-descriptor.js';

/** The bands Chromium's AAC encoder on Windows takes. */
export const WINDOWS_AAC_BIT_RATES: readonly BitRateBand[] = [1, 2, 6].flatMap((channels) =>
  [44_100, 48_000].map((hertz) => ({
    channels,
    sampleRates: { minimum: hertz, maximum: hertz },
    constant: [96, 128, 160, 192],
  })),
);

/** A browser's probed bit rates whose AAC encoder is Chromium's on Windows. */
export const WINDOWS_BROWSER_BIT_RATES: ReadonlyMap<CodecId, readonly BitRateBand[]> = new Map([
  ['aac-lc', WINDOWS_AAC_BIT_RATES],
]);
