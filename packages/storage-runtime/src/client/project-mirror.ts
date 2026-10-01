/**
 * The page's copy of a project open in the storage worker: the snapshot the
 * interface reads, made again from each update the worker sends (ADR-0022).
 *
 * A new snapshot is made only as an update arrives, and is then the same
 * value until the next, so its identity marks a change as the session's own
 * does for `useSyncExternalStore`. The history is made from the one before
 * and the update's delta, so it keeps every entry the update did not carry,
 * and every other member is the one before where the update left it out.
 */

import type { ProjectId } from '@audiogubbins/domain';
import { applyHistoryDelta } from '@audiogubbins/history';
import type { ProjectModel, ProjectSnapshot } from '@audiogubbins/storage';

import type { FirstUpdate, ProjectUpdate } from '../protocol/project-operations.js';

/** The model a project opened as. */
function openedModel(first: FirstUpdate): ProjectModel {
  const { state, exports, retention, backup, comparison } = first;
  const model = {
    state,
    history: applyHistoryDelta(undefined, first.history),
    exports,
    retention,
    backup,
  };
  return comparison?.kind === 'open' ? { ...model, comparison: comparison.comparison } : model;
}

/** The model after an update. */
function updatedModel(before: ProjectModel, update: ProjectUpdate): ProjectModel {
  const model = {
    state: update.state ?? before.state,
    history: applyHistoryDelta(before.history, update.history),
    exports: update.exports ?? before.exports,
    retention: update.retention ?? before.retention,
    backup: update.backup ?? before.backup,
  };
  const comparison =
    update.comparison === undefined
      ? before.comparison
      : update.comparison.kind === 'open'
        ? update.comparison.comparison
        : undefined;
  return comparison === undefined ? model : { ...model, comparison };
}

/** The page's copy of an open project (see the module comment). */
export class ProjectMirror {
  readonly #listeners = new Set<() => void>();
  #current: ProjectSnapshot;

  constructor(project: ProjectId, first: FirstUpdate) {
    const { save, access } = first;
    this.#current = { project, model: openedModel(first), save, access };
  }

  /** Calls `listener` after each update until the returned function is called. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** The latest snapshot: the same value until an update arrives. */
  readonly getSnapshot = (): ProjectSnapshot => this.#current;

  /** Makes the snapshot again from an update, and tells every subscriber. */
  apply(update: ProjectUpdate): void {
    const { project, model } = this.#current;
    const { save, access } = update;
    this.#current = { project, model: updatedModel(model, update), save, access };
    for (const listener of [...this.#listeners]) listener();
  }
}
