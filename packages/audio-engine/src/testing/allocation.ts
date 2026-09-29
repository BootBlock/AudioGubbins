/**
 * How much a run of the engine's code allocates, for the tests that hold the
 * audio thread's code to allocating nothing.
 *
 * A collection on the audio thread pauses the quantum that triggered it, and
 * an allocation per sample or per call is not an error the output shows:
 * only measuring what the heap gained finds it.
 *
 * How it is measured, and why this way. Each new object is bump-allocated in
 * V8's young generation, so the bytes in use there, read before and after a
 * run of quanta, differ by exactly what the run allocated, as long as no
 * collection ran between the reads: `GCProfiler` says whether one did, and
 * such a trial is discarded. Both reads are of this thread's own isolate, so
 * other processes and other test workers on a busy machine cannot move them.
 * Three other measures were tried and refused. The isolate's
 * `total_allocated_bytes` advances only when an allocation buffer is retired,
 * so it moves in steps of hundreds of kilobytes whatever the code does. The
 * old generation's sizes shrink at any moment as the concurrent sweeper runs.
 * Counting collections, or timing, over a long run depends on heap limits and
 * machine load. The reading itself allocates a few objects, the same in every
 * trial, which the baseline of an empty run removes.
 *
 * A run is warmed first, so what runs is the optimised code the audio thread
 * runs once it is warm. On a loaded machine the optimiser can finish late,
 * after the code meets a branch its first compilation never saw, and code
 * awaiting it allocates a little: so warming and measuring repeat, up to
 * {@link ROUNDS} times, until a round finds nothing. An allocation in the
 * code itself is in every round, and still fails.
 *
 * Node's `v8` module is reached through `process.getBuiltinModule` and read
 * for the calls made of it, as `dsp-module.ts` reaches WebAssembly: this
 * module is published to other packages' tests, and every published entry
 * point is compiled without Node's type definitions.
 */

/** Quanta in one measured trial: a kernel allocating even 8 bytes a quantum shows 8 KiB. */
export const QUANTA = 1024;

/** Quanta run before measuring, so each path is compiled and settled first. */
const WARM_QUANTA = 4096;

/** Trials measured, of which the least is taken, and those a collection interrupted dropped. */
const TRIALS = 8;

/** The most rounds of warming and measuring before a run's allocation is taken as its own. */
const ROUNDS = 16;

/** The spaces of V8's young generation, where every small new object is placed. */
const YOUNG_SPACES: ReadonlySet<string> = new Set(['new_space', 'new_large_object_space']);

/** Node's `v8` module, which only a Node test host has. */
function nodeV8(): object {
  const host: unknown = Reflect.get(globalThis, 'process');
  const getBuiltinModule: unknown =
    typeof host === 'object' && host !== null ? Reflect.get(host, 'getBuiltinModule') : undefined;
  const v8: unknown =
    typeof getBuiltinModule === 'function'
      ? Reflect.apply(getBuiltinModule, host, ['node:v8'])
      : undefined;
  if (typeof v8 !== 'object' || v8 === null) {
    throw new Error('Allocation is measured on Node, whose heap this test host does not have.');
  }
  return v8;
}

/** Calls `name` on `target` with no arguments, which must be a method of it. */
function call(target: object, name: string): unknown {
  const method: unknown = Reflect.get(target, name);
  if (typeof method !== 'function') throw new Error(`Node's v8 module has no ${name}.`);
  return Reflect.apply(method, target, []);
}

/** A number `field` of `value`, which must have it. */
function numberOf(value: unknown, field: string): number {
  const read: unknown =
    typeof value === 'object' && value !== null ? Reflect.get(value, field) : undefined;
  if (typeof read !== 'number') throw new Error(`A heap space has no number ${field}.`);
  return read;
}

function youngBytes(v8: object): number {
  const spaces = call(v8, 'getHeapSpaceStatistics');
  if (!Array.isArray(spaces)) throw new Error('Node gave no heap spaces.');
  let bytes = 0;
  for (const space of spaces) {
    const name: unknown =
      typeof space === 'object' && space !== null ? Reflect.get(space, 'space_name') : undefined;
    if (typeof name === 'string' && YOUNG_SPACES.has(name)) {
      bytes += numberOf(space, 'space_used_size');
    }
  }
  return bytes;
}

/** Starts a profile of collections, and answers how to stop it and count them. */
function profileCollections(v8: object): () => number {
  const Profiler: unknown = Reflect.get(v8, 'GCProfiler');
  if (typeof Profiler !== 'function') throw new Error("Node's v8 module has no GCProfiler.");
  const profiler: unknown = Reflect.construct(Profiler, []);
  if (typeof profiler !== 'object' || profiler === null) {
    throw new Error('Node made no collection profiler.');
  }
  call(profiler, 'start');
  return () => {
    const profile = call(profiler, 'stop');
    const statistics: unknown =
      typeof profile === 'object' && profile !== null
        ? Reflect.get(profile, 'statistics')
        : undefined;
    if (!Array.isArray(statistics)) throw new Error('A collection profile has no statistics.');
    return statistics.length;
  };
}

/** What one measured run does: `prepare` outside the measurement, then `quanta` calls of `quantum`. */
export interface Run {
  readonly prepare?: () => void;
  readonly quantum: () => void;
  readonly quanta?: number;
}

/**
 * The fewest bytes one trial of a run allocated, over the trials no
 * collection interrupted, or `undefined` when a collection interrupted every
 * one, which only allocating can cause.
 */
function leastAllocated({ prepare, quantum, quanta = QUANTA }: Run): number | undefined {
  const v8 = nodeV8();
  let least: number | undefined;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    prepare?.();
    const stopProfiling = profileCollections(v8);
    const before = youngBytes(v8);
    for (let count = 0; count < quanta; count += 1) quantum();
    const after = youngBytes(v8);
    const collections = stopProfiling();
    if (collections === 0 && (least === undefined || after - before < least)) {
      least = after - before;
    }
  }
  return least;
}

/**
 * The fewest bytes a run allocated beyond an empty run's in a round, warmed
 * first, over rounds that stop at the first to reach less than a byte a
 * quantum.
 */
export function allocatedBy(run: Run): number {
  const quanta = run.quanta ?? QUANTA;
  let least = Number.POSITIVE_INFINITY;
  for (let round = 0; round < ROUNDS && least >= quanta; round += 1) {
    for (let count = 0; count < WARM_QUANTA; count += 1) {
      if (count % quanta === 0) run.prepare?.();
      run.quantum();
    }
    const baseline = leastAllocated({ quantum: () => undefined, quanta });
    const measured = leastAllocated(run);
    if (baseline === undefined) throw new Error('A collection interrupted every empty trial.');
    if (measured !== undefined) least = Math.min(least, measured - baseline);
  }
  return least;
}
