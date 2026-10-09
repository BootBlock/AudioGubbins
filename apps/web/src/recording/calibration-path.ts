/**
 * The latency path a take is recorded on, and the compensation it is given
 * (`ADR-0070`, `REQ-REC-095`): the input open now, or the one chosen, to the
 * output the page plays through, at the context's rate; and the frames a take
 * recorded on it is placed earlier by, from a kept calibration or, without one,
 * the browser's reports.
 *
 * The compensation is a take's placement, never a change to its samples: the
 * storage keeps it on the take, and the punch reads the take shifted by it.
 */

import { sampleRate } from '@audiogubbins/domain';
import {
  takeCompensation,
  type CalibrationPath,
  type TakeCompensation,
} from '@audiogubbins/recording';

import type { RecordingSettings } from '../state/recording-settings.js';
import type { InputView } from './input-view.js';

/**
 * The calibration path in use: the open input, or the one chosen, to the output
 * the page plays through at the context's rate; or why there is none yet.
 */
export function calibrationPath(
  view: InputView,
  settings: RecordingSettings,
): CalibrationPath | string {
  const input = view.opened?.device ?? settings.input;
  if (input === undefined) return 'Choose an input first.';
  const rate = view.context === undefined ? undefined : sampleRate(view.context.sampleRate);
  if (rate?.ok !== true) {
    return 'Arm the input or play something first, so the sample rate the path runs at is known.';
  }
  return { input, output: view.output, rate: rate.value };
}

/** The calibration path in use, where the input and the rate are known. */
export function calibrationPathOf(
  view: InputView,
  settings: RecordingSettings,
): CalibrationPath | undefined {
  const path = calibrationPath(view, settings);
  return typeof path === 'string' ? undefined : path;
}

/**
 * The compensation a take recorded now is given, or none where the context has
 * not said its latencies: only an open input records, and an open input has
 * joined a context that has.
 */
export function compensationNow(
  view: InputView,
  settings: RecordingSettings,
): TakeCompensation | undefined {
  const path = calibrationPathOf(view, settings);
  const report = view.context;
  if (path === undefined || report === undefined) return undefined;
  const input = view.opened?.granted.latency;
  return takeCompensation(settings.calibrations, path, {
    output: report.baseLatencySeconds + (report.outputLatencySeconds ?? 0),
    ...(input === undefined ? {} : { input }),
  });
}
