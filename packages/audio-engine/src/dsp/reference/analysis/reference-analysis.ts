/**
 * The measuring objects of the port, answered by the reference path: each
 * checks a call's shape as the WebAssembly path does, then runs the
 * reference implementation, which holds no memory outside itself, so
 * releasing one leaves it to be collected.
 */

import { STFT_OUTPUTS, assertLength, framesOf } from '../../analysis-settings.js';
import {
  DetectorKind,
  type CanonicalDetectorFeatures,
  type CanonicalLoudnessMeter,
  type CanonicalPeakMeter,
  type CanonicalStft,
  type DetectorSettings,
  type LoudnessMeterSettings,
  type PeakMeterSettings,
  type StftSettings,
} from '../../canonical-analysis.js';
import { loudnessWeights } from '../../loudness-weights.js';
import { ReferenceClicks } from './clicks.js';
import { ReferenceClipping } from './clipping.js';
import { ReferenceDcOffset } from './dc-offset.js';
import type { FeatureExtractor } from './feature-extractor.js';
import { ReferenceHum } from './hum.js';
import { ReferenceLoudnessMeter } from './loudness-meter.js';
import { ReferenceNoiseFloor } from './noise-floor.js';
import { ReferencePeakMeter } from './peak-meter.js';
import { ReferenceSilence } from './silence.js';
import { ReferenceStft } from './stft.js';
import { ReferenceTransients } from './transients.js';

/** A short-time Fourier transform on the reference path, its settings checked. */
export function referenceStft({ channels, size, hop, window }: StftSettings): CanonicalStft {
  const stft = new ReferenceStft(channels, size, hop, window);
  const length = channels * stft.bins;
  const what = 'A short-time Fourier transform';
  return {
    channels,
    size,
    hop,
    bins: stft.bins,
    push: (input) => {
      stft.push(input, framesOf(input, channels, what));
    },
    pullComplex: (real, imaginary) => {
      assertLength(real, length, STFT_OUTPUTS.real);
      assertLength(imaginary, length, STFT_OUTPUTS.imaginary);
      return stft.pullComplex(real, imaginary);
    },
    pullPolar: (magnitude, phase) => {
      assertLength(magnitude, length, STFT_OUTPUTS.magnitudes);
      assertLength(phase, length, STFT_OUTPUTS.phases);
      return stft.pullPolar(magnitude, phase);
    },
    release: () => undefined,
  };
}

/** A peak meter on the reference path, its settings checked. */
export function referencePeakMeter({
  channels,
  sampleRate,
}: PeakMeterSettings): CanonicalPeakMeter {
  const meter = new ReferencePeakMeter(channels, sampleRate);
  return {
    channels,
    push: (input) => {
      framesOf(input, channels, 'A peak meter');
      meter.push(input);
    },
    read: (into) => {
      assertLength(into, 4 * channels, 'A peak meter’s reading');
      meter.read(into);
    },
    release: () => undefined,
  };
}

/** A loudness meter on the reference path, its settings checked. */
export function referenceLoudnessMeter(settings: LoudnessMeterSettings): CanonicalLoudnessMeter {
  const meter = new ReferenceLoudnessMeter(settings.sampleRate, loudnessWeights(settings.layout));
  const channels = meter.channels;
  return {
    channels,
    push: (input) => {
      meter.push(input, framesOf(input, channels, 'A loudness meter'));
    },
    pullSeries: (into) => meter.pullSeries(into),
    read: () => ({ integrated: meter.integrated(), range: meter.range() }),
    release: () => undefined,
  };
}

/** The reference extractor `settings` describe. */
function extractorOf(settings: DetectorSettings): FeatureExtractor {
  const { channels } = settings;
  switch (settings.kind) {
    case DetectorKind.Clicks:
      return new ReferenceClicks(channels, settings.block, settings.sensitivity);
    case DetectorKind.Hum:
      return new ReferenceHum(
        channels,
        settings.sampleRate,
        { size: settings.size, hop: settings.hop },
        { search: settings.searchWidth, floor: settings.floorWidth },
      );
    case DetectorKind.NoiseFloor:
      return new ReferenceNoiseFloor(
        channels,
        settings.frame,
        settings.hop,
        settings.percentile,
        settings.history,
      );
    case DetectorKind.Clipping:
      return new ReferenceClipping(channels, settings.block, settings.epsilon, settings.minimumRun);
    case DetectorKind.DcOffset:
      return new ReferenceDcOffset(channels, settings.window, settings.hop);
    case DetectorKind.Transients:
      return new ReferenceTransients(channels, settings.size, settings.hop, settings);
    case DetectorKind.Silence:
      return new ReferenceSilence(channels, settings.block, settings.threshold);
  }
}

/** A detector's feature extractor on the reference path, its settings checked. */
export function referenceDetector(settings: DetectorSettings): CanonicalDetectorFeatures {
  const extractor = extractorOf(settings);
  const { kind, channels } = settings;
  const what = `A ${kind} detector`;
  return {
    kind,
    channels,
    recordWidth: extractor.recordWidth,
    push: (input) => {
      extractor.push(input, framesOf(input, channels, what));
    },
    pull: (into) => extractor.pull(into),
    release: () => undefined,
  };
}
