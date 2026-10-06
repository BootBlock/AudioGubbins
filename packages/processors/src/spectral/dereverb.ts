/**
 * Dereverberation by weighted prediction error (`weighted-prediction.ts`),
 * each channel's late reverberation predicted from the frames of every
 * channel before it and subtracted, in a short-time Fourier transform.
 *
 * The recursive form, rather than the batch estimate over a whole pass: the
 * batch method iterates over every frame of the input, so its measurement
 * would hold the whole spectrum of an input of any length, and the kernel
 * could write nothing before it; the recursive form runs a frame at a time,
 * the same however the stream is cut, with only the transform's latency. A
 * preview started part way through hears the same kernel, which takes the
 * lead-in to learn the room again, on a grid of hops of its own where the
 * start is not a whole number of hops into the stream.
 *
 * - The frames are `N` samples, the largest power of two not above 1/16 s at
 *   the rate (2048 at 44.1 and 48 kHz; above 31.25 ms and at most 62.5 ms),
 *   `N / 2` apart. The hop is fixed rather than the quality's spectral
 *   overlap, since the prediction delay and the order count frames of it, and
 *   the latency is `N − 1`.
 * - The prediction delay `D` is at least 2, so no frame the filter reads
 *   shares a sample with the frame it predicts, which would let it cancel the
 *   direct sound and the reflections that follow it closely. By default the
 *   filter reads the frames 2 to 5 before, from 43 to 107 ms back at 48 kHz,
 *   the span ten taps of 8 ms frames reach in the method's usual setting.
 * - The filter reads `C · K` frames a bin, of `C` channels and order `K`, and
 *   costs about `(C · K)³ / 6` complex products a bin a frame to solve, so
 *   `C · K` is held to {@link MAXIMUM_TAPS} and a layout and order past it
 *   refused. It is heard from a cached render, as that cost on many channels
 *   is more than a quantum's budget.
 * - The strength and the adaptation time ramp as they move; the delay and the
 *   order size what the kernel holds.
 */

import {
  DeterminismClass,
  FailureKind,
  ParameterTaper,
  ProcessorCategory,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type ChannelLayout,
  type DomainResult,
  type NumericParameterDescriptor,
  type ParameterValues,
  type ProcessorSettings,
} from '@audiogubbins/domain';
import type { NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import { RampedParameters } from '../dynamics/ramped-parameters.js';
import { numberOf } from '../filters/parameter-values.js';
import { FrameAnalysis } from './frame-analysis.js';
import { SpectralKernel } from './spectral-kernel.js';
import { WeightedPrediction } from './weighted-prediction.js';

const TYPE = 'dereverberation';

/** The most frames, over every channel, the filter of one bin reads. */
export const MAXIMUM_TAPS = 48;

const strength: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d2000000-0011'),
  key: 'strength',
  label: 'Strength',
  minimum: 0,
  maximum: 100,
  defaultValue: 100,
  taper: ParameterTaper.Linear,
  unit: '%',
  step: 1,
};

const delay: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d2000000-0012'),
  key: 'delay',
  label: 'Prediction delay',
  minimum: 2,
  maximum: 8,
  defaultValue: 2,
  taper: ParameterTaper.Linear,
  step: 1,
};

const order: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d2000000-0013'),
  key: 'order',
  label: 'Filter order',
  minimum: 1,
  maximum: 24,
  defaultValue: 4,
  taper: ParameterTaper.Linear,
  step: 1,
};

const adaptation: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('d2000000-0014'),
  key: 'adaptation',
  label: 'Adaptation time',
  minimum: 0.5,
  maximum: 30,
  defaultValue: 4,
  taper: ParameterTaper.Logarithmic,
  unit: 's',
  step: 0.1,
};

/** The frame size at `rate`: the largest power of two not above `rate / 16`. */
export function dereverbFrameSize(rate: number): number {
  let size = 2;
  while (size * 2 * 16 <= rate) size *= 2;
  return size;
}

/** A delay or an order as the nearest whole number of frames, a half rounded up. */
function frames(value: number): number {
  return Math.floor(value + 0.5);
}

function outputLayout(input: ChannelLayout, values: ParameterValues): DomainResult<ChannelLayout> {
  const channels = input.roles.length;
  const taps = channels * frames(numberOf(values, order));
  if (taps <= MAXIMUM_TAPS) return succeed(input);
  const most = Math.floor(MAXIMUM_TAPS / channels);
  const lower =
    most === 0
      ? `it takes at most ${String(MAXIMUM_TAPS)} channels`
      : `set the order to ${String(most)} or less for this input`;
  return fail(
    failure(
      'processor.layout-refused',
      FailureKind.Rejected,
      `Dereverberation predicts each channel from ${String(taps)} frames a bin on this input, more than the ${String(MAXIMUM_TAPS)} it can solve for: ${lower}.`,
    ),
  );
}

/**
 * The latency, the frames of history the filter reads, and three adaptation
 * times in whole hops, after which what the statistics remember of where the
 * stream was entered, on the same grid of hops, is under 5 %.
 */
function leadIn({ values, sampleRate }: ProcessorSettings): number {
  const size = dereverbFrameSize(sampleRate);
  const hop = size / 2;
  const history = (frames(numberOf(values, delay)) + frames(numberOf(values, order))) * hop;
  const settle = Math.ceil((3 * numberOf(values, adaptation) * sampleRate) / hop) * hop;
  return size - 1 + history + settle;
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const size = dereverbFrameSize(run.sampleRate);
  const fft = run.dsp.createFft(size);
  if (!fft.ok) return fft;
  const analysis = new FrameAnalysis(fft.value, run.input.roles.length, size / 2);
  const ramps = new RampedParameters(TYPE, [strength, adaptation], run.parameters, run);
  const prediction = new WeightedPrediction({
    analysis,
    delay: frames(run.parameters.number(delay.key)),
    order: frames(run.parameters.number(order.key)),
    rate: run.sampleRate,
    strength: ramps.frames(strength.key),
    adaptation: ramps.frames(adaptation.key),
  });
  return succeed(new SpectralKernel(analysis, prediction, ramps));
}

/** Dereverberation by weighted prediction error, as a processor of the rack. */
export const DEREVERBERATION = processorType({
  descriptor: {
    typeKey: 'dereverb',
    label: 'Dereverberation',
    category: ProcessorCategory.Restoration,
    version: { implementation: 1, parameters: 1 },
    parameters: [strength, delay, order, adaptation],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: false,
    realTime: false,
    outputLayout,
    latency: ({ sampleRate }) => ({
      kind: 'known',
      frames: derivedSampleCount(dereverbFrameSize(sampleRate) - 1),
    }),
    leadIn,
    // A frame every half frame from the kernel's first, whatever the quality.
    frameGrid: ({ sampleRate }) => dereverbFrameSize(sampleRate) / 2,
  },
  kernel,
});
