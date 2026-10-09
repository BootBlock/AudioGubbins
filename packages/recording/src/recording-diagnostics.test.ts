import { describe, expect, it } from 'vitest';

import { sampleRate, type DomainResult } from '@audiogubbins/domain';

import { compareCapture } from './capture-comparison.js';
import { RAW_STUDIO_PROFILE, capturePlan } from './capture-profile.js';
import { DiagnosticSeverity, type RecordingFacts } from './diagnostic-facts.js';
import { HIGH_LATENCY_SECONDS } from './latency-diagnostics.js';
import { recordingBlocked, recordingDiagnostics } from './recording-diagnostics.js';

function valueOf<T>(result: DomainResult<T>): T {
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

const RATE = valueOf(sampleRate(48_000));

/** A healthy setup: nothing to say about it. */
const HEALTHY: RecordingFacts = {
  secureContext: true,
  permission: 'granted',
  inputs: 1,
  contextRate: RATE,
  inputRate: 48_000,
  latency: { output: 0.005, input: 0.004 },
  inputLabel: 'Studio Interface In',
  outputLabel: 'Studio Interface Out',
  calibration: { kind: 'current' },
  storage: { kind: 'enough', seconds: 10_000 },
  suspensionRisk: false,
};

const kindsOf = (facts: RecordingFacts): readonly string[] =>
  recordingDiagnostics(facts).map((entry) => entry.kind);

describe('the recording diagnostics (REQ-REC-094, REQ-REC-097)', () => {
  it('say nothing of a healthy setup', () => {
    expect(recordingDiagnostics(HEALTHY)).toEqual([]);
  });

  it('block recording only where nothing could be recorded', () => {
    const blocking = [
      { ...HEALTHY, secureContext: false },
      { ...HEALTHY, permission: 'denied' as const },
      { ...HEALTHY, inputs: 0 },
    ];
    expect(blocking.map(kindsOf)).toEqual([
      ['insecure-context'],
      ['permission-denied'],
      ['no-input'],
    ]);
    for (const facts of blocking) expect(recordingBlocked(recordingDiagnostics(facts))).toBe(true);

    // Every degradation short of those leaves recording available.
    const degraded: RecordingFacts = {
      ...HEALTHY,
      inputRate: 44_100,
      latency: { output: 0.2 },
      inputLabel: 'AirPods Pro Hands-Free',
      calibration: { kind: 'stale', changes: ['input'] },
      storage: { kind: 'exhausted' },
      suspensionRisk: true,
    };
    expect(recordingBlocked(recordingDiagnostics(degraded))).toBe(false);
  });

  it('do not count inputs before the permission lets the browser list them', () => {
    expect(kindsOf({ ...HEALTHY, permission: 'prompt', inputs: 0 })).toEqual([]);
  });

  it('warn of a high round trip as an estimate, and of a measured one as measured', () => {
    const late = recordingDiagnostics({ ...HEALTHY, latency: { output: 0.02, input: 0.015 } });
    expect(late.map((entry) => [entry.kind, entry.severity])).toEqual([
      ['high-latency', DiagnosticSeverity.Warning],
    ]);
    expect(late[0]?.why).toBe('The round trip from output to input is estimated at 35 ms.');

    const measured = recordingDiagnostics({
      ...HEALTHY,
      latency: { output: 0.005, input: 0.004, measuredRoundTrip: 0.042 },
    });
    expect(measured[0]?.why).toBe('The round trip from output to input is measured at 42 ms.');

    expect(
      kindsOf({ ...HEALTHY, latency: { output: HIGH_LATENCY_SECONDS - 0.005, input: 0.004 } }),
    ).toEqual([]);
  });

  it("say an output's latency alone is a floor, and that the input's is unreported", () => {
    const entries = recordingDiagnostics({ ...HEALTHY, latency: { output: 0.05 } });
    expect(entries.map((entry) => entry.kind)).toEqual([
      'high-latency',
      'input-latency-unreported',
    ]);
    expect(entries[0]?.why).toBe(
      "The round trip from output to input is at least 50 ms, the output's latency alone.",
    );
  });

  it('warn of a device named as Bluetooth, without repeating its name', () => {
    const entries = recordingDiagnostics({
      ...HEALTHY,
      inputLabel: "Headset (Sam's AirPods Hands-Free)",
      outputLabel: 'Speakers (Bluetooth Audio)',
    });
    expect(entries.map((entry) => entry.kind)).toEqual(['bluetooth-input', 'bluetooth-output']);
    for (const entry of entries) {
      expect(JSON.stringify(entry)).not.toMatch(/Sam|AirPods Hands|Bluetooth Audio/u);
      expect(entry.impact).toMatch(/Recording stays available/u);
    }
  });

  it('turn each processing difference and each control that could not be set into an entry', () => {
    const plan = capturePlan(RAW_STUDIO_PROFILE, {
      supported: new Set(['echoCancellation', 'noiseSuppression', 'channelCount']),
      channelCount: 2,
      contextRate: RATE,
    });
    const comparison = compareCapture(plan, {
      processing: { echoCancellation: true, noiseSuppression: false },
      channelCount: 1,
    });
    const entries = recordingDiagnostics({ ...HEALTHY, comparison });
    expect(entries.map((entry) => [entry.kind, entry.severity])).toEqual([
      ['processing-echoCancellation', 'warning'],
      ['channel-limit', 'warning'],
      ['uncontrollable-autoGainControl', 'information'],
      ['uncontrollable-voiceIsolation', 'information'],
    ]);
    expect(entries[1]?.impact).toBe('Each take has 1 channel.');
  });

  it("explain a rate mismatch and offer the input's rate", () => {
    const [entry] = recordingDiagnostics({ ...HEALTHY, inputRate: 44_100 });
    expect(entry).toMatchObject({
      kind: 'rate-mismatch',
      severity: 'information',
      improve: 'Restart the audio engine at 44,100 Hz, or set the device to 48,000 Hz.',
    });
  });

  it('ask for a calibration where none applies, naming what changed', () => {
    expect(kindsOf({ ...HEALTHY, calibration: { kind: 'missing' } })).toEqual([
      'calibration-missing',
    ]);
    const [stale] = recordingDiagnostics({
      ...HEALTHY,
      calibration: { kind: 'stale', changes: ['input', 'output', 'rate'] },
    });
    expect(stale?.why).toBe(
      'The calibration was taken with another input, output and sample rate.',
    );
    const [one] = recordingDiagnostics({
      ...HEALTHY,
      calibration: { kind: 'stale', changes: ['rate'] },
    });
    expect(one?.why).toBe('The calibration was taken with another sample rate.');
  });

  it('say how much recording the storage left holds, and when it is unknown', () => {
    const [low] = recordingDiagnostics({ ...HEALTHY, storage: { kind: 'low', seconds: 150 } });
    expect(low?.why).toMatch(/^About 2 minutes of recording fit/u);
    const [seconds] = recordingDiagnostics({ ...HEALTHY, storage: { kind: 'low', seconds: 1 } });
    expect(seconds?.why).toMatch(/^About 1 second of recording fit/u);
    expect(kindsOf({ ...HEALTHY, storage: { kind: 'unknown' } })).toEqual(['storage-unknown']);
  });

  it('put the blocking first, then the warnings, then the rest', () => {
    const severities = recordingDiagnostics({
      ...HEALTHY,
      permission: 'denied',
      inputRate: 44_100,
      latency: { output: 0.2 },
      suspensionRisk: true,
    }).map((entry) => entry.severity);
    expect(severities).toEqual([...severities].sort((a, b) => rank(a) - rank(b)));
    expect(severities[0]).toBe('blocking');
  });
});

function rank(severity: string): number {
  return ['blocking', 'warning', 'information'].indexOf(severity);
}
