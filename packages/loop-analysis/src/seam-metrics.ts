/**
 * Every metric of one pair of loop boundaries (ADR-0103, the plan's metric
 * table), read from what one pass kept (`loop-capture.ts`), so the loop as it
 * is and each candidate a search finds are measured by the same rules.
 *
 * Sums are taken in f64 in index order, every logarithm, power and
 * trigonometric function is the canonical primitive, and a denominator is
 * floored at 2⁻²⁴, so a measurement is the same on every machine (ADR-0032).
 */

import {
  ZeroCrossingEdges,
  gainToDecibels,
  isZeroCrossingBoundary,
} from '@audiogubbins/audio-engine';

import type { CrossfadeSuitability } from './crossfade-suitability.js';
import { cycleDrift, seamStability } from './cycle-stability.js';
import type { LoopCapture } from './loop-capture.js';
import { dcSpanFrames, isCyclic, seamReference, type SeamPlace } from './loop-windows.js';
import type { MeasuringKit } from './measuring-kit.js';
import { dominantPartial, phaseMismatch } from './phase-mismatch.js';
import { LEAST_DEVIATION } from './seam-residual.js';
import { seamDiscontinuity } from './seam-discontinuity.js';
import { spectralMismatch } from './spectral-mismatch.js';
import {
  type ChannelReading,
  type LoopMetric,
  type SeamReference,
  notApplicable,
  wholeMetric,
  worstChannel,
} from './verdicts.js';
import { cyclicFrames, seamWindows, type SeamWindows } from './seam-windows.js';

/** Every metric of a loop's seam. */
export interface LoopMetrics {
  /** The Burg residual at the seam, in deviations. */
  readonly discontinuity: LoopMetric;
  readonly dcMismatch: LoopMetric;
  readonly netDc: LoopMetric;
  readonly levelMismatch: LoopMetric;
  readonly phaseMismatch: LoopMetric;
  readonly spectralMismatch: LoopMetric;
  readonly zeroCrossing: {
    readonly start: LoopMetric;
    readonly end: LoopMetric;
    readonly signs: LoopMetric;
  };
  /** Where the loop has a crossfade: how well it suits the seam. */
  readonly crossfade: CrossfadeSuitability | undefined;
  readonly cycleStability: { readonly seam: LoopMetric; readonly drift: LoopMetric };
}

/** A pair's metrics, and the dominant partial they found, which a micro-crossfade's length follows. */
export interface PairMeasurement {
  readonly metrics: LoopMetrics;
  /** The lowest dominant partial of any channel, in hertz, or `undefined` where none stands. */
  readonly dominantHertz: number | undefined;
}

/** Why a loop read around itself has no spectral or phase metric. */
const TOO_SHORT_FOR_A_SPECTRUM =
  'A loop shorter than 256 frames has too few frames for a spectrum.';

/** Why a channel has no phase mismatch. */
const NO_PARTIAL = 'No partial stands 20 dB above the median of the spectrum.';

/** Why a spectrum had no band to compare. */
const NO_BANDS = 'The window is too short for its spectrum to hold a band.';

/** The level in dBFS of a magnitude, floored at 2⁻²⁴. */
function decibelsOf(magnitude: number): number {
  return gainToDecibels(Math.max(magnitude, LEAST_DEVIATION));
}

/** The Blackman–Harris-weighted mean of `samples`. */
function weightedMean(kit: MeasuringKit, samples: Float32Array): number {
  const weights = kit.window(samples.length);
  let sum = 0;
  let weight = 0;
  for (let n = 0; n < samples.length; n += 1) {
    sum += (weights[n] ?? 0) * (samples[n] ?? 0);
    weight += weights[n] ?? 0;
  }
  return sum / weight;
}

