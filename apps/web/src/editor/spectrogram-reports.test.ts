import { describe, expect, it } from 'vitest';

import { DspImplementation } from '@audiogubbins/audio-engine';
import { LogSeverity, createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { observable } from '../state/observable.js';
import { spectrogramReports, type SpectrogramDsp } from './spectrogram-reports.js';

/** The host's report over a log in memory that records everything, and the DSP it holds. */
function reportsOver() {
  const logs = createLogStore();
  const logger = createDiagnosticCentre(
    logs,
    { now: () => 0 },
    { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
  ).loggerFor('editor');
  const dsp = observable<SpectrogramDsp | undefined>(undefined);
  return { report: spectrogramReports(logger, dsp), logs, dsp };
}

describe('what the spectrogram host reports', () => {
  it('holds the DSP each worker says it runs, a later worker’s in place of the last, and logs it', () => {
    const { report, logs, dsp } = reportsOver();
    report({
      kind: 'dsp',
      implementation: DspImplementation.Reference,
      fallbackReason: 'The module could not be compiled.',
    });
    expect(dsp.get()).toEqual({
      implementation: DspImplementation.Reference,
      fallbackReason: 'The module could not be compiled.',
    });
    report({
      kind: 'dsp',
      implementation: DspImplementation.WebAssembly,
      fallbackReason: undefined,
    });

    expect(dsp.get()).toEqual({
      implementation: DspImplementation.WebAssembly,
      fallbackReason: undefined,
    });
    expect(
      logs.snapshot().map(({ severity, message, fields }) => ({ severity, message, fields })),
    ).toEqual([
      {
        severity: LogSeverity.Info,
        message: 'The spectrogram worker runs its DSP.',
        fields: { kind: DspImplementation.Reference, reason: 'The module could not be compiled.' },
      },
      {
        severity: LogSeverity.Info,
        message: 'The spectrogram worker runs its DSP.',
        fields: { kind: DspImplementation.WebAssembly },
      },
    ]);
  });

  it('logs a failed spectrogram as an error and a cache it could not use as a warning, holding no DSP', () => {
    const { report, logs, dsp } = reportsOver();
    report({ kind: 'failed', identity: 'test:tone', reason: 'The worker stopped.' });
    report({ kind: 'cache-unwritten', identity: 'test:tone', reason: 'The storage is full.' });

    expect(dsp.get()).toBeUndefined();
    expect(logs.snapshot().map(({ severity, fields }) => ({ severity, fields }))).toEqual([
      { severity: LogSeverity.Error, fields: { reason: 'The worker stopped.' } },
      { severity: LogSeverity.Warning, fields: { reason: 'The storage is full.' } },
    ]);
  });
});
