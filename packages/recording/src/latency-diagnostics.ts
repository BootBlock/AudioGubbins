/**
 * The recording diagnostics of the path's latency: a round trip too long for
 * monitoring, punching in and overdubbing, a device named as Bluetooth, an
 * input latency the browser does not report, and a calibration missing or
 * taken on another path (`REQ-REC-094`, `REQ-REC-095`). Latencies are
 * estimates and are worded so; none of these blocks recording.
 *
 * A device's name is read to recognise a Bluetooth device and never written
 * into an entry (`REQ-PRIV-165`).
 */

import {
  DiagnosticSeverity,
  type CalibrationStanding,
  type RecordingDiagnostic,
  type RecordingFacts,
} from './diagnostic-facts.js';
import type { PathChange } from './latency-calibration.js';

/**
 * A round trip from this long is unsuitable for monitoring, punching in and
 * overdubbing. Thirty milliseconds is the time sound takes to cross about ten
 * metres: performers hear monitoring later than about twenty to thirty
 * milliseconds as a slap-back that pulls their timing, and a punch's boundary
 * that late lands audibly off the beat unless a calibration places the take.
 */
export const HIGH_LATENCY_SECONDS = 0.03;

/** Names that mark a device as Bluetooth, or as a hands-free profile, which is Bluetooth's call mode. */
const BLUETOOTH = /\b(?:bluetooth|airpods|hands-?free|a2dp|hfp)\b/iu;

/** Milliseconds, in a sentence. */
const MILLISECONDS = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export function latencyDiagnostics(facts: RecordingFacts): readonly RecordingDiagnostic[] {
  const entries: RecordingDiagnostic[] = [];
  const measured = facts.latency.measuredRoundTrip;
  const estimate = measured ?? facts.latency.output + (facts.latency.input ?? 0);
  const partial = measured === undefined && facts.latency.input === undefined;
  if (estimate >= HIGH_LATENCY_SECONDS) {
    const spoken = `${MILLISECONDS.format(estimate * 1000)} ms`;
    entries.push({
      kind: 'high-latency',
      severity: DiagnosticSeverity.Warning,
      affects: 'Monitoring, punching in and overdubbing',
      why:
        measured !== undefined
          ? `The round trip from output to input is measured at ${spoken}.`
          : partial
            ? `The round trip from output to input is at least ${spoken}, the output's latency alone.`
            : `The round trip from output to input is estimated at ${spoken}.`,
      impact:
        'Monitoring is heard noticeably late, and takes recorded against playback land late unless a calibration places them. Recording itself is unaffected.',
      improve:
        'Use a wired audio interface or headphones, close other audio applications, or calibrate the latency so takes are placed correctly.',
    });
  }
  for (const [side, label] of [
    ['input', facts.inputLabel],
    ['output', facts.outputLabel],
  ] as const) {
    if (label !== undefined && BLUETOOTH.test(label)) entries.push(bluetooth(side));
  }
  if (facts.latency.input === undefined && measured === undefined) {
    entries.push({
      kind: 'input-latency-unreported',
      severity: DiagnosticSeverity.Information,
      affects: 'Latency compensation',
      why: "This browser does not report the input's latency.",
      impact: "Takes are placed by the output's latency alone, so they may land slightly late.",
      improve: 'Calibrate the latency with a loopback to measure the whole round trip.',
    });
  }
  return entries;
}

function bluetooth(side: 'input' | 'output'): RecordingDiagnostic {
  return {
    kind: `bluetooth-${side}`,
    severity: DiagnosticSeverity.Warning,
    affects: 'Monitoring, punching in and overdubbing',
    why:
      side === 'input'
        ? "The input's name suggests a Bluetooth device, which usually adds a tenth of a second or more of latency and, as a microphone, records a narrow, telephone-like band."
        : "The output's name suggests a Bluetooth device, which usually adds a tenth of a second or more of latency.",
    impact:
      'This path is likely unsuitable for monitoring, punching in and overdubbing. Recording stays available.',
    improve: 'Use a wired microphone, interface or headphones for latency-sensitive work.',
  };
}

export function calibrationDiagnostics(
  standing: CalibrationStanding,
): readonly RecordingDiagnostic[] {
  switch (standing.kind) {
    case 'current':
      return [];
    case 'missing':
      return [
        {
          kind: 'calibration-missing',
          severity: DiagnosticSeverity.Information,
          affects: 'Latency compensation',
          why: 'This input, output and rate have not been calibrated.',
          impact: 'Takes are placed by the latencies the browser reports, which may be inexact.',
          improve: 'Run the loopback calibration, or enter a manual offset.',
        },
      ];
    case 'stale':
      return [
        {
          kind: 'calibration-stale',
          severity: DiagnosticSeverity.Warning,
          affects: 'Latency compensation',
          why: `The calibration was taken with another ${changed(standing.changes)}.`,
          impact:
            'Takes are placed by the latencies the browser reports until it is calibrated again.',
          improve: 'Calibrate again for this path.',
        },
      ];
  }
}

const CHANGE_NAMES: Readonly<Record<PathChange, string>> = {
  input: 'input',
  output: 'output',
  rate: 'sample rate',
};

/** "input", "input and output", "input, output and sample rate". */
function changed(changes: readonly PathChange[]): string {
  const names = changes.map((change) => CHANGE_NAMES[change]);
  return names.length < 2
    ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names.slice(-1).join('')}`;
}