/** The root mean square of `samples`. */
function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/**
 * The spans whose weighted means the DC mismatch compares by `reference`:
 * as long as the DC span, the loop and the audio the reference reads allow.
 * The loop's own tail and head are read around the loop, as the engine plays
 * them, so a loop shorter than the span has one DC, never two halves of a
 * cycle compared as if they were offsets.
 */
function dcSpans(
  capture: LoopCapture,
  place: SeamPlace,
  reference: SeamReference,
  channel: number,
): readonly [Float32Array, Float32Array] {
  const { start, end, regionLength } = place;
  const length = end - start;
  const longest = dcSpanFrames(capture.sampleRate, place.window);
  switch (reference) {
    case 'post-end': {
      const span = Math.min(longest, length, regionLength - end);
      return [
        capture.samples(channel, start, start + span),
        capture.samples(channel, end, end + span),
      ];
    }
    case 'pre-start': {
      const span = Math.min(longest, length, start);
      return [
        capture.samples(channel, end - span, end),
        capture.samples(channel, start - span, start),
      ];
    }
    case 'adjacent': {
      const span = Math.min(longest, length);
      return [
        cyclicFrames(capture, channel, start, length, -span, span),
        cyclicFrames(capture, channel, start, length, 0, span),
      ];
    }
  }
}

/** How far the nearest interior zero crossing of every channel lies from `boundary`, within 1 ms. */
function crossingDistance(capture: LoopCapture, boundary: number): LoopMetric {
  const reach = Math.max(1, Math.round(0.001 * capture.sampleRate));
  const from = Math.max(0, boundary - reach - 1);
  const to = Math.min(capture.regionLength, boundary + reach + 1);
  const channels = Array.from({ length: capture.channels }, (_, channel) => channel);
  const samples = {
    channels: channels.map((channel) => capture.samples(channel, from, to)),
    from,
    length: capture.regionLength,
  };
  for (let distance = 0; distance <= reach; distance += 1) {
    for (const at of distance === 0 ? [boundary] : [boundary - distance, boundary + distance]) {
      if (
        at >= from &&
        at <= to &&
        isZeroCrossingBoundary(samples, at, channels, ZeroCrossingEdges.Interior)
      ) {
        return wholeMetric('zeroCrossing', distance);
      }
    }
  }
  // None within 1 ms: reported as one frame beyond the reach searched.
  return wholeMetric('zeroCrossing', reach + 1);
}

/** The signs that meet at the seam by `reference`: what the engine plays, and what should be there. */
function seamSigns(
  capture: LoopCapture,
  place: SeamPlace,
  reference: SeamReference,
  channel: number,
): readonly [number, number] {
  const { start, end } = place;
  const at = (frame: number): number => capture.samples(channel, frame, frame + 1)[0] ?? 0;
  switch (reference) {
    case 'post-end':
      return [at(start), at(end)];
    case 'pre-start':
      return [at(end - 1), at(start - 1)];
    case 'adjacent':
      return [at(end - 1), at(start)];
  }
}

/** The share of channels whose signs disagree across the seam, neither being zero. */
function signMismatch(
  capture: LoopCapture,
  place: SeamPlace,
  reference: SeamReference,
): LoopMetric {
  let differing = 0;
  for (let channel = 0; channel < capture.channels; channel += 1) {
    const [played, expected] = seamSigns(capture, place, reference, channel);
    if (played !== 0 && expected !== 0 && played > 0 !== expected > 0) differing += 1;
  }
  return wholeMetric('zeroCrossingSigns', differing / capture.channels, reference);
}

