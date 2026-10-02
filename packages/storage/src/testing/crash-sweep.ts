/**
 * Crashing an operation at every operation of the tree in turn, and checking
 * what the storage holds after each (REQ-EXEC-180, REQ-STOR-101): the one sweep
 * every crash test of the storage runs, over the crash the memory tree injects.
 *
 * The operation is run once whole, to count the tree operations it makes and to
 * check the storage it leaves, and then once for each of those operations, on
 * the same storage it began from, with the tree crashing there. Each crash
 * tears its operation as the tree tears one, a whole-file write in each way
 * asked for, and the storage is then found as the next start would find it, to
 * be checked. A check that fails says which crash it followed.
 */

import {
  type MemoryStorageTree,
  SimulatedCrash,
  type TornWrite,
} from '@audiogubbins/media-store/testing';

/** Where an operation crashed, and what it gave where it was not cut short. */
export interface CrashPoint<TOutcome> {
  /** The tree operation the crash tore, counted from 1, or `undefined` for the run whole. */
  readonly at: number | undefined;
  readonly tornWrite: TornWrite;

  /** What the operation gave, or `undefined` where the crash cut it short. */
  readonly outcome: TOutcome | undefined;
}

/** An operation to crash, and what must hold of the storage after each crash. */
export interface CrashSweep<TOutcome> {
  /** The storage the operation begins from, which the sweep never changes. */
  readonly from: MemoryStorageTree;

  /** Runs the operation over a tree, with services of its own for each run. */
  readonly run: (tree: MemoryStorageTree) => Promise<TOutcome>;

  /** Checks the storage as a start after the crash finds it. */
  readonly check: (found: MemoryStorageTree, crash: CrashPoint<TOutcome>) => Promise<void>;

  /** How each crash leaves a whole-file write it tears: cut short where not given. */
  readonly tornWrites?: readonly TornWrite[];
}

/**
 * Runs the sweep (see the module comment), and gives the number of tree
 * operations the operation made whole, each of which was crashed.
 */
export async function sweepCrashes<TOutcome>(sweep: CrashSweep<TOutcome>): Promise<number> {
  const whole = sweep.from.restarted();
  const outcome = await sweep.run(whole);
  const operations = whole.operations;
  await checked(sweep, whole.restarted(), { at: undefined, tornWrite: 'short', outcome });
  for (let at = 1; at <= operations; at += 1) {
    for (const tornWrite of sweep.tornWrites ?? ['short']) {
      const tree = sweep.from.restarted({ crashAt: at, tornWrite });
      const reached = await sweep.run(tree).catch((error: unknown) => {
        if (error instanceof SimulatedCrash) return undefined;
        throw error;
      });
      await checked(sweep, tree.restarted(), { at, tornWrite, outcome: reached });
    }
  }
  return operations;
}

/** Checks one crash, saying which crash a failed check followed. */
async function checked<TOutcome>(
  sweep: CrashSweep<TOutcome>,
  found: MemoryStorageTree,
  crash: CrashPoint<TOutcome>,
): Promise<void> {
  try {
    await sweep.check(found, crash);
  } catch (error: unknown) {
    const where =
      crash.at === undefined
        ? 'With no crash'
        : `After a crash at operation ${String(crash.at)}, a write torn ${crash.tornWrite}`;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${where}: ${message}`, { cause: error });
  }
}
