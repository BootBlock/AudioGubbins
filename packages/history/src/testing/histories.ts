/**
 * Histories for this package's tests, built through the package's own functions
 * so every one keeps the invariants the functions keep, and random ones from a
 * seed, so a property test is the same on every run.
 */

import { commandId, type CommandInvocation } from '@audiogubbins/commands';
import {
  createDeterministicIdGenerator,
  unsafeBrandId,
  type IdGenerator,
  type ProjectId,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  historyLabelFrom,
  stateFingerprintFrom,
  type AffectedEntities,
  type HistoryNodeId,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import { changeNodeOf, nameBranch, recordChange, startHistory, type History } from '../history.js';
import { historyRowOrder } from '../history-row-order.js';
import {
  historyRowModel,
  type HistoryRow,
  type RowContext,
  type RowQuery,
} from '../history-rows.js';
import { moveTo } from '../navigation.js';
import type { MapChanges, PersistentMap } from '../persistent-map.js';
import { createSnapshot } from '../snapshots.js';

/** The project every test history is of. */
const PROJECT: ProjectId = unsafeBrandId<'ProjectId'>('00000000-0000-4000-8000-00000000a0a0');

/** The first moment of a test history, in milliseconds since the epoch. */
export const EPOCH = 1_790_000_000_000;

export const NOTHING_AFFECTED: AffectedEntities = {
  assets: [],
  tracks: [],
  buses: [],
  clips: [],
  regions: [],
  markers: [],
  effectChains: [],
  takeStacks: [],
  project: false,
};

/** An invocation of a test command naming the step it belongs to. */
export function invocation(name: string, step: string): CommandInvocation {
  return { commandId: commandId(`test.${name}`), arguments: { step } };
}

/** A state fingerprint made of a number. */
export function fingerprintOf(value: number): StateFingerprint {
  return expectSuccess(stateFingerprintFrom(`s1-${value.toString(16).padStart(64, '0')}`));
}

/** Identifiers for a test, the same on every run. */
export function testIds(seed = 7): IdGenerator {
  return createDeterministicIdGenerator(seed);
}

/** A history started at a new project's origin. */
export function newHistory(ids: IdGenerator): History {
  return startHistory(PROJECT, {
    kind: 'origin',
    id: ids.next<'HistoryNodeId'>(),
    at: EPOCH,
    origin: { kind: 'new' },
  });
}

/** The history with one change recorded at the cursor, described as `step`. */
export function grown(history: History, id: HistoryNodeId, step: string, at?: number): History {
  const node = changeNodeOf(history, {
    id,
    at: at ?? EPOCH + history.nodes.size,
    entry: {
      description: step,
      forward: [invocation('do', step)],
      inverse: [invocation('undo', step)],
    },
    affects: NOTHING_AFFECTED,
  });
  return expectSuccess(recordChange(history, node));
}

/** The history with its cursor at `id`. */
export function movedTo(history: History, id: HistoryNodeId): History {
  return expectSuccess(moveTo(history, id)).history;
}

/** A deterministic sequence of numbers from 0 up to 1 (Mulberry32). */
export interface Random {
  next(): number;
  below(limit: number): number;
}

export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  return { next, below: (limit) => Math.floor(next() * limit) };
}

/**
 * A random history of about `size` changes: changes recorded at the cursor,
 * moves to random nodes that start branches, branch names, fingerprints and
 * snapshots.
 */
export function randomHistory(seed: number, size: number): History {
  const random = seededRandom(seed);
  const ids = testIds(seed);
  let history = newHistory(ids);
  const known: HistoryNodeId[] = [history.root];
  for (let step = 0; step < size; step += 1) {
    const roll = random.next();
    if (roll < 0.2) {
      const target = known[random.below(known.length)] ?? history.root;
      history = movedTo(history, target);
    }
    const id = ids.next<'HistoryNodeId'>();
    history = grown(history, id, `Step ${String(step)}`, EPOCH + step * 60_000);
    known.push(id);
    if (roll > 0.95) {
      const name = expectSuccess(historyLabelFrom(`Branch ${String(step)}`));
      history = expectSuccess(nameBranch(history, id, name));
    }
    if (roll > 0.9 && roll <= 0.95) {
      history = expectSuccess(
        createSnapshot(history, {
          id: ids.next<'SnapshotId'>(),
          kind: step % 2 === 0 ? 'named' : 'recovery',
          name: expectSuccess(historyLabelFrom(`Snapshot ${String(step)}`)),
          at: EPOCH + step * 60_000,
          application: 'AudioGubbins 0.1.0',
          node: id,
          stateFingerprint: fingerprintOf(step + 1),
          exports: [],
        }),
      );
    }
  }
  return history;
}

/**
 * A history whose nodes count how often they are read, so a test can say how
 * much of the history a walk visits.
 */
export function readCounted(history: History): {
  readonly history: History;
  readonly reads: () => number;
} {
  const nodes = new CountingMap(history.nodes);
  return { history: { ...history, nodes }, reads: () => nodes.reads };
}

/** A map that counts its reads and passes every call through. */
class CountingMap<TKey extends string, TValue> implements PersistentMap<TKey, TValue> {
  reads = 0;
  readonly #inner: PersistentMap<TKey, TValue>;

  constructor(inner: PersistentMap<TKey, TValue>) {
    this.#inner = inner;
  }

  get size(): number {
    return this.#inner.size;
  }

  get(key: TKey): TValue | undefined {
    this.reads += 1;
    return this.#inner.get(key);
  }

  has(key: TKey): boolean {
    this.reads += 1;
    return this.#inner.has(key);
  }

  set(key: TKey, value: TValue): PersistentMap<TKey, TValue> {
    return this.#inner.set(key, value);
  }

  keys(): IterableIterator<TKey> {
    return this.#inner.keys();
  }

  values(): IterableIterator<TValue> {
    return this.#inner.values();
  }

  entries(): IterableIterator<readonly [TKey, TValue]> {
    return this.#inner.entries();
  }

  changesSince(earlier: PersistentMap<TKey, TValue>): MapChanges<TKey, TValue> {
    return this.#inner.changesSince(earlier);
  }

  withChanges(changes: MapChanges<TKey, TValue>): PersistentMap<TKey, TValue> {
    return this.#inner.withChanges(changes);
  }
}

/** Every row of `history` that `query` shows, each read, in order. */
export function rowsOf(
  history: History,
  query: RowQuery = {},
  context: RowContext = {},
): readonly HistoryRow[] {
  const model = historyRowModel(historyRowOrder(history), query, context);
  return Array.from({ length: model.count }, (_, index) => model.rowAt(index)).filter(
    (row) => row !== undefined,
  );
}