/** The spectral and phase readings of each channel. */
function spectralReadings(
  kit: MeasuringKit,
  windows: readonly SeamWindows[],
  reference: SeamReference,
): {
  readonly phase: readonly ChannelReading[];
  readonly spectral: readonly ChannelReading[];
  readonly dominantHertz: number | undefined;
} {
  let dominantHertz: number | undefined;
  const phase: ChannelReading[] = [];
  const spectral: ChannelReading[] = [];
  for (const { compared } of windows) {
    const [a, b, distance] = compared;
    const partial = dominantPartial(kit, a, b);
    if (partial === undefined) {
      phase.push({ notApplicable: NO_PARTIAL });
    } else {
      dominantHertz = Math.min(dominantHertz ?? partial, partial);
      phase.push({ value: phaseMismatch(kit, a, b, partial, distance), reference });
    }
    const mismatch = spectralMismatch(kit, a, b);
    spectral.push(
      mismatch === undefined ? { notApplicable: NO_BANDS } : { value: mismatch, reference },
    );
  }
  return { phase, spectral, dominantHertz };
}

/** Each channel's DC mismatch by `reference`, in dBFS. */
function dcReadings(
  capture: LoopCapture,
  kit: MeasuringKit,
  place: SeamPlace,
  reference: SeamReference,
): readonly ChannelReading[] {
  return Array.from({ length: capture.channels }, (_, channel) => {
    const [first, second] = dcSpans(capture, place, reference, channel);
    return {
      value: decibelsOf(Math.abs(weightedMean(kit, first) - weightedMean(kit, second))),
      reference,
    };
  });
}

/** Each channel's net DC over the loop, from the running sums at its boundaries, in dBFS. */
function netDcReadings(capture: LoopCapture, place: SeamPlace): readonly ChannelReading[] {
  const { start, end } = place;
  return Array.from({ length: capture.channels }, (_, channel) => {
    const sum = capture.sumBefore(channel, end) - capture.sumBefore(channel, start);
    return { value: decibelsOf(Math.abs(sum / (end - start))) };
  });
}

/** Each channel's level mismatch between what plays and what should, in dB. */
function levelReadings(
  windows: readonly SeamWindows[],
  reference: SeamReference,
): readonly ChannelReading[] {
  return windows.map(({ compared: [a, b] }) => {
    const played = rmsOf(a);
    const expected = rmsOf(b);
    if (Math.max(played, expected) < LEAST_DEVIATION) return { value: 0, reference };
    const ratio = Math.max(played, LEAST_DEVIATION) / Math.max(expected, LEAST_DEVIATION);
    return { value: Math.abs(gainToDecibels(ratio)), reference };
  });
}

/** Every metric of the loop `place` names, from `capture`. */
export function measurePair(
  capture: LoopCapture,
  kit: MeasuringKit,
  place: SeamPlace,
): PairMeasurement {
  const { start, end } = place;
  const reference = seamReference(place);
  const windows = Array.from({ length: capture.channels }, (_, channel) =>
    seamWindows(capture, place, reference, channel),
  );
  const spectra = isCyclic(end - start) ? undefined : spectralReadings(kit, windows, reference);
  return {
    metrics: {
      discontinuity: worstChannel('discontinuity', seamDiscontinuity(kit, place, windows)),
      dcMismatch: worstChannel('dcMismatch', dcReadings(capture, kit, place, reference)),
      netDc: worstChannel('netDc', netDcReadings(capture, place)),
      levelMismatch: worstChannel('levelMismatch', levelReadings(windows, reference)),
      phaseMismatch:
        spectra === undefined
          ? notApplicable('phaseMismatch', TOO_SHORT_FOR_A_SPECTRUM)
          : worstChannel('phaseMismatch', spectra.phase),
      spectralMismatch:
        spectra === undefined
          ? notApplicable('spectralMismatch', TOO_SHORT_FOR_A_SPECTRUM)
          : worstChannel('spectralMismatch', spectra.spectral),
      zeroCrossing: {
        start: crossingDistance(capture, start),
        end: crossingDistance(capture, end),
        signs: signMismatch(capture, place, reference),
      },
      crossfade: undefined,
      cycleStability: {
        seam: worstChannel('cycleSeam', seamStability(capture, start, end)),
        drift: worstChannel('cycleDrift', cycleDrift(capture, start, end)),
      },
    },
    dominantHertz: spectra?.dominantHertz,
  };
}
