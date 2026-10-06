/**
 * Loudness normalisation: the whole signal raised or lowered by one gain, so
 * its integrated loudness meets a target, by default EBU R 128's −23 LUFS.
 *
 * Its whole pass reads the canonical loudness meter, which weights each
 * channel by its role as ITU-R BS.1770-4 does, and the canonical peak meter.
 * The measurement it carries is the run's header, then whether any block
 * passed the absolute gate (1 or 0), the integrated loudness in LUFS (0 where
 * none did, a node's numbers being finite), and the true peak, linear, the
 * largest over all channels. The gain is `decibelsToGain(target − loudness)`.
 * A signal below the absolute gate has no integrated loudness, and keeps a
 * gain of 1.
 *
 * With the ceiling on, the gain is then limited to
 * `decibelsToGain(ceiling) ÷ true peak`, so the measured true peak after the
 * gain stays at or under the ceiling. That is a limit on one gain, not a
 * limiter: where the ceiling binds, the result is quieter than the target, as
 * it must be to keep both the ceiling and the programme's dynamics. The ceiling
 * holds below the gate too, where the gain would otherwise be 1.
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
  type DomainResult,
  type NumericParameterDescriptor,
  type ToggleParameterDescriptor,
} from '@audiogubbins/domain';
import { decibelsToGain, type NodeKernel } from '@audiogubbins/audio-engine';

import { processorType, type Measurer, type ProcessorRun } from '../framework/processor-type.js';
import { levelKernel } from './level-gain.js';
import {
  TRUE_PEAK,
  WholePassMeasurer,
  linkedPeak,
  measuredValues,
  meterOf,
  type MeasuringRun,
} from './normalisation-measurement.js';

const target: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('e1000000-0011'),
  key: 'target',
  label: 'Target loudness',
  minimum: -70,
  maximum: 0,
  defaultValue: -23,
  taper: ParameterTaper.Decibel,
  unit: 'LUFS',
  step: 0.1,
};

const limitPeak: ToggleParameterDescriptor = {
  kind: 'toggle',
  id: unsafeBrandId<'ParameterId'>('e1000000-0012'),
  key: 'limit-true-peak',
  label: 'Limit true peak',
  defaultValue: false,
};

const ceiling: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('e1000000-0013'),
  key: 'ceiling',
  label: 'True-peak ceiling',
  minimum: -12,
  maximum: 0,
  defaultValue: -1,
  taper: ParameterTaper.Decibel,
  unit: 'dBTP',
  step: 0.1,
};

/** The values the measurement holds after its header: gated, loudness, true peak. */
const MEASURED_VALUES = 3;

/** The momentary and short-term pairs drained from the loudness meter at a time. */
const SERIES_PAIRS = 64;

function measure(run: MeasuringRun): Measurer {
  const channels = run.input.roles.length;
  const { sampleRate } = run;
  const loudness = meterOf(run.dsp.createLoudnessMeter({ sampleRate, layout: run.input }));
  const peaks = meterOf(run.dsp.createPeakMeter({ channels, sampleRate }));
  const reading = new Float64Array(4 * channels);
  const series = new Float64Array(2 * SERIES_PAIRS);
  return new WholePassMeasurer(run, {
    push: (chunk) => {
      loudness.push(chunk);
      peaks.push(chunk);
      // The meter keeps every pair until it is pulled; none is needed here,
      // and drained it holds nothing that grows with the stream's length.
      let pulled = loudness.pullSeries(series);
      while (pulled > 0) pulled = loudness.pullSeries(series);
    },
    finish: () => {
      const { integrated } = loudness.read();
      peaks.read(reading);
      const gated = Number.isFinite(integrated);
      return [gated ? 1 : 0, gated ? integrated : 0, linkedPeak(reading, TRUE_PEAK)];
    },
    release: () => {
      loudness.release();
      peaks.release();
    },
  });
}

/** What a kernel's gain is made from, beside the values that move. */
interface Measured {
  readonly gated: boolean;
  readonly loudness: number;
  readonly truePeak: number;
}

/** The gain for `targetLevel` and, where `limited`, `ceilingLevel`: 1 where nothing was gated. */
function gainFor(
  measured: Measured,
  targetLevel: number,
  limited: boolean,
  ceilingLevel: number,
): number {
  const toTarget = measured.gated ? decibelsToGain(targetLevel - measured.loudness) : 1;
  if (!limited || measured.truePeak <= 0) return toTarget;
  return Math.min(toTarget, decibelsToGain(ceilingLevel) / measured.truePeak);
}

function kernel(run: ProcessorRun): DomainResult<NodeKernel> {
  const values = measuredValues(run, MEASURED_VALUES);
  const label = 'loudness normalisation';
  // A toggle changes what the gain is made of, so only the levels move.
  const moving = [target, ceiling];
  if (values === undefined) return levelKernel(run, { label, moving, law: () => 1 });
  const measured: Measured = {
    gated: values[0] === 1,
    loudness: values[1] ?? 0,
    truePeak: values[2] ?? 0,
  };
  const limited = run.parameters.toggle(limitPeak.key);
  return levelKernel(run, {
    label,
    moving,
    law: (levels) =>
      gainFor(
        measured,
        levels[0] ?? target.defaultValue,
        limited,
        levels[1] ?? ceiling.defaultValue,
      ),
  });
}

/** Loudness normalisation, as a processor of the rack. */
export const LOUDNESS_NORMALISATION = processorType({
  descriptor: {
    typeKey: 'loudness-normalisation',
    label: 'Loudness normalisation',
    category: ProcessorCategory.Level,
    version: { implementation: 1, parameters: 1 },
    parameters: [target, limitPeak, ceiling],
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
