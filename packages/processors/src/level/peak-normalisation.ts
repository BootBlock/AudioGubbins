/**
 * Peak normalisation: the whole signal raised or lowered by one gain, so its
 * highest peak meets a target level.
 *
 * Its whole pass reads the canonical peak meter over every channel, and the
 * measurement it carries is the run's header then two linear peaks, each the
 * largest over all channels: the sample peak, then the true peak in the
 * meter's terms (`peak.rs`). The peaks are linked, so one gain serves every
 * channel and the balance between them, or an ambisonic sound field, is kept.
 * Detection picks which peak meets the target. The gain is
 * `decibelsToGain(target) ÷ peak`, the same quantity as
 * `decibelsToGain(target − measured)` with the measured peak in decibels, by
 * one rounding fewer. A signal whose peak is 0, silence, has no level to
 * move, and keeps a gain of 1.
 *
 * Constant gain delays nothing and remembers nothing: latency 0, lead-in 0.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  unsafeBrandId,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type NumericParameterDescriptor,
} from '@audiogubbins/domain';
import { decibelsToGain, type NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorRun } from '../framework/processor-type.js';
import type { Measurer } from '../framework/whole-pass.js';
import { levelKernel } from './level-gain.js';
import {
  SAMPLE_PEAK,
  TRUE_PEAK,
  WholePassMeasurer,
  linkedPeak,
  measuredValues,
  meterOf,
  type MeasuringRun,
} from './normalisation-measurement.js';

const target: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('e1000000-0001'),
  key: 'target',
  label: 'Target peak',
  minimum: -60,
  maximum: 0,
  defaultValue: -1,
  taper: ParameterTaper.Decibel,
  unit: 'dB',
  step: 0.1,
};

/** The detections, by option key. */
const SAMPLE = 'sample-peak';
const TRUE = 'true-peak';

const detection: ChoiceParameterDescriptor = {
  kind: 'choice',
  id: unsafeBrandId<'ParameterId'>('e1000000-0002'),
  key: 'detection',
  label: 'Detection',
  options: [
    { key: SAMPLE, label: 'Sample peak (dBFS)' },
    { key: TRUE, label: 'True peak (dBTP)' },
  ],
  defaultKey: SAMPLE,
};

/** The values the measurement holds after its header: the linked sample peak, then true peak. */
const MEASURED_VALUES = 2;

function measure(run: MeasuringRun): Measurer {
  const channels = run.input.roles.length;
  const meter = meterOf(run.dsp.createPeakMeter({ channels, sampleRate: run.sampleRate }));
  const reading = new Float64Array(4 * channels);
  return new WholePassMeasurer(run, {
    push: (chunk) => {
      meter.push(chunk);
    },
    finish: () => {
      meter.read(reading);
      return [linkedPeak(reading, SAMPLE_PEAK), linkedPeak(reading, TRUE_PEAK)];
    },
    release: () => {
      meter.release();
    },
  });
}

/** The gain that takes `peak`, linear, to `targetLevel` in decibels: 1 for silence or no peak. */
function gainFor(targetLevel: number, peak: number | undefined): number {
  return peak === undefined || peak <= 0 ? 1 : decibelsToGain(targetLevel) / peak;
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const label = 'peak normalisation';
  const measured = measuredValues(run, MEASURED_VALUES, label);
  if (!measured.ok) return measured;
  // A choice changes what the kernel measures against, so only the target moves.
  const values = measured.value;
  const peak = run.parameters.choice(detection.key) === TRUE ? values?.[1] : values?.[0];
  return levelKernel(run, {
    label,
    moving: [target],
    law: (values) => gainFor(values[0] ?? target.defaultValue, peak),
  });
}

/** Peak normalisation, as a processor of the rack. */
export const PEAK_NORMALISATION = processorType({
  descriptor: {
    typeKey: 'peak-normalisation',
    label: 'Peak normalisation',
    category: ProcessorCategory.Level,
    version: { implementation: 1, parameters: 1 },
    parameters: [target, detection],
    qualitySettings: [],
    determinism: DeterminismClass.Canonical,
    wholePass: true,
    realTime: true,
    outputLayout: (input) => succeed(input),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn: () => 0,
    frameGrid: () => 1,
  },
  kernel,
  measure,
});
