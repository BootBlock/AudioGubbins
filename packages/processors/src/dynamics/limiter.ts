/**
 * Limiter: a look-ahead brick-wall limiter that keeps every true peak at or
 * under its ceiling.
 *
 * Its look-ahead of `L = floor((ms × fs) ÷ 1000 + 0.5)` frames, a half rounded
 * up, is its latency, with the true-peak detector's own (`true-peak.ts`) at an
 * oversampling above 1: `R − 1` frames the interpolator reads ahead and `R` the
 * gain is held flat on each side of a peak, where `R` is 37, the frames its
 * taps reach. So the latency is `L` at 1 and `L + 2R − 1` above it.
 * `limiter-gain.ts` states how the gain is made; `lead-in` adds seven release
 * time constants to the latency.
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
import type { NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { framesOf, settlingFrames } from './envelope.js';
import { LimiterKernel } from './limiter-gain.js';
import { RampedParameters, numberIn } from './ramped-parameters.js';
import { detectionDelay, interpolationReach } from './true-peak.js';

const ceiling: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0011'),
  key: 'ceiling',
  label: 'Ceiling',
  minimum: -12,
  maximum: 0,
  defaultValue: -1,
  taper: ParameterTaper.Decibel,
  unit: 'dBTP',
  step: 0.1,
};

const release: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0012'),
  key: 'release',
  label: 'Release',
  minimum: 1,
  maximum: 2_000,
  defaultValue: 100,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 1,
};

const lookAhead: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('b1000000-0013'),
  key: 'look-ahead',
  label: 'Look-ahead',
  minimum: 0.5,
  maximum: 20,
  defaultValue: 5,
  taper: ParameterTaper.Logarithmic,
  unit: 'ms',
  step: 0.1,
};

/** The latency, in frames, of a look-ahead of `lookAheadFrames` at `oversampling`. */
function latencyFrames(lookAheadFrames: number, oversampling: number): number {
  return lookAheadFrames + detectionDelay(oversampling) + interpolationReach(oversampling);
}

function latency(settings: ProcessorSettings): ProcessorLatency {
  const frames = latencyFrames(
    framesOf(numberIn(settings.values, lookAhead), settings.sampleRate),
    settings.quality.oversampling,
  );
  return { kind: 'known', frames: derivedSampleCount(frames) };
}

function leadIn(settings: ProcessorSettings): number {
  const { values, sampleRate } = settings;
  const delay = latencyFrames(
    framesOf(numberIn(values, lookAhead), sampleRate),
    settings.quality.oversampling,
  );
  return delay + settlingFrames(sampleRate, numberIn(values, release));
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  // The look-ahead is the latency the graph aligns every other path to, so it
  // cannot move while the limiter plays; the ceiling and the release can.
  const parameters = new RampedParameters('limiter', [ceiling, release], run.parameters, run);
  const lookAheadFrames = framesOf(run.parameters.number(lookAhead.key), run.sampleRate);
  return succeed(
    new LimiterKernel(parameters, run, {
      lookAheadFrames,
      latencyFrames: latencyFrames(lookAheadFrames, run.quality.oversampling),
      ceiling: parameters.frames(ceiling.key),
      release: parameters.frames(release.key),
    }),
  );
}

/** Limiter, as a processor of the rack. */
export const LIMITER = processorType({
  descriptor: {
    typeKey: 'limiter',
    label: 'Limiter',
    category: ProcessorCategory.Dynamics,
    version: { implementation: 1, parameters: 1 },
    parameters: [ceiling, release, lookAhead],
    qualitySettings: ['oversampling'],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: true,
    outputLayout: (input) => succeed(input),
    latency,
    leadIn,
  },
  kernel,
});
