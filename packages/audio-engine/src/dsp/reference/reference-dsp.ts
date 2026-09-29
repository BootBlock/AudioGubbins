/**
 * The canonical DSP port answered by the TypeScript reference path.
 *
 * The path the engine takes where WebAssembly cannot be compiled, and the
 * second implementation every golden test holds the WebAssembly module to.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';

import {
  DspImplementation,
  type CanonicalDsp,
  type CanonicalOscillator,
  type CanonicalResampler,
  type OscillatorSettings,
  type ResamplerSettings,
} from '../canonical-dsp.js';
import { checkOscillator, checkResampler } from '../settings.js';
import { ReferenceOscillator, sineOfTurns } from './primitives.js';
import { ReferenceResampler } from './resampling.js';

function oscillatorFrom(settings: OscillatorSettings): CanonicalOscillator {
  const oscillator = new ReferenceOscillator(
    settings.frequency,
    settings.sampleRate,
    settings.startPhase,
    settings.amplitude,
  );
  return {
    render: (into) => {
      oscillator.render(into);
    },
    // Garbage collected: nothing outside the object holds its state.
    release: () => undefined,
  };
}

function resamplerFrom(settings: ResamplerSettings): CanonicalResampler {
  const resampler = new ReferenceResampler(
    settings.from,
    settings.to,
    settings.channels,
    settings.quality,
  );
  return {
    channels: resampler.channels,
    lookahead: resampler.lookahead,
    push: (input) => {
      if (!resampler.push(input)) {
        throw new Error('The resampler was given input after its end, or of the wrong shape.');
      }
    },
    finish: () => {
      resampler.finish();
    },
    pull: (output) => resampler.pull(output),
    get drained() {
      return resampler.drained;
    },
    release: () => undefined,
  };
}

/** The canonical DSP in TypeScript. Holds no state of its own, so one serves every caller. */
export const REFERENCE_DSP: CanonicalDsp = {
  implementation: DspImplementation.Reference,
  sineOfTurns,
  createOscillator: (settings): DomainResult<CanonicalOscillator> =>
    mapResult(checkOscillator(settings), oscillatorFrom),
  createResampler: (settings): DomainResult<CanonicalResampler> =>
    mapResult(checkResampler(settings), resamplerFrom),
};
