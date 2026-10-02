/**
 * The logger the rest of AudioGubbins calls.
 *
 * REQ-PRIV-165 requires subsystem filtering, correlation identifiers, typed
 * fields, user-configurable verbosity, a temporary diagnostic mode, and a clear
 * indication while that mode is active. All of those are properties of one
 * object, so they live together here rather than being re-decided per caller.
 *
 * The logger takes its clock rather than reading one. This package is compiled
 * without the DOM type definitions and must stay testable without a browser
 * (REQ-ARCH-151), and a test that asserts on timestamps needs them to be its
 * own.
 */

import {
  LogSeverity,
  isLogCategory,
  severityPasses,
  type CorrelationId,
  type LogFields,
  type LogRecord,
  type PerformanceRecord,
  type SanitisedStackTrace,
} from './log-record.js';
import type { LogSink } from './log-store.js';

/** Supplies the current time. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

/**
 * How verbose logging is, overall and per subsystem.
 *
 * A per-category override is what makes a real investigation possible: raising
 * everything to Trace to find one storage problem buries it in renderer
 * records.
 */
export interface VerbosityConfiguration {
  /** The level admitted for a category with no override. */
  readonly defaultSeverity: LogSeverity;

  /** Per-category overrides, keyed by category name. */
  readonly categoryOverrides: Readonly<Record<string, LogSeverity>>;
}

/** Ordinary running verbosity: warnings and errors, nothing routine. */
export const DEFAULT_VERBOSITY: VerbosityConfiguration = {
  defaultSeverity: LogSeverity.Warning,
  categoryOverrides: {},
};

/**
 * Verbosity while diagnostic mode is on.
 *
 * REQ-PRIV-165 permits richer execution metadata for a limited period. Raising
 * the threshold is the whole of that change: diagnostic mode collects more of
 * what was already permitted and never begins collecting a prohibited category.
 */
const DIAGNOSTIC_MODE_VERBOSITY: VerbosityConfiguration = {
  defaultSeverity: LogSeverity.Trace,
  categoryOverrides: {},
};

/**
 * How long diagnostic mode stays on unless the user stops it first.
 *
 * REQ-PRIV-165 permits richer collection "for a limited period", and the
 * settings tell the user as much: were nothing to end it, a user who turned it
 * on to report one problem would collect Trace records for as long as the tab
 * stayed open. Thirty minutes covers reproducing a problem several times over.
 */
export const DIAGNOSTIC_MODE_DURATION_MS = 30 * 60 * 1000;

/** Logs records for one subsystem. */
export interface Logger {
  /** The subsystem this logger writes as. */
  readonly category: string;

  error(message: string, fields?: LogFields, stack?: SanitisedStackTrace): void;
  warning(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  trace(message: string, fields?: LogFields): void;

  /**
   * Records how long something took.
   *
   * REQ-PRIV-162 prohibits usage analytics, so this measures work, not people:
   * it records that building peaks took 240 ms, never that a person opened a
   * panel or how often they reach for a feature.
   */
  measured(operation: string, durationMs: number, fields?: LogFields): void;

  /** A logger for the same subsystem that tags every record with an operation. */
  forOperation(correlationId: CorrelationId): Logger;
}

/** Creates loggers and owns the verbosity and diagnostic-mode state. */
export interface DiagnosticCentre {
  /** A logger for a subsystem, for example `storage` or `renderer`. */
  loggerFor(category: string): Logger;

  /** The verbosity currently in force. */
  verbosity(): VerbosityConfiguration;

  /** Replaces the verbosity. Takes effect for the next record. */
  setVerbosity(verbosity: VerbosityConfiguration): void;

  /**
   * Whether diagnostic mode is on.
   *
   * REQ-PRIV-165 requires a clear indication while it is active, so the shell
   * asks this to show a persistent badge. Without the badge a user could leave
   * Trace collection running for days without realising.
   */
  isDiagnosticModeActive(): boolean;

  /**
   * When diagnostic mode will end on its own, or `undefined` when it is off.
   *
   * Milliseconds since the Unix epoch, on the clock the centre was given, so
   * the shell can say when it ends and redraw the indication when it does.
   */
  diagnosticModeEndsAt(): number | undefined;

  /**
   * Turns diagnostic mode on for a limited period, remembering the verbosity to
   * restore.
   *
   * Turning it on twice is not an error and does not lose the original
   * verbosity: the second call is a no-op rather than one that remembers Trace
   * as the level to go back to.
   */
  startDiagnosticMode(durationMs?: number): void;

  /** Turns diagnostic mode off and restores the previous verbosity. */
  stopDiagnosticMode(): void;

