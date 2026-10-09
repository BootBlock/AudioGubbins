/**
 * The recording diagnostics of the capture itself: the processing the browser
 * applied against the profile's wish, the controls it offers none of, a
 * channel count short of the input's, and an input resampled to the engine's
 * rate (`REQ-REC-092`, `REQ-REC-094`). Each is a warning or information:
 * recording stays available. A resampled input is offered the engine made
 * again at its own rate, as an action the person takes or leaves (`ADR-0070`).
 */

import { sampleRate, type SampleRate } from '@audiogubbins/domain';
import { counted } from '@audiogubbins/text';

import {
  DiagnosticSeverity,
  type RecordingDiagnostic,
  type RecordingFacts,
} from './diagnostic-facts.js';

/** Hertz, in a sentence. */
const HERTZ = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export function captureDiagnostics(facts: RecordingFacts): readonly RecordingDiagnostic[] {
  const entries: RecordingDiagnostic[] = [];
  for (const difference of facts.comparison?.differences ?? []) {
    if (difference.kind === 'processing') {
      entries.push({
        kind: `processing-${difference.control}`,
        severity: DiagnosticSeverity.Warning,
        affects: 'Capture processing',
        why: difference.meaning,
        impact: 'The recording may not be the input as it sounded, which no later edit can undo.',
        improve:
          "Try another browser, or set the processing in the operating system or the device's own software.",
      });
    } else if (difference.kind === 'channel-count' && difference.granted !== undefined) {
      entries.push(channelLimit(difference.requested, difference.granted, difference.meaning));
    }
  }
  for (const uncontrollable of facts.comparison?.uncontrollable ?? []) {
    entries.push({
      kind: `uncontrollable-${uncontrollable.control}`,
      severity: DiagnosticSeverity.Information,
      affects: 'Capture processing',
      why: uncontrollable.meaning,
      impact: 'Whether the browser processes the input cannot be chosen or confirmed here.',
      improve: 'Another browser may offer the control.',
    });
  }
  if (facts.inputRate !== undefined && facts.inputRate !== facts.contextRate) {
    entries.push(rateMismatch(facts.inputRate, facts.contextRate));
  }
  return entries;
}

function channelLimit(requested: number, granted: number, meaning: string): RecordingDiagnostic {
  return {
    kind: 'channel-limit',
    severity: granted < requested ? DiagnosticSeverity.Warning : DiagnosticSeverity.Information,
    affects: 'Channels',
    why: meaning,
    impact: `Each take has ${counted(granted, 'channel', 'channels')}.`,
    improve:
      "Choose the input's full channel count in the operating system or its own software, or try another browser.",
  };
}

function rateMismatch(inputRate: number, contextRate: SampleRate): RecordingDiagnostic {
  // An input may report a rate no audio engine runs at; the engine is then
  // not offered it, and the device's own setting is the remedy left.
  const offered = sampleRate(inputRate);
  return {
    kind: 'rate-mismatch',
    severity: DiagnosticSeverity.Information,
    affects: 'Sample rate',
    why: `The input runs at ${HERTZ.format(inputRate)} Hz and the audio engine at ${HERTZ.format(contextRate)} Hz, so the browser resamples the input.`,
    impact:
      "Resampling adds a little latency and may soften the highest frequencies; the recording keeps the engine's rate.",
    improve: offered.ok
      ? `Restart the audio engine at ${HERTZ.format(inputRate)} Hz, or set the device to ${HERTZ.format(contextRate)} Hz.`
      : `Set the device to ${HERTZ.format(contextRate)} Hz.`,
    ...(offered.ok ? { action: { kind: 'restart-at-input-rate', rate: offered.value } } : {}),
  };
}
