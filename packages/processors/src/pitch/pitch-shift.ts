/**
 * Pitch shift: every partial moved by a number of semitones and cents, the
 * length and the timing kept, by the phase-locked shift of Laroche and Dolson
 * in the frequency domain (`peak-shift.ts`), with no conversion of rate.
 *
 * The frames are `N` samples, the stretch's window at the rate
 * (`stretchWindow`: the power of two at or above 80 ms), which resolves a low
 * partial without smearing a transient much past a beat's subdivision; the
 * quality's spectral overlap `O` sets their hop, `N/O`. The latency is
 * `N − 1` (`pitch-kernel.ts`), whatever the overlap and the shift.
 *
 * The channels are linked: one set of peaks, found on the sum of their
 * magnitudes, and one set of moves and rotations, so every channel takes the
 * same linear map of its spectrum. A source's share of each channel is
 * therefore kept, so a stereo image stays where it was, and so does each
 * direction of an ambisonic set, whose components are the same sources in
 * fixed shares: any layout is taken and kept.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  derivedSampleCount,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type NumericParameterDescriptor,
  type ProcessorLatency,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import { stretchWindow, vocoderWindow, type NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { RampedParameters } from '../dynamics/ramped-parameters.js';
import { PitchKernel } from './pitch-kernel.js';

const TYPE = 'pitch-shift';

const semitones: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d3000000-0001'),
  key: 'semitones',
  label: 'Semitones',
  minimum: -24,
  maximum: 24,
  defaultValue: 0,
  taper: ParameterTaper.Linear,
  unit: 'st',
  step: 0.01,
};

const cents: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d3000000-0002'),
  key: 'cents',
  label: 'Cents',
  minimum: -100,
  maximum: 100,
  defaultValue: 0,
  taper: ParameterTaper.Linear,
  unit: 'ct',
  step: 1,
};

const MOVING = [semitones, cents];

function latency({ sampleRate }: ProcessorSettings): ProcessorLatency {
  return { kind: 'known', frames: derivedSampleCount(stretchWindow(sampleRate) - 1) };
}

/**
 * The `N − 1` frames before a sample that the frames holding it read, the
 * latency again: each frame is measured on its own spectrum, so nothing
 * older reaches it. Each partial's rotation is a sum from the stream's
 * start, so a run started part way gives it a different constant phase,
 * which is heard as nothing.
 */
function leadIn({ sampleRate }: ProcessorSettings): number {
  return stretchWindow(sampleRate) - 1;
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const size = stretchWindow(run.sampleRate);
  const fft = run.dsp.createFft(size);
  if (!fft.ok) return fft;
  return succeed(
    new PitchKernel({
      fft: fft.value,
      window: vocoderWindow(size),
      overlap: run.quality.spectralOverlap,
      channels: run.input.roles.length,
      ramps: new RampedParameters(TYPE, MOVING, run.parameters, run),
      semitones: semitones.key,
      cents: cents.key,
    }),
  );
}

/** Pitch shift, as a processor of the rack. */
export const PITCH_SHIFT = processorType({
  descriptor: {
    typeKey: TYPE,
    label: 'Pitch shift',
    category: ProcessorCategory.Pitch,
    version: { implementation: 1, parameters: 1 },
    parameters: [semitones, cents],
    qualitySettings: ['spectralOverlap'],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout: (input) => succeed(input),
    latency,
    leadIn,
    // Each frame is analysed and overlap-added a hop apart from the kernel's
    // first frame.
    frameGrid: ({ sampleRate, quality }) => stretchWindow(sampleRate) / quality.spectralOverlap,
  },
  kernel,
});
