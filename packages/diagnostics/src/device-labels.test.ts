import { describe, expect, it } from 'vitest';

import { createLogStore } from './log-store.js';
import { createDiagnosticCentre } from './logger.js';
import { LogSeverity } from './log-record.js';

/** A logger whose records are all kept, and the store they are kept in. */
function logged() {
  const store = createLogStore();
  const centre = createDiagnosticCentre(
    store,
    { now: () => 0 },
    {
      defaultSeverity: LogSeverity.Trace,
      categoryOverrides: {},
    },
  );
  return { store, logger: centre.loggerFor('recording') };
}

describe("a device's name in the log (REQ-PRIV-165, ADR-0070)", () => {
  it('is replaced as the record is made, so the kept log never holds it', () => {
    const { store, logger } = logged();
    logger.warning('The input closed.', {
      inputLabel: "Jane's AirPods",
      outputDeviceName: 'Studio monitors of Jane',
      channels: 2,
      reason: 'The device was unplugged.',
    });
    const [record] = store.snapshot();
    expect(record?.fields).toEqual({
      inputLabel: '<device>',
      outputDeviceName: '<device>',
      channels: 2,
      reason: 'The device was unplugged.',
    });
    expect(JSON.stringify(store.snapshot())).not.toContain('Jane');
  });

  it('is replaced in a measurement too', () => {
    const { store, logger } = logged();
    logger.measured('capture-open', 12, { microphoneLabel: 'Blue Yeti in the study' });
    expect(store.performanceSnapshot()[0]?.fields).toEqual({ microphoneLabel: '<device>' });
  });

  it('is found by the field that holds it, not by a field that merely ends in a name', () => {
    const { store, logger } = logged();
    const kept = {
      label: 'Record',
      fileName: 'take.wav',
      commandLabel: 'Arm the input',
      deviceId: 'a1b2',
      inputLatency: 0.004,
    };
    logger.info('Named.', {
      deviceLabel: 'a',
      input_label: 'b',
      'output-name': 'c',
      speakersName: 'd',
      ...kept,
    });
    expect(store.snapshot()[0]?.fields).toEqual({
      deviceLabel: '<device>',
      input_label: '<device>',
      'output-name': '<device>',
      speakersName: '<device>',
      ...kept,
    });
  });
});
