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
  type CanonicalFft,
  type CanonicalOscillator,
  type CanonicalResampler,
  type OscillatorSettings,
  type ResamplerSettings,
} from '../canonical-dsp.js';
import {
  assertFftShape,
  assertSeekFrame,
  checkFftSize,
  checkOscillator,
  checkResampler,
  framesOfPlanar,
} from '../settings.js';
import { ReferenceFft } from './fft.js';
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
    seek: (frame) => {
      assertSeekFrame(frame, 'An oscillator');
      oscillator.seek(frame);
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
    settings.coefficientBudgetBytes ?? Number.POSITIVE_INFINITY,
  );
  const channels = resampler.channels;
  return {
    channels,
    lookahead: resampler.lookahead,
    coefficients: resampler.coefficients,
    push: (input) => {
      if (!resampler.push(input, framesOfPlanar(input, channels))) {
        throw new Error('The resampler was given input after its end.');
      }
    },
    finish: () => {
      resampler.finish();
    },
    pull: (output) => {
      framesOfPlanar(output, channels);
      return resampler.pull(output);
    },
    seek: (frame) => {
      assertSeekFrame(frame, 'A resampler');
      return resampler.seek(frame);
    },
    get drained() {
      return resampler.drained;
    },
    release: () => undefined,
  };
}

function fftOf(size: number): CanonicalFft {
  const fft = new ReferenceFft(size);
  return {
    size,
    bins: fft.bins,
    forwardReal: (signal, real, imaginary) => {
      assertFftShape(size, signal.length, real.length, imaginary.length);
      fft.forwardReal(signal, real, imaginary);
    },
    inverseReal: (real, imaginary, signal) => {
      assertFftShape(size, signal.length, real.length, imaginary.length);
      fft.inverseReal(real, imaginary, signal);
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
  createFft: (size): DomainResult<CanonicalFft> => mapResult(checkFftSize(size), fftOf),
};