  /**
   * Where the records another thread's loggers made are written, such as the
   * storage worker's. Each is kept or dropped as this centre's own loggers'
   * records are, by the verbosity in force for its category, so one setting
   * governs the records of every thread, and the shared bundle redacts them
   * all alike.
   */
  readonly relay: LogSink;
}

/**
 * The severity a measurement is admitted at. A measurement is detail, so it is
 * admitted on the same terms as a Debug record. Collecting measurements
 * regardless of verbosity would make "user-configurable verbosity" untrue for
 * the one category whose volume scales with how hard the application is
 * working.
 */
const MEASUREMENT_SEVERITY = LogSeverity.Debug;

/** What a logger writes through: where records go, the time, and the level in force. */
interface LogWriter {
  readonly sink: LogSink;
  readonly clock: Clock;
  readonly thresholdFor: (category: string) => LogSeverity;
}

/**
 * A logger for one category, and for one operation when a correlation
 * identifier is given.
 *
 * Apart from the centre because building a logger is a concept of its own: it
 * needs where records go, the time and the level in force, and nothing of
 * diagnostic mode, which the centre keeps behind `thresholdFor`.
 */
function createLogger(category: string, writer: LogWriter, correlationId?: CorrelationId): Logger {
  const emit = (
    severity: LogSeverity,
    message: string,
    fields: LogFields,
    stack?: SanitisedStackTrace,
  ): void => {
    if (!severityPasses(severity, writer.thresholdFor(category))) return;

    const record: LogRecord = {
      timestamp: writer.clock.now(),
      severity,
      category,
      message,
      fields,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(stack === undefined ? {} : { stack }),
    };
    writer.sink.write(record);
  };

  return {
    category,

    error: (message, fields = {}, stack) => {
      emit(LogSeverity.Error, message, fields, stack);
    },
    warning: (message, fields = {}) => {
      emit(LogSeverity.Warning, message, fields);
    },
    info: (message, fields = {}) => {
      emit(LogSeverity.Info, message, fields);
    },
    debug: (message, fields = {}) => {
      emit(LogSeverity.Debug, message, fields);
    },
    trace: (message, fields = {}) => {
      emit(LogSeverity.Trace, message, fields);
    },

    measured: (operation, durationMs, fields = {}) => {
      if (!severityPasses(MEASUREMENT_SEVERITY, writer.thresholdFor(category))) return;

      const record: PerformanceRecord = {
        timestamp: writer.clock.now(),
        category,
        operation,
        durationMs,
        fields,
        ...(correlationId === undefined ? {} : { correlationId }),
      };
      writer.sink.writePerformance(record);
    },

    forOperation: (nextCorrelationId) => createLogger(category, writer, nextCorrelationId),
  };
}

/**
 * Where another thread's records are written into `sink`: each admitted as a
 * logger here admits its own, by the level in force for its category.
 */
function relayInto(sink: LogSink, thresholdFor: (category: string) => LogSeverity): LogSink {
  return {
    write: (record) => {
      if (severityPasses(record.severity, thresholdFor(record.category))) sink.write(record);
    },
    writePerformance: (record) => {
      if (severityPasses(MEASUREMENT_SEVERITY, thresholdFor(record.category))) {
        sink.writePerformance(record);
      }
    },
  };
}

/** Creates the diagnostic centre. */
export function createDiagnosticCentre(
  sink: LogSink,
  clock: Clock,
  initialVerbosity: VerbosityConfiguration = DEFAULT_VERBOSITY,
): DiagnosticCentre {
  let verbosity = initialVerbosity;
  let verbosityBeforeDiagnosticMode: VerbosityConfiguration | undefined;
  let diagnosticModeEndsAt: number | undefined;

  /**
   * Ends diagnostic mode if its time is up.
   *
   * Checked lazily, on every question asked of the centre, rather than by a
   * timer: this package has no timers to give, and a mode that ends when it is
   * next consulted collects nothing after its time, because collecting is
   * itself a consultation.
   */
  const expireIfDue = (): void => {
    if (diagnosticModeEndsAt === undefined || clock.now() < diagnosticModeEndsAt) return;
    if (verbosityBeforeDiagnosticMode !== undefined) verbosity = verbosityBeforeDiagnosticMode;
    verbosityBeforeDiagnosticMode = undefined;
    diagnosticModeEndsAt = undefined;
  };

  const thresholdFor = (category: string): LogSeverity => {
    expireIfDue();
    // Its own property only: were inherited ones read, a category called
    // `constructor` would find the object's prototype and record nothing at
    // all.
    return Object.hasOwn(verbosity.categoryOverrides, category)
      ? (verbosity.categoryOverrides[category] ?? verbosity.defaultSeverity)
      : verbosity.defaultSeverity;
  };

  return {
    loggerFor: (category) => {
      // A wiring mistake rather than anything a user did, so it is thrown where
      // the logger is asked for: every category is a constant in the code.
      if (!isLogCategory(category)) {
        throw new Error(
          `"${category}" is not a log category: a category is a subsystem's name, never a value.`,
        );
      }
      return createLogger(category, { sink, clock, thresholdFor });
    },

    verbosity: () => {
      expireIfDue();
      return verbosity;
    },

    setVerbosity: (next) => {
      // Diagnostic mode is a temporary override, so changing the setting while
      // it is on changes what the user goes back to, not what is in force.
      // Applying it immediately would leave diagnostic mode reported as active
      // while collecting nothing more than usual.
      expireIfDue();
      if (verbosityBeforeDiagnosticMode === undefined) {
        verbosity = next;
      } else {
        verbosityBeforeDiagnosticMode = next;
      }
    },

    isDiagnosticModeActive: () => {
      expireIfDue();
      return verbosityBeforeDiagnosticMode !== undefined;
    },

    diagnosticModeEndsAt: () => {
      expireIfDue();
      return diagnosticModeEndsAt;
    },

    startDiagnosticMode: (durationMs = DIAGNOSTIC_MODE_DURATION_MS) => {
      expireIfDue();
      if (verbosityBeforeDiagnosticMode !== undefined) return;
      verbosityBeforeDiagnosticMode = verbosity;
      verbosity = DIAGNOSTIC_MODE_VERBOSITY;
      diagnosticModeEndsAt = clock.now() + durationMs;
    },

    stopDiagnosticMode: () => {
      if (verbosityBeforeDiagnosticMode === undefined) return;
      verbosity = verbosityBeforeDiagnosticMode;
      verbosityBeforeDiagnosticMode = undefined;
      diagnosticModeEndsAt = undefined;
    },

    relay: relayInto(sink, thresholdFor),
  };
}
