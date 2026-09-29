/**
 * Whether anything a thread made calls its canonical DSP.
 *
 * The readout says which DSP path each thread runs, and a thread that has the
 * WebAssembly module and never calls it is not running anything on it: a graph
 * of gains and meters, or a feed of recorded audio. So the DSP a thread gives
 * its kernels or its sources is watched, and the thread reports whether any of
 * them called it, which is what makes the readout true rather than merely
 * about what was loaded.
 */

import type { CanonicalDsp } from '@audiogubbins/audio-engine';

/** A DSP that notes its first use, and whether it has been used. */
export interface WatchedDsp {
  readonly dsp: CanonicalDsp;
  readonly used: () => boolean;
}

/** `dsp`, noting whether anything calls it. */
export function watchDspUse(dsp: CanonicalDsp): WatchedDsp {
  let used = false;
  return {
    dsp: {
      implementation: dsp.implementation,
      sineOfTurns: (turns) => {
        used = true;
        return dsp.sineOfTurns(turns);
      },
      createOscillator: (settings) => {
        used = true;
        return dsp.createOscillator(settings);
      },
      createResampler: (settings) => {
        used = true;
        return dsp.createResampler(settings);
      },
    },
    used: () => used,
  };
}
