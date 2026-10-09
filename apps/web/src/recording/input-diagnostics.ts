/**
 * The facts the recording diagnostics are read from, gathered from what the
 * page knows of the browser, the input and the output (`REQ-REC-094`,
 * `REQ-REC-097`).
 *
 * Nothing is assumed: until the browser has listed its inputs, a context has
 * reported its rate and latency and the storage estimate has been read, the
 * diagnostics are not yet known, and the views say so rather than show an
 * entry resting on a guess. The entries themselves are the recording
 * package's, which never names a device in them.
 */

import { sampleRate } from '@audiogubbins/domain';
import { OperatingSystem } from '@audiogubbins/capabilities';
import {
  calibrationOf,
  pathChanges,
  recordingDiagnostics,
  storageTimeLeft,
  type CalibrationPath,
  type CalibrationStanding,
  type RecordingDiagnostic,
  type StorageEstimate,
} from '@audiogubbins/recording';

import type { RecordingSettings } from '../state/recording-settings.js';
import { listedAs } from './capture-facts.js';
import type { InputView } from './input-view.js';
import { SYSTEM_OUTPUT } from './system-output.js';

/** The storage estimate, once read: `undefined` where the browser gives none. */
export type StorageReading =
  | { readonly kind: 'unread' }
  | { readonly kind: 'read'; readonly estimate: StorageEstimate | undefined };

/** Whether a platform may suspend capture in the background or under a screen lock. */
export function suspendsCapture(system: OperatingSystem): boolean {
  return (
    system === OperatingSystem.Ios ||
    system === OperatingSystem.IpadOs ||
    system === OperatingSystem.Android
  );
}

/** Whether the latest calibration applies to `path`, or what changed since it was taken. */
export function calibrationStanding(
  settings: RecordingSettings,
  path: CalibrationPath | undefined,
): CalibrationStanding {
  const latest = settings.calibrations[0];
  if (path === undefined || latest === undefined) return { kind: 'missing' };
  if (calibrationOf(settings.calibrations, path) !== undefined) return { kind: 'current' };
  return { kind: 'stale', changes: pathChanges(latest, path) };
}

/** What the diagnostics are read from. */
export interface DiagnosticSources {
  readonly input: InputView;
  readonly settings: RecordingSettings;
  readonly storage: StorageReading;
  readonly suspensionRisk: boolean;
}

/** The input a calibration or a recording would use now: the open one, or the one chosen. */
function currentInput(sources: DiagnosticSources) {
  return sources.input.opened?.device ?? sources.settings.input;
}

/**
 * The recording diagnostics, blocking first, or `undefined` while what they
 * rest on is not yet known.
 */
export function diagnosticsOf(
  sources: DiagnosticSources,
): readonly RecordingDiagnostic[] | undefined {
  const { input, settings, storage } = sources;
  const report = input.context;
  if (input.listing.kind === 'unlisted' || report === undefined || storage.kind === 'unread') {
    return undefined;
  }
  const rate = sampleRate(report.sampleRate);
  if (!rate.ok) return undefined;
  const device = currentInput(sources);
  const path =
    device === undefined ? undefined : { input: device, output: SYSTEM_OUTPUT, rate: rate.value };
  const measured =
    path === undefined ? undefined : calibrationOf(settings.calibrations, path)?.measured;
  // Before an input is open its channels are the ones it reports, or one,
  // the fewest a capture has, so the time left is never understated by more
  // than the channels nobody has reported.
  const channels =
    input.opened?.channels ?? listedAs(input.devices, device)?.channelCounts?.max ?? 1;
  const inputLatency = input.opened?.granted.latency;
  const inputRate = input.opened?.granted.sampleRate;
  const inputLabel = device?.label;
  return recordingDiagnostics({
    secureContext: !(
      input.listing.kind === 'refused' &&
      input.listing.failure.code === 'media-input.insecure-context'
    ),
    permission: input.permission,
    inputs: input.devices.length,
    ...(input.opened === undefined ? {} : { comparison: input.opened.comparison }),
    contextRate: rate.value,
    ...(inputRate === undefined ? {} : { inputRate }),
    latency: {
      output: report.baseLatencySeconds + (report.outputLatencySeconds ?? 0),
      ...(inputLatency === undefined ? {} : { input: inputLatency }),
      ...(measured === undefined ? {} : { measuredRoundTrip: measured.roundTrip / rate.value }),
    },
    ...(inputLabel === undefined ? {} : { inputLabel }),
    calibration: calibrationStanding(settings, path),
    storage: storageTimeLeft(storage.estimate, rate.value, channels),
    suspensionRisk: sources.suspensionRisk,
  });
}
