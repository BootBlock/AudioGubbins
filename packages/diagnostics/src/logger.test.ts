import { beforeEach, describe, expect, it } from 'vitest';

import {
  LogSeverity,
  allSeverities,
  severityPasses,
  type LogRecord,
  type PerformanceRecord,
} from './log-record.js';
import { createLogStore, type LogStore } from './log-store.js';
import {
  DEFAULT_VERBOSITY,
  createDiagnosticCentre,
  type Clock,
  type DiagnosticCentre,
} from './logger.js';

/** A clock the test moves by hand, so timestamps are facts rather than guesses. */
function testClock(start = 1_000): Clock & { advance(ms: number): void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('severityPasses', () => {
  it('admits a record at exactly the threshold', () => {
    expect(severityPasses(LogSeverity.Warning, LogSeverity.Warning)).toBe(true);
  });

  it('admits a more serious record than the threshold', () => {
    expect(severityPasses(LogSeverity.Error, LogSeverity.Info)).toBe(true);
  });

  it('rejects a less serious record than the threshold', () => {
    expect(severityPasses(LogSeverity.Debug, LogSeverity.Warning)).toBe(false);
  });

  it('admits everything at Trace', () => {
    for (const severity of allSeverities()) {
      expect(severityPasses(severity, LogSeverity.Trace)).toBe(true);
    }
  });

  it('admits only errors at Error', () => {
    const admitted = allSeverities().filter((s) => severityPasses(s, LogSeverity.Error));
    expect(admitted).toEqual([LogSeverity.Error]);
  });
});

describe('logger', () => {
  let store: LogStore;
  let clock: ReturnType<typeof testClock>;
  let centre: DiagnosticCentre;

  beforeEach(() => {
    store = createLogStore();
    clock = testClock();
    centre = createDiagnosticCentre(store, clock, {
      defaultSeverity: LogSeverity.Info,
      categoryOverrides: {},
    });
  });

  it('records the category, message, fields and timestamp', () => {
    clock.advance(500);
    centre.loggerFor('storage').info('Project saved.', { bytes: 4_096 });

    const [written] = store.snapshot();
    expect(written).toMatchObject({
      timestamp: 1_500,
      severity: LogSeverity.Info,
      category: 'storage',
      message: 'Project saved.',
      fields: { bytes: 4_096 },
    });
  });

  it('drops a record below the configured verbosity', () => {
    centre.loggerFor('storage').debug('Considered a cache entry.');
    expect(store.snapshot()).toEqual([]);
  });

  it('keeps a record at or above the configured verbosity', () => {
    const logger = centre.loggerFor('storage');
    logger.error('The write failed.');
    logger.warning('The quota is nearly full.');
    logger.info('Project saved.');
    expect(store.snapshot()).toHaveLength(3);
  });

  it('applies a per-category override without raising everything', () => {
    centre.setVerbosity({
      defaultSeverity: LogSeverity.Error,
      categoryOverrides: { storage: LogSeverity.Trace },
    });

    centre.loggerFor('storage').trace('Considered a cache entry.');
    centre.loggerFor('renderer').info('Drew a frame.');

    expect(store.snapshot().map((r) => r.category)).toEqual(['storage']);
  });

  it('tags every record of an operation with its correlation identifier', () => {
    const logger = centre.loggerFor('export').forOperation('export-7');
    logger.info('Started.');
    logger.info('Finished.');

    expect(store.snapshot().map((r) => r.correlationId)).toEqual(['export-7', 'export-7']);
  });

  it('leaves the original logger uncorrelated', () => {
    const logger = centre.loggerFor('export');
    logger.forOperation('export-7').info('In the operation.');
    logger.info('Outside it.');

    const outside = store.snapshot()[1];
    expect(outside?.correlationId).toBeUndefined();
  });

  it('attaches a stack to an error when one is given', () => {
    centre
      .loggerFor('codec')
      .error('Decoding failed.', {}, { frames: ['at decode', 'at onImport'] });
    expect(store.snapshot()[0]?.stack?.frames).toEqual(['at decode', 'at onImport']);
  });

  it('defaults fields to an empty set rather than leaving them undefined', () => {
    centre.loggerFor('storage').info('Project saved.');
    expect(store.snapshot()[0]?.fields).toEqual({});
  });

  it('refuses a category built from a value, which would carry it everywhere the name goes', () => {
    // A category is listed in the settings and kept in the stored verbosity,
    // which no log rotation and no redaction reaches.
    expect(() => centre.loggerFor('import /home/someone/take.wav')).toThrow(/not a log category/);
    expect(() => centre.loggerFor('Storage')).toThrow(/not a log category/);
    expect(() => centre.loggerFor('audio-engine')).not.toThrow();
  });

  it('records a category whose name an object inherits, such as constructor', () => {
    // An override was looked up without asking whether it was the store's own,
    // so `constructor` found the prototype's and every record was dropped.
    centre.loggerFor('constructor').warning('Something happened.');

    expect(store.snapshot()).toHaveLength(1);
  });
});

describe('performance measurement', () => {
  it('records a measurement when the category admits detail', () => {
    const store = createLogStore();
    const centre = createDiagnosticCentre(store, testClock(), {
      defaultSeverity: LogSeverity.Debug,
      categoryOverrides: {},
    });

    centre.loggerFor('renderer').measured('peaks-built', 240, { frames: 48_000 });

    expect(store.performanceSnapshot()).toEqual([
      {
        timestamp: 1_000,
        category: 'renderer',
        operation: 'peaks-built',
        durationMs: 240,
        fields: { frames: 48_000 },
      },
    ]);
  });

  it('collects nothing at a verbosity the user turned down', () => {
    const store = createLogStore();
    const centre = createDiagnosticCentre(store, testClock(), DEFAULT_VERBOSITY);

    centre.loggerFor('renderer').measured('peaks-built', 240);

    expect(store.performanceSnapshot()).toEqual([]);
  });
});

describe("another thread's records, relayed", () => {
  /** A record another thread's logger made, at `severity` in `category`. */
  const made = (severity: LogSeverity, category = 'storage'): LogRecord => ({
    timestamp: 5,
    severity,
    category,
    message: 'A worker said this.',
    fields: { project: 'p-1' },
  });

  /** A centre admitting Info, and Debug for `storage`, with its store. */
  const relaying = (): { store: LogStore; centre: DiagnosticCentre } => {
    const store = createLogStore();
    const centre = createDiagnosticCentre(store, testClock(), {
      defaultSeverity: LogSeverity.Info,
      categoryOverrides: { storage: LogSeverity.Debug },
    });
    return { store, centre };
  };

  it('keeps a record as it was made, at or above the verbosity of its category', () => {
    const { store, centre } = relaying();

    centre.relay.write(made(LogSeverity.Debug));
    centre.relay.write(made(LogSeverity.Info, 'projects'));

    expect(store.snapshot()).toEqual([made(LogSeverity.Debug), made(LogSeverity.Info, 'projects')]);
  });

  it('drops a record below the verbosity of its category', () => {
    const { store, centre } = relaying();

    centre.relay.write(made(LogSeverity.Trace));
    centre.relay.write(made(LogSeverity.Debug, 'projects'));

    expect(store.snapshot()).toEqual([]);
  });

  it('admits more while diagnostic mode is on, as for its own loggers', () => {
    const { store, centre } = relaying();

    centre.startDiagnosticMode();
    centre.relay.write(made(LogSeverity.Trace));

    expect(store.snapshot()).toEqual([made(LogSeverity.Trace)]);
  });

  it('keeps a measurement only where its category admits detail', () => {
    const { store, centre } = relaying();
    const measured = (category: string): PerformanceRecord => ({
      timestamp: 5,
      category,
      operation: 'usage-measured',
      durationMs: 12,
      fields: {},
    });

    centre.relay.writePerformance(measured('storage'));
    centre.relay.writePerformance(measured('projects'));

    expect(store.performanceSnapshot()).toEqual([measured('storage')]);
  });
});

describe('diagnostic mode', () => {
  let store: LogStore;
  let centre: DiagnosticCentre;

  beforeEach(() => {
    store = createLogStore();
    centre = createDiagnosticCentre(store, testClock(), DEFAULT_VERBOSITY);
  });

  it('is off to begin with', () => {
    expect(centre.isDiagnosticModeActive()).toBe(false);
  });

  it('reports itself active, so the shell can show the badge', () => {
    centre.startDiagnosticMode();
    expect(centre.isDiagnosticModeActive()).toBe(true);
  });

  it('collects trace detail that the ordinary verbosity would drop', () => {
    centre.loggerFor('storage').trace('Before.');
    centre.startDiagnosticMode();
    centre.loggerFor('storage').trace('During.');

    expect(store.snapshot().map((r) => r.message)).toEqual(['During.']);
  });

  it('restores the previous verbosity when it stops', () => {
    const chosen = { defaultSeverity: LogSeverity.Info, categoryOverrides: {} };
    centre.setVerbosity(chosen);
    centre.startDiagnosticMode();
    centre.stopDiagnosticMode();

    expect(centre.verbosity()).toEqual(chosen);
    expect(centre.isDiagnosticModeActive()).toBe(false);
  });

  it('does not forget the verbosity to restore when started twice', () => {
    const chosen = { defaultSeverity: LogSeverity.Info, categoryOverrides: {} };
    centre.setVerbosity(chosen);
    centre.startDiagnosticMode();
    centre.startDiagnosticMode();
    centre.stopDiagnosticMode();

    expect(centre.verbosity()).toEqual(chosen);
  });

  it('ignores a stop when it was never started', () => {
    centre.stopDiagnosticMode();
    expect(centre.verbosity()).toEqual(DEFAULT_VERBOSITY);
    expect(centre.isDiagnosticModeActive()).toBe(false);
  });

  it('treats a verbosity change during diagnostic mode as the level to return to', () => {
    centre.startDiagnosticMode();
    const chosen = { defaultSeverity: LogSeverity.Info, categoryOverrides: {} };
    centre.setVerbosity(chosen);

    // Still collecting trace detail, and still reporting itself active.
    expect(centre.isDiagnosticModeActive()).toBe(true);
    centre.loggerFor('storage').trace('During.');
    expect(store.snapshot()).toHaveLength(1);

    centre.stopDiagnosticMode();
    expect(centre.verbosity()).toEqual(chosen);
  });
});

describe('diagnostic mode ends on its own', () => {
  /**
   * REQ-PRIV-165 permits richer collection "for a limited period", so the mode
   * ends on its own: left running, it would have a user who turned it on to
   * report one problem collect Trace records for as long as the tab stayed
   * open.
   */

  it('ends after its period and restores the verbosity it replaced', () => {
    let now = 0;
    const store = createLogStore();
    const centre = createDiagnosticCentre(store, { now: () => now });

    centre.startDiagnosticMode(1_000);
    expect(centre.isDiagnosticModeActive()).toBe(true);
    expect(centre.diagnosticModeEndsAt()).toBe(1_000);

    now = 1_000;

    expect(centre.isDiagnosticModeActive()).toBe(false);
    expect(centre.diagnosticModeEndsAt()).toBeUndefined();
    expect(centre.verbosity()).toEqual(DEFAULT_VERBOSITY);
  });

  it('collects nothing extra once its time is up, even if nobody asked', () => {
    let now = 0;
    const store = createLogStore();
    const centre = createDiagnosticCentre(store, { now: () => now });
    const logger = centre.loggerFor('shell');

    centre.startDiagnosticMode(1_000);
    now = 5_000;
    logger.trace('Detail nobody agreed to collect any more.');

    expect(store.snapshot()).toEqual([]);
  });

  it('lasts thirty minutes when no period is given', () => {
    const centre = createDiagnosticCentre(createLogStore(), { now: () => 0 });
    centre.startDiagnosticMode();

    expect(centre.diagnosticModeEndsAt()).toBe(30 * 60 * 1000);
  });
});
