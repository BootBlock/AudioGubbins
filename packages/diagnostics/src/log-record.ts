/**
 * What a diagnostic log record holds.
 *
 * REQ-PRIV-165 requires structured local logging good enough to diagnose audio,
 * rendering, storage, capability, PWA, Godot, DSP and recovery failures. That
 * rules out formatted message strings: a failure is diagnosed by filtering and
 * correlating records, which needs the fields to still be fields.
 *
 * The same requirement forbids several categories of content by default. The
 * field value type below is the first line of that defence: a record cannot
 * hold a `Float32Array` of samples, a decoded project or an object of unknown
 * shape, because those cannot be assigned to it.
 */

/**
 * How serious a record is.
 *
 * Ordered so that a configured verbosity admits everything at or above it. The
 * numbers are an implementation detail of that comparison and are never
 * persisted or shown: a stored level is its name.
 */
export const LogSeverity = {
  /** The operation failed and the user's intent was not carried out. */
  Error: 'error',

  /** Something was wrong but the operation continued, possibly degraded. */
  Warning: 'warning',

  /** A notable event in normal operation. */
  Info: 'info',

  /** Detail useful when investigating a specific subsystem. */
  Debug: 'debug',

  /** Step-by-step detail, only ever collected in diagnostic mode. */
  Trace: 'trace',
} as const;

/** How serious a record is. */
export type LogSeverity = (typeof LogSeverity)[keyof typeof LogSeverity];

/** Severity order, least verbose first. */
const SEVERITY_ORDER: readonly LogSeverity[] = [
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Info,
  LogSeverity.Debug,
  LogSeverity.Trace,
];

/** Whether `severity` is admitted by a threshold of `minimum`. */
export function severityPasses(severity: LogSeverity, minimum: LogSeverity): boolean {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(minimum);
}

/**
 * Whether a value is one of the severities.
 *
 * Here, beside the severities, because more than one module reads a level back
 * from storage or a file, and a copy in each could come apart from the list.
 */
export function isLogSeverity(value: unknown): value is LogSeverity {
  return SEVERITY_ORDER.some((severity) => severity === value);
}

/** Every severity, from least to most verbose. */
export function allSeverities(): readonly LogSeverity[] {
  return SEVERITY_ORDER;
}

/**
 * A value a structured field may hold.
 *
 * Deliberately narrow. REQ-PRIV-165 prohibits raw audio samples, encoded audio
 * payloads, entire project documents and full external file contents from
 * appearing in logs by default. Accepting only these types means such a value
 * cannot be logged by accident, which is a stronger guarantee than a redaction
 * pass that has to recognise it afterwards.
 */
export type LogFieldValue = string | number | boolean | null;

/** The structured fields of a record. */
export type LogFields = Readonly<Record<string, LogFieldValue>>;

/**
 * Identifies one user-visible operation across every record it produced.
 *
 * REQ-PRIV-165 requires correlation identifiers because the interesting
 * failures span subsystems: an export that fails is a command, a render, a
 * codec call and a storage write, and the records that matter are the ones
 * sharing an identifier rather than the ones sharing a moment.
 */
export type CorrelationId = string;

/**
 * A stack trace with absolute paths already removed.
 *
 * Kept as a distinct type so that the bundle assembler can tell a sanitised
 * trace from an unsanitised string. REQ-PRIV-161 permits sanitised stack traces
 * in a shared bundle and prohibits full local filesystem paths. `sanitiseStack`
 * in the redaction module is how one is made from an engine's stack text.
 */
export interface SanitisedStackTrace {
  readonly frames: readonly string[];
}

/**
 * What a log category looks like: a subsystem's name, written in code.
 *
 * Lower-case words joined by hyphens, and short. A category is chosen by the
 * code that asks for a logger, never built from a value; one built from a path
 * or a token would carry it into the settings list, where it is shown, and into
 * the stored verbosity, which outlives every log rotation and is never
 * redacted.
 */
const LOG_CATEGORY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The longest a category may be. */
const LONGEST_LOG_CATEGORY = 40;

/** Whether a value is a log category, rather than something a value was built into. */
export function isLogCategory(value: string): boolean {
  return value.length <= LONGEST_LOG_CATEGORY && LOG_CATEGORY.test(value);
}

/** One diagnostic record. */
export interface LogRecord {
  /** Milliseconds since the Unix epoch, from the injected clock. */
  readonly timestamp: number;

  readonly severity: LogSeverity;

  /** Which subsystem produced the record. */
  readonly category: string;

  /**
   * A short, stable, British-English description of what happened.
   *
   * Written as a constant rather than assembled from values: the values belong
   * in `fields`, where they can be filtered on. An interpolated message turns a
   * searchable field back into prose.
   */
  readonly message: string;

  readonly fields: LogFields;

  /** The operation this record belongs to, if it belongs to one. */
  readonly correlationId?: CorrelationId;

  /** Present when the record describes a failure that carried a stack. */
  readonly stack?: SanitisedStackTrace;
}

/**
 * A measured duration.
 *
 * REQ-PRIV-165 permits performance-event logging and REQ-PRIV-162 prohibits
 * behavioural analytics, so this records how long an operation took and never
 * which feature a person chose to use or how often.
 */
export interface PerformanceRecord {
  readonly timestamp: number;
  readonly category: string;

  /** What was measured, for example `waveform-peaks-built`. */
  readonly operation: string;

  /** Elapsed milliseconds. */
  readonly durationMs: number;

  readonly fields: LogFields;
  readonly correlationId?: CorrelationId;
}
