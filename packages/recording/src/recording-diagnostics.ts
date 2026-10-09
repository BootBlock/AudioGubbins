/**
 * The recording diagnostics: what the browser and the hardware can do for a
 * recording, and what each shortfall means (`REQ-REC-094`, `REQ-REC-097`).
 *
 * Each entry says what is affected, why, the practical impact and what would
 * improve it. Most are estimates, read from what the browser chooses to report,
 * and are worded so. An entry blocks recording only for a genuine failure,
 * where nothing could be recorded at all: no secure context, the permission
 * refused, or no input. Everything else informs and warns, and the person
 * decides whether to go on.
 *
 * A device's name is personal data (`REQ-PRIV-165`): it is read only to
 * recognise a Bluetooth device (`latency-diagnostics.ts`) and never written
 * into an entry, so an entry may be shown, logged or put in a diagnostic bundle
 * as it is.
 */

import { counted } from '@audiogubbins/text';

import { captureDiagnostics } from './capture-diagnostics.js';
import {
  DiagnosticSeverity,
  type RecordingDiagnostic,
  type RecordingFacts,
} from './diagnostic-facts.js';
import { calibrationDiagnostics, latencyDiagnostics } from './latency-diagnostics.js';
import type { StorageTimeLeft } from './storage-time.js';

const SEVERITY_ORDER: readonly DiagnosticSeverity[] = [
  DiagnosticSeverity.Blocking,
  DiagnosticSeverity.Warning,
  DiagnosticSeverity.Information,
];

/** Every entry `facts` give, the blocking first, then the warnings, then the rest. */
export function recordingDiagnostics(facts: RecordingFacts): readonly RecordingDiagnostic[] {
  const entries = [
    ...access(facts),
    ...captureDiagnostics(facts),
    ...latencyDiagnostics(facts),
    ...calibrationDiagnostics(facts.calibration),
    ...storage(facts.storage),
    ...(facts.suspensionRisk ? [SUSPENSION] : []),
  ];
  return SEVERITY_ORDER.flatMap((severity) =>
    entries.filter((entry) => entry.severity === severity),
  );
}

/** Whether `diagnostics` hold an entry that stops recording. */
export function recordingBlocked(diagnostics: readonly RecordingDiagnostic[]): boolean {
  return diagnostics.some((entry) => entry.severity === DiagnosticSeverity.Blocking);
}

function access(facts: RecordingFacts): readonly RecordingDiagnostic[] {
  if (!facts.secureContext) {
    return [
      {
        kind: 'insecure-context',
        severity: DiagnosticSeverity.Blocking,
        affects: 'Recording',
        why: 'The page is not served from a secure origin, and browsers offer a microphone only to one.',
        impact: 'Nothing can be recorded.',
        improve: 'Open the application over HTTPS, or from localhost.',
      },
    ];
  }
  if (facts.permission === 'denied') {
    return [
      {
        kind: 'permission-denied',
        severity: DiagnosticSeverity.Blocking,
        affects: 'Recording',
        why: 'The microphone permission was refused for this site.',
        impact: 'Nothing can be recorded until it is given.',
        improve: "Allow the microphone in the browser's site settings, then try again.",
      },
    ];
  }
  if (facts.permission === 'granted' && facts.inputs === 0) {
    return [
      {
        kind: 'no-input',
        severity: DiagnosticSeverity.Blocking,
        affects: 'Recording',
        why: 'The browser lists no audio input.',
        impact: 'Nothing can be recorded.',
        improve:
          'Connect a microphone or an audio interface, or enable one in the system settings.',
      },
    ];
  }
  return [];
}

function storage(left: StorageTimeLeft): readonly RecordingDiagnostic[] {
  switch (left.kind) {
    case 'enough':
      return [];
    case 'unknown':
      return [
        {
          kind: 'storage-unknown',
          severity: DiagnosticSeverity.Information,
          affects: 'Recording length',
          why: 'This browser does not estimate the storage left.',
          impact:
            'A long recording may be stopped by a full disk without an earlier warning; what was recorded is kept.',
          improve: 'Keep free space on the disk, or use a browser that reports its storage.',
        },
      ];
    case 'low':
      return [
        {
          kind: 'storage-low',
          severity: DiagnosticSeverity.Warning,
          affects: 'Recording length',
          why: `About ${minutesOrSeconds(left.seconds)} of recording fit in the storage left, counting the space finishing a recording needs.`,
          impact: 'A longer recording stops when storage runs out; what was recorded is kept.',
          improve: 'Free space by removing unused projects or media, or free disk space.',
        },
      ];
    case 'exhausted':
      return [
        {
          kind: 'storage-exhausted',
          severity: DiagnosticSeverity.Warning,
          affects: 'Recording length',
          why: 'The storage estimate leaves no room to finish a recording.',
          impact: 'A recording would likely stop almost at once; what was recorded would be kept.',
          improve: 'Free space by removing unused projects or media, or free disk space.',
        },
      ];
  }
}

function minutesOrSeconds(seconds: number): string {
  return seconds >= 60
    ? counted(Math.floor(seconds / 60), 'minute', 'minutes')
    : counted(seconds, 'second', 'seconds');
}

const SUSPENSION: RecordingDiagnostic = {
  kind: 'background-suspension',
  severity: DiagnosticSeverity.Information,
  affects: 'Recording in the background',
  why: 'This browser may pause capture while the page is in the background or the screen is locked.',
  impact:
    'A recording stops when that happens, keeping what it has, and a scheduled one is cancelled.',
  improve: 'Keep the page open and in view while recording.',
};
