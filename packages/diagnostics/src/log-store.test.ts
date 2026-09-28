import { describe, expect, it, vi } from 'vitest';

import { LogSeverity, type LogRecord, type PerformanceRecord } from './log-record.js';
import { combineSinks, createLogStore, type LogSink } from './log-store.js';

function record(index: number): LogRecord {
  return {
    timestamp: index,
    severity: LogSeverity.Info,
    category: 'test',
    message: `Record ${String(index)}.`,
    fields: {},
  };
}

function performanceRecord(index: number): PerformanceRecord {
  return {
    timestamp: index,
    category: 'test',
    operation: 'work',
    durationMs: index,
    fields: {},
  };
}

describe('createLogStore', () => {
  it('starts empty', () => {
    const store = createLogStore();
    expect(store.snapshot()).toEqual([]);
    expect(store.usage()).toMatchObject({ recordCount: 0, droppedRecordCount: 0 });
  });

  it('retains records oldest first', () => {
    const store = createLogStore();
    store.write(record(1));
    store.write(record(2));
    expect(store.snapshot().map((r) => r.timestamp)).toEqual([1, 2]);
  });

  it('drops the oldest record once full, keeping the ones nearest a failure', () => {
    const store = createLogStore({ maximumRecords: 3, maximumPerformanceRecords: 3 });
    for (let index = 1; index <= 5; index += 1) store.write(record(index));

    expect(store.snapshot().map((r) => r.timestamp)).toEqual([3, 4, 5]);
  });

  it('reports how many records it dropped', () => {
    const store = createLogStore({ maximumRecords: 2, maximumPerformanceRecords: 2 });
    for (let index = 1; index <= 5; index += 1) store.write(record(index));

    expect(store.usage().droppedRecordCount).toBe(3);
  });

  it('bounds performance measurements separately', () => {
    const store = createLogStore({ maximumRecords: 100, maximumPerformanceRecords: 2 });
    for (let index = 1; index <= 4; index += 1) store.writePerformance(performanceRecord(index));

    expect(store.performanceSnapshot().map((r) => r.timestamp)).toEqual([3, 4]);
  });

  it('reports usage that grows with what it holds and falls back to zero when cleared', () => {
    const store = createLogStore();
    const empty = store.usage().approximateBytes;

    store.write(record(1));
    expect(store.usage().approximateBytes).toBeGreaterThan(empty);

    store.clear();
    expect(store.usage()).toEqual({
      recordCount: 0,
      performanceCount: 0,
      approximateBytes: 0,
      droppedRecordCount: 0,
    });
  });

  it('keeps the usage estimate bounded once the ring is full', () => {
    const store = createLogStore({ maximumRecords: 10, maximumPerformanceRecords: 10 });
    for (let index = 1; index <= 10; index += 1) store.write(record(index));
    const whenFull = store.usage().approximateBytes;

    for (let index = 11; index <= 100; index += 1) store.write(record(index));

    // Ninety further records of the same size must not grow the estimate: if
    // the subtraction on eviction were wrong, this is where it would show.
    expect(store.usage().approximateBytes).toBeLessThanOrEqual(whenFull * 1.2);
    expect(store.usage().recordCount).toBe(10);
  });

  it('returns a snapshot the caller cannot use to mutate the store', () => {
    const store = createLogStore();
    store.write(record(1));

    // Refused outright rather than absorbed. The same array is handed to every
    // caller until something changes it, so one reader's mistake would
    // otherwise become what every other reader sees.
    const snapshot = store.snapshot() as LogRecord[];
    expect(() => snapshot.push(record(2))).toThrow();

    expect(store.snapshot()).toHaveLength(1);
  });

  it('refuses a limit that would retain nothing', () => {
    expect(() => createLogStore({ maximumRecords: 0, maximumPerformanceRecords: 1 })).toThrow();
    expect(() => createLogStore({ maximumRecords: 1, maximumPerformanceRecords: 0 })).toThrow();
  });
});

describe('combineSinks', () => {
  it('writes to every sink', () => {
    const first = { write: vi.fn(), writePerformance: vi.fn() };
    const second = { write: vi.fn(), writePerformance: vi.fn() };

    const combined = combineSinks(first, second);
    combined.write(record(1));
    combined.writePerformance(performanceRecord(1));

    expect(first.write).toHaveBeenCalledOnce();
    expect(second.write).toHaveBeenCalledOnce();
    expect(first.writePerformance).toHaveBeenCalledOnce();
    expect(second.writePerformance).toHaveBeenCalledOnce();
  });

  it('does not let a broken sink stop the others', () => {
    const broken: LogSink = {
      write: () => {
        throw new Error('this sink is broken');
      },
      writePerformance: () => {
        throw new Error('this sink is broken');
      },
    };
    const working = { write: vi.fn(), writePerformance: vi.fn() };

    const combined = combineSinks(broken, working);
    combined.write(record(1));
    combined.writePerformance(performanceRecord(1));

    expect(working.write).toHaveBeenCalledOnce();
    expect(working.writePerformance).toHaveBeenCalledOnce();
  });

  it('does not let a broken sink break the caller that logged', () => {
    const broken: LogSink = {
      write: () => {
        throw new Error('this sink is broken');
      },
      writePerformance: () => {
        throw new Error('this sink is broken');
      },
    };

    expect(() => {
      combineSinks(broken).write(record(1));
    }).not.toThrow();
  });

  it('accepts no sinks at all', () => {
    expect(() => {
      combineSinks().write(record(1));
    }).not.toThrow();
  });
});

describe('the stability of a snapshot', () => {
  /**
   * The same array until the contents change.
   *
   * Given a fresh copy at every call, a reader that compares snapshots to
   * decide whether anything happened would find a change every time: a React
   * panel doing exactly that exceeds the update depth on its first paint and
   * blanks the whole application.
   */

  it('returns the same array when nothing has changed', () => {
    const store = createLogStore();
    store.write(record(1));

    expect(store.snapshot()).toBe(store.snapshot());
  });

  it('returns a different array once something is written', () => {
    const store = createLogStore();
    const before = store.snapshot();

    store.write(record(1));

    expect(store.snapshot()).not.toBe(before);
    expect(store.snapshot()).toHaveLength(1);
  });

  it('returns a different array once the store is cleared', () => {
    const store = createLogStore();
    store.write(record(1));
    const before = store.snapshot();

    store.clear();

    expect(store.snapshot()).not.toBe(before);
    expect(store.snapshot()).toEqual([]);
  });

  it('keeps the measurements as stable as the records', () => {
    const store = createLogStore();
    store.writePerformance(performanceRecord(1));

    expect(store.performanceSnapshot()).toBe(store.performanceSnapshot());

    store.writePerformance(performanceRecord(2));
    expect(store.performanceSnapshot()).toHaveLength(2);
  });

  it('leaves the records snapshot alone when only a measurement is written', () => {
    const store = createLogStore();
    store.write(record(1));
    const before = store.snapshot();

    store.writePerformance(performanceRecord(1));

    expect(store.snapshot()).toBe(before);
  });
});
