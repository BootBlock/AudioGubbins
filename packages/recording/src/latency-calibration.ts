/**
 * A latency calibration, when it applies, and the compensation it gives a take
 * (`REQ-REC-095`, ADR-0070).
 *
 * A calibration belongs to one input device, one output device and one rate:
 * the round trip is the output's latency, the air and the input's latency, and
 * changing any of the three changes it. It holds the round trip the loopback
 * measured, split into the output's share the browser reports and the input's
 * share that leaves, and a manual offset the person may add or give alone.
 *
 * An output the browser cannot name is kept as the unknown output: a
 * calibration taken there applies wherever the output is still unknown, since
 * a change between two outputs the browser names neither of cannot be told.
 *
 * The compensation is a take's placement: the frames its start is moved
 * earlier so it lines up with what the person heard while recording. It is a
 * number on the take (ADR-0072), and the recorded samples are never moved.
 */

import {
  FailureKind,
  derivedSampleCount,
  fail,
  failure,
  succeed,
  type DomainResult,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';

import {
  isSameDevice,
  isSameOutput,
  type DeviceIdentity,
  type OutputIdentity,
} from './device-identity.js';
import type { LoopbackMeasurement } from './loopback-analysis.js';

/** The input device, output device and rate a calibration is kept for. */
export interface CalibrationPath {
  readonly input: DeviceIdentity;
  readonly output: OutputIdentity;
  readonly rate: SampleRate;
}

/** What a loopback measured, in frames at the calibration's rate. */
export interface MeasuredLatency {
  readonly roundTrip: SampleCount;

  /** The output's latency the browser reported when the measurement was taken. */
  readonly output: SampleCount;

  /** The round trip less the output: the input's share. */
  readonly input: SampleCount;

  /** The measurement's confidence (`loopback-analysis.ts`). */
  readonly peakRatio: number;

  /** When it was measured, in milliseconds since the epoch. */
  readonly at: number;
}

/** A calibration of one path. */
export interface LatencyCalibration extends CalibrationPath {
  /** The loopback's measurement, where one was taken: a manual offset may stand alone. */
  readonly measured?: MeasuredLatency;

  /** Frames the person adds to the compensation, either way: later is positive. */
  readonly manualOffset: number;
}

/**
 * The calibration of `path` from `measurement`, with the output's latency the
 * browser reports in seconds; or why the measurement and the report cannot both
 * be right. Its manual offset is none: an offset corrected the measurement it
 * was given beside, and a new measurement replaces that.
 */
export function measuredCalibration(
  path: CalibrationPath,
  measurement: LoopbackMeasurement,
  outputLatency: number,
  at: number,
): DomainResult<LatencyCalibration> {
  const output = Math.round(outputLatency * path.rate);
  const input = measurement.roundTrip - output;
  if (!Number.isFinite(outputLatency) || output < 0 || input < 0) {
    return fail(
      failure(
        'recording.calibration-inconsistent',
        FailureKind.Rejected,
        'The measured round trip is shorter than the output latency the browser reports, so one of them is wrong: measure again, or give a manual offset.',
        { details: { roundTrip: measurement.roundTrip, output } },
      ),
    );
  }
  return succeed({
    ...pathOf(path),
    measured: {
      roundTrip: measurement.roundTrip,
      output: derivedSampleCount(output),
      input: derivedSampleCount(input),
      peakRatio: measurement.peakRatio,
      at,
    },
    manualOffset: 0,
  });
}

/** A calibration of `path` by a manual offset of `frames` alone, or why the offset is refused. */
export function manualCalibration(
  path: CalibrationPath,
  frames: number,
): DomainResult<LatencyCalibration> {
  return withManualOffset({ ...pathOf(path), manualOffset: 0 }, frames);
}

/** `calibration` with the manual offset `frames`, or why the offset is refused. */
export function withManualOffset(
  calibration: LatencyCalibration,
  frames: number,
): DomainResult<LatencyCalibration> {
  if (!Number.isSafeInteger(frames)) {
    return fail(
      failure(
        'recording.offset-not-whole',
        FailureKind.Rejected,
        'A manual offset is a whole number of frames.',
        { details: { frames: String(frames) } },
      ),
    );
  }
  return succeed({ ...calibration, manualOffset: frames });
}

/** The path alone, of a value that may be a whole calibration of it. */
function pathOf({ input, output, rate }: CalibrationPath): CalibrationPath {
  return { input, output, rate };
}

/** What of a path changed since a calibration was taken. */
export type PathChange = 'input' | 'output' | 'rate';

/**
 * Whether `calibration` applies to `current`, or each change that means a
 * new one should be asked for. The person decides whether to measure again.
 */
export function pathChanges(
  calibration: CalibrationPath,
  current: CalibrationPath,
): readonly PathChange[] {
  const changes: PathChange[] = [];
  if (!isSameDevice(calibration.input, current.input)) changes.push('input');
  if (!isSameOutput(calibration.output, current.output)) changes.push('output');
  if (calibration.rate !== current.rate) changes.push('rate');
  return changes;
}

/** The kept calibration of `current`, where one applies. */
export function calibrationOf(
  kept: readonly LatencyCalibration[],
  current: CalibrationPath,
): LatencyCalibration | undefined {
  return kept.find((calibration) => pathChanges(calibration, current).length === 0);
}

/** The latencies the browser reports for the current path, in seconds. */
export interface ReportedLatency {
  readonly output: number;

  /** The input track's latency, which not every browser reports. */
  readonly input?: number;
}

/** What a take's compensation is made of, for the diagnostics to state. */
export type CompensationBasis =
  /** A loopback measured the round trip on this path. */
  | 'measured'
  /** The browser's reports of the output's and the input's latency. */
  | 'reported'
  /** The output's latency alone: the browser reports none for the input. */
  | 'output-only';

/** The compensation a take is given, and what it rests on. */
export interface TakeCompensation {
  /** The frames the take's start is moved earlier, at the path's rate; may be negative. */
  readonly frames: number;
  readonly basis: CompensationBasis;
  readonly manualOffset: number;
}

/**
 * The compensation a take recorded on `current` is given: the round trip a kept
 * calibration of the path measured or, without one, the browser's reports, plus
 * the calibration's manual offset.
 */
export function takeCompensation(
  kept: readonly LatencyCalibration[],
  current: CalibrationPath,
  reported: ReportedLatency,
): TakeCompensation {
  const calibration = calibrationOf(kept, current);
  const manualOffset = calibration?.manualOffset ?? 0;
  if (calibration?.measured !== undefined) {
    return {
      frames: calibration.measured.roundTrip + manualOffset,
      basis: 'measured',
      manualOffset,
    };
  }
  const output = Math.round(reported.output * current.rate);
  return reported.input === undefined
    ? { frames: output + manualOffset, basis: 'output-only', manualOffset }
    : {
        frames: output + Math.round(reported.input * current.rate) + manualOffset,
        basis: 'reported',
        manualOffset,
      };
}
