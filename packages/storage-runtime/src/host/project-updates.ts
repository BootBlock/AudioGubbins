/**
 * The updates an open project is sent to the page as: everything it opens
 * with, then after each change what differs from the project last sent
 * (ADR-0022).
 *
 * The models a session publishes share whatever a change did not touch, so a
 * member the same object as the one last sent is unchanged, and is left out.
 * The history is sent as its delta from the history last sent, which skips
 * every subtree the two share.
 */

import { historyDelta, type Comparison } from '@audiogubbins/history';
import type { ProjectModel, ProjectSnapshot } from '@audiogubbins/storage';

import type {
  ComparisonUpdate,
  FirstUpdate,
  ProjectUpdate,
} from '../protocol/project-operations.js';

/** The update a project opens with: all of it. */
export function firstUpdate(snapshot: ProjectSnapshot): FirstUpdate {
  const { model, save, access } = snapshot;
  const { comparison } = model;
  return {
    save,
    access,
    history: historyDelta(undefined, model.history),
    state: model.state,
    exports: model.exports,
    retention: model.retention,
    backup: model.backup,
    ...(comparison === undefined ? {} : { comparison: comparisonUpdate(comparison) }),
  };
}

/** The update from the project last sent, `sent`, to `snapshot`. */
export function updateSince(sent: ProjectModel, snapshot: ProjectSnapshot): ProjectUpdate {
  const { model, save, access } = snapshot;
  const { state, exports, retention, backup, comparison } = model;
  return {
    save,
    access,
    history: historyDelta(sent.history, model.history),
    ...(state === sent.state ? {} : { state }),
    ...(exports === sent.exports ? {} : { exports }),
    ...(retention === sent.retention ? {} : { retention }),
    ...(backup === sent.backup ? {} : { backup }),
    ...(comparison === sent.comparison ? {} : { comparison: comparisonUpdate(comparison) }),
  };
}

function comparisonUpdate(comparison: Comparison | undefined): ComparisonUpdate {
  return comparison === undefined ? { kind: 'closed' } : { kind: 'open', comparison };
}
