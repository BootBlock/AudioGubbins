/**
 * The reference DSP, counting the objects it has made that are not released.
 *
 * An oscillator or a resampler made on the WebAssembly path holds the
 * module's memory until it is released, so a test of an owner's release
 * counts what the owner leaves held. The engine's own counting DSP is test
 * support of that package, which another package's tests cannot reach.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';
import { REFERENCE_DSP, type CanonicalDsp } from '@audiogubbins/audio-engine';

/** A DSP that counts, and how many of its objects are held now. */
interface CountingDsp {
  readonly dsp: CanonicalDsp;
  readonly held: () => number;
  /** How many objects it has made in all. */
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
    },
    held: () => held,
    made: () => made,
  };
}
