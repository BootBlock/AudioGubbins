/**
 * The bands a loop's spectral mismatch compares (the plan's metric table):
 * third octaves with centres `1000 · 2^(k/3)` Hz and edges `f_c · 2^(±1/6)`,
 * from the lowest band holding at least four bins of the spectrum up to
 * min(20 kHz, 0.45 · rate), with every bin below that band, from the first
 * above 0 Hz, merged into one band. A band too narrow for four bins would
 * compare the noise of one or two bins, which a short window cannot resolve.
 */

import { pow } from '@audiogubbins/audio-engine';

/** The bins `[from, to)` of one band. */
export interface Band {
  readonly from: number;
  readonly to: number;
}

/** The fewest bins a third-octave band of its own holds. */
const FEWEST_BINS = 4;

/** The highest frequency compared, in hertz, before the rate's own limit. */
const HIGHEST_HERTZ = 20_000;

/** The first bin at or above `hertz` in a spectrum whose bins are `binHertz` apart. */
function firstBinFrom(hertz: number, binHertz: number): number {
  return Math.ceil(hertz / binHertz);
}

/** The bands of a spectrum of an FFT of `size` at `sampleRate`, lowest first. */
export function thirdOctaveBands(sampleRate: number, size: number): readonly Band[] {
  const binHertz = sampleRate / size;
  const highest = Math.min(HIGHEST_HERTZ, 0.45 * sampleRate);
  const edge = pow(2, 1 / 6);
  const bands: Band[] = [];
  // Where the last band ended, so neighbours share their edge's bin exactly;
  // undefined until the first band of four bins is found.
  let previousTo: number | undefined;
  // Centres from well under any bin's spacing upwards; k = −30 is 1 Hz.
  for (let k = -30; ; k += 1) {
    const centre = 1000 * pow(2, k / 3);
    const upper = centre * edge;
    if (upper > highest) break;
    const to = firstBinFrom(upper, binHertz);
    if (previousTo === undefined) {
      const from = Math.max(1, firstBinFrom(centre / edge, binHertz));
      if (to - from < FEWEST_BINS) continue;
      if (from > 1) bands.push({ from: 1, to: from });
      bands.push({ from, to });
    } else if (to > previousTo) {
      bands.push({ from: previousTo, to });
    }
    previousTo = to;
  }
  return bands;
}
