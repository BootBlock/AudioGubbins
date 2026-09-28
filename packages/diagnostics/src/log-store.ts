/**
 * Where records are kept, and how their number is bounded.
 *
 * REQ-PRIV-165 requires bounded, storage-aware retention, the ability to clear
 * logs, and the ability to inspect approximate log-storage usage. An unbounded
 * buffer in a long editing session would grow until the tab died, which is a
 * data-loss defect dressed as a logging feature.
 *
 * The store is a ring: once full, the oldest record is dropped to make room.
 * Dropping the oldest rather than refusing the newest is deliberate. The
 * records that explain a failure are the ones just before it, and a store that
 * stopped accepting records an hour ago would hold none of them.
 */

import type { LogRecord, PerformanceRecord } from './log-record.js';

/** Receives records as they are produced. */
export interface LogSink {
  /** Accepts a record. Must not throw: logging never breaks the caller. */
  write(record: LogRecord): void;

  /** Accepts a performance measurement. */
  writePerformance(record: PerformanceRecord): void;
}

/** How much a store currently holds. */
export interface LogStorageUsage {
  /** Records currently retained. */
  readonly recordCount: number;

  /** Performance measurements currently retained. */
  readonly performanceCount: number;

  /**
   * Approximate bytes held, assuming UTF-16 string storage.
   *
   * Approximate by contract, not by accident: the exact figure depends on the
   * engine's string representation, and REQ-PRIV-165 asks the user be able to
   * inspect approximate usage rather than an exact one they cannot act on.
   */
  readonly approximateBytes: number;

  /** How many records have been dropped to stay within the bound. */
  readonly droppedRecordCount: number;
}

/** A bounded in-memory record store. */
export interface LogStore extends LogSink {
  /**
   * Every retained record, oldest first.
   *
   * The same array until the contents change, so two reads with nothing in
   * between are the same object. That is not an optimisation: handed a fresh
   * copy on every read, a reader that compares snapshots to decide whether
   * anything happened would compare a fresh copy with itself every time. A
   * React panel doing exactly that exceeds the update depth on its first paint
   * and blanks the whole application, because a throw below the composition
   * root has nothing to catch it.
   */
  snapshot(): readonly LogRecord[];

  /** Every retained performance measurement, oldest first. As stable as {@link snapshot}. */
  performanceSnapshot(): readonly PerformanceRecord[];

  /** Approximately how much is held. */
  usage(): LogStorageUsage;

  /** Discards everything retained and resets the dropped count. */
  clear(): void;
}

/** How many records a store retains before it starts dropping the oldest. */
export interface LogStoreLimits {
  readonly maximumRecords: number;
  readonly maximumPerformanceRecords: number;
}

/**
 * Default retention.
 *
 * Five thousand records covers a long editing session at Info verbosity while
 * costing roughly a megabyte, which is small beside the audio the same session
 * holds. Diagnostic mode raises the verbosity, not the bound, so turning it on
 * cannot exhaust memory.
 */
const DEFAULT_LOG_STORE_LIMITS: LogStoreLimits = {
  maximumRecords: 5_000,
  maximumPerformanceRecords: 2_000,
};

/** Approximate bytes one record occupies, assuming UTF-16 strings. */
function approximateRecordBytes(record: LogRecord): number {
  let characters = record.message.length + record.category.length;
  if (record.correlationId !== undefined) characters += record.correlationId.length;
  for (const [name, value] of Object.entries(record.fields)) {
    characters += name.length + (typeof value === 'string' ? value.length : 8);
  }
  for (const frame of record.stack?.frames ?? []) characters += frame.length;

  // Two bytes per character, plus a fixed allowance for the timestamp, the
  // severity and the object's own overhead.
  return characters * 2 + 64;
}

/** Creates a bounded in-memory store. */
export function createLogStore(limits: LogStoreLimits = DEFAULT_LOG_STORE_LIMITS): LogStore {
  if (limits.maximumRecords < 1 || limits.maximumPerformanceRecords < 1) {
    throw new Error('A log store must retain at least one record of each kind.');
  }

  let records: LogRecord[] = [];
  let performance: PerformanceRecord[] = [];
  let droppedRecordCount = 0;
  let approximateBytes = 0;
  // The arrays handed out, kept until something changes them. Cleared rather
  // than rebuilt on a write, so a session that logs thousands of records and
  // never opens the panel copies nothing at all.
  let recordSnapshot: readonly LogRecord[] | undefined;
  let performanceSnapshotCache: readonly PerformanceRecord[] | undefined;

  return {
    write(record) {
      records.push(record);
      approximateBytes += approximateRecordBytes(record);
      recordSnapshot = undefined;

      while (records.length > limits.maximumRecords) {
        const dropped = records.shift();
        if (dropped !== undefined) approximateBytes -= approximateRecordBytes(dropped);
        droppedRecordCount += 1;
      }
    },

    writePerformance(record) {
      performance.push(record);
      performanceSnapshotCache = undefined;
      while (performance.length > limits.maximumPerformanceRecords) {
        performance.shift();
      }
    },

    snapshot() {
      // Frozen, because the same array is handed to every caller until
      // something changes it. An unfrozen shared copy would let one reader's
      // mistake become what every other reader sees.
      recordSnapshot ??= Object.freeze([...records]);
      return recordSnapshot;
    },

    performanceSnapshot() {
      performanceSnapshotCache ??= Object.freeze([...performance]);
      return performanceSnapshotCache;
    },

    usage() {
      return {
        recordCount: records.length,
        performanceCount: performance.length,
        approximateBytes,
        droppedRecordCount,
      };
    },

    clear() {
      records = [];
      performance = [];
      droppedRecordCount = 0;
      approximateBytes = 0;
      recordSnapshot = undefined;
      performanceSnapshotCache = undefined;
    },
  };
}

/**
 * Sends every record to several sinks.
 *
 * For a second sink beside the bounded store, which nothing in this phase has:
 * the centre writes to the store alone, and nothing outside this package reads
 * this. A sink that throws is not allowed to stop the others or the caller, so
 * its failure is contained here.
 */
export function combineSinks(...sinks: readonly LogSink[]): LogSink {
  return {
    write(record) {
      for (const sink of sinks) {
        try {
          sink.write(record);
        } catch {
          // A broken sink must not take down the operation that logged, nor the
          // other sinks. There is nowhere to report this: reporting it would
          // itself log, and a sink that throws on every record would recurse.
        }
      }
    },

    writePerformance(record) {
      for (const sink of sinks) {
        try {
          sink.writePerformance(record);
        } catch {
          // As above.
        }
      }
    },
  };
}
