/**
 * The canonical DSP port answered by the TypeScript reference path.
 *
 * The path the engine takes where WebAssembly cannot be compiled, and the
 * second implementation every golden test holds the WebAssembly module to.
 */

import {
  failure,
  FailureKind,
  fail,
  flatMapResult,
  mapResult,
  succeed,
  type DomainResult,
} from '@audiogubbins/domain';

import {
  DspImplementation,
  type CanonicalDsp,
  type CanonicalOscillator,
  type CanonicalResampler,
  type OscillatorSettings,
  type ResamplerSettings,
} from '../canonical-dsp.js';
import { assertSeekFrame, checkOscillator, checkResampler, framesOfPlanar } from '../settings.js';
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

/** A converter, or why its filter's table cannot be held. */
function referenceResamplerFor(settings: ResamplerSettings): DomainResult<ReferenceResampler> {
  try {
    return succeed(
      new ReferenceResampler(settings.from, settings.to, settings.channels, settings.quality),
    );
  } catch (error) {
    // A typed array the engine cannot allocate throws a RangeError; the
    // module answers handle 0 for the same conversion.
    if (!(error instanceof RangeError)) throw error;
    return fail(
      failure(
        'dsp.resampler-out-of-memory',
        FailureKind.Unrecoverable,
        'There is not enough memory for the table of the resampler’s filter.',
        { details: { from: settings.from, to: settings.to, reason: error.message } },
      ),
    );
  }
}

function resamplerOver(resampler: ReferenceResampler): CanonicalResampler {
  const channels = resampler.channels;
  return {
    channels,
    lookahead: resampler.lookahead,
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
      assertSeekFrame(frame);
      return resampler.seek(frame);
    },
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
    flatMapResult(checkResampler(settings), (checked) =>
      mapResult(referenceResamplerFor(checked), resamplerOver),
    ),
};
