/**
 * The reference DSP, counting the objects it has made that are not released.
 *
 * An oscillator, a resampler or an FFT made on the WebAssembly path holds the
 * module's memory until it is released, so a test of an owner's release
 * counts what the owner leaves held.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';

/** A DSP that counts, and how many of its objects are held now. */
export interface CountingDsp {
  readonly dsp: CanonicalDsp;
  readonly held: () => number;
  /** How many objects it has made in all, released or not. */
  readonly made: () => number;
}

export function countingDsp(): CountingDsp {
  let held = 0;
  let made = 0;
  const counted = <T extends { release(): void }>(result: DomainResult<T>): DomainResult<T> =>
    mapResult(result, (object) => {
      held += 1;
      made += 1;
      const release = object.release.bind(object);
      return Object.assign(object, {
        release: () => {
          held -= 1;
          release();
        },
      });
    });
  return {
    dsp: {
      ...REFERENCE_DSP,
      createOscillator: (settings) => counted(REFERENCE_DSP.createOscillator(settings)),
      createResampler: (settings) => counted(REFERENCE_DSP.createResampler(settings)),
      createFft: (size) => counted(REFERENCE_DSP.createFft(size)),
    },
    held: () => held,
    made: () => made,
  };
}
