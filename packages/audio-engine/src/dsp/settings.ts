/**
 * The checks every canonical DSP implementation makes before it builds, and
 * before it takes a call.
 *
 * Written once, so the two implementations refuse the same settings with the
 * same failure, and the same calls with the same fault: the Rust module
 * refuses them too, but by answering handle 0 or a status, which says nothing
 * a person could act on.
 */

import { failure, FailureKind, fail, succeed, type DomainResult } from '@audiogubbins/domain';

import {
  ResamplingQuality,
  type OscillatorSettings,
  type ResamplerSettings,
} from './canonical-dsp.js';

/** The qualities the resampler knows, for a code read from anywhere. */
const QUALITIES: ReadonlySet<number> = new Set(Object.values(ResamplingQuality));

/** The settings, or why an oscillator cannot be made from them. */
export function checkOscillator(settings: OscillatorSettings): DomainResult<OscillatorSettings> {
  const { frequency, sampleRate, startPhase, amplitude } = settings;
  if (!Number.isFinite(startPhase) || !Number.isFinite(amplitude)) {
    return fail(
      failure(
        'dsp.oscillator-not-finite',
        FailureKind.Rejected,
        'An oscillator needs a finite starting phase and amplitude.',
      ),
    );
  }
  if (!(frequency > 0 && frequency <= sampleRate / 2)) {
    // A tone above half the rate is an alias of a lower one, so it is refused
    // rather than generated as a different pitch from the one asked for.
    return fail(
      failure(
        'dsp.oscillator-frequency-out-of-range',
        FailureKind.Rejected,
        'An oscillator frequency must be above zero and at most half the sample rate.',
        { details: { frequency: String(frequency), sampleRate } },
      ),
    );
  }
  return succeed(settings);
}

/** The settings, or why a resampler cannot be made from them. */
export function checkResampler(settings: ResamplerSettings): DomainResult<ResamplerSettings> {
  if (!Number.isInteger(settings.channels) || settings.channels < 1) {
    return fail(
      failure(
        'dsp.resampler-channels-invalid',
        FailureKind.Rejected,
        'A resampler needs a whole number of channels, at least one.',
        { details: { channels: String(settings.channels) } },
      ),
    );
  }
  if (!QUALITIES.has(settings.quality)) {
    return fail(
      failure(
        'dsp.resampler-quality-unknown',
        FailureKind.Rejected,
        'The resampling quality is not one AudioGubbins knows.',
        { details: { quality: String(settings.quality) } },
      ),
    );
  }
  return succeed(settings);
}

/**
 * The frames in `arrays`, one array per channel of a resampler of `channels`,
 * or a throw where they are not that shape: another number of arrays, or
 * arrays of different lengths. The engine owns every push and pull, so a
 * wrong shape is a fault in the engine, which the port throws for; checked
 * here, both implementations throw it for the same calls.
 */
export function framesOfPlanar(arrays: readonly Float32Array[], channels: number): number {
  const frames = arrays[0]?.length ?? 0;
  if (arrays.length !== channels) {
    throw new Error(
      `A resampler of ${String(channels)} channels was given ${String(arrays.length)} arrays.`,
    );
  }
  // Indexed rather than `some`, whose callback would be an object a call.
  for (let index = 1; index < arrays.length; index += 1) {
    if (arrays[index]?.length !== frames) {
      throw new Error('A resampler was given channel arrays of different lengths.');
    }
  }
  return frames;
}

/** Throws unless `frame` is a frame a resampler can seek to: a whole number from 0. */
export function assertSeekFrame(frame: number): void {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new Error(`A resampler cannot seek to frame ${String(frame)}.`);
  }
}
