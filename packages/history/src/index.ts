/**
 * The public contract of the AudioGubbins project history.
 *
 * The branching history as values (ADR-0006, ADR-0020): its nodes and the
 * cursor, the path between two nodes, branch names, named snapshots, the
 * whole-project A/B comparison with the difference of two states, the rows of
 * the History panel, the states and media the history retains, and the planning
 * and applying of compaction under a retention policy. Everything is a pure
 * function of immutable values: the storage layer keeps the history, replays
 * what a move plans through the command layer and keeps the states its
 * fingerprints name, and the interface only calls these functions, so no
 * branching rule lives anywhere else (REQ-STOR-193).
 *
 * The persisted form of a history, and the brands of its identifiers and
 * labels, are `@audiogubbins/project-format`'s. Everything absent from this
 * list is internal and may change without being a contract change
 * (REQ-REPO-186).
 */

export { type MapChanges, type PersistentMap } from './persistent-map.js';

export { type HistoryDelta, applyHistoryDelta, historyDelta } from './history-delta.js';

export {
  type ChangeDraft,
  type ChangeNode,
  type History,
  type HistoryNode,
  changeNodeOf,
  nameBranch,
  recordChange,
  startHistory,
  withStateFingerprint,
} from './history.js';

export { activeLine } from './lines.js';

export {
  type HistoryPath,
  type Navigation,
  type Restoration,
  moveTo,
  pathBetween,
  redo,
  redoTarget,
  restorationOf,
  undo,
  undoTarget,
} from './navigation.js';

export { createSnapshot, deleteSnapshot } from './snapshots.js';

export { type FieldOf } from './entity-fields.js';
export { type ChainOwner, type DifferenceNames, differenceNames } from './difference-names.js';

export {
  type ChainDifference,
  type EntityChange,
  type EntityDifferences,
  type ParameterChange,
  type ProcessorDifference,
  type ProjectField,
  type StateDifference,
  diffStates,
} from './state-diff.js';
export { affectedBy } from './affected-entities.js';

export {
  type Comparison,
  type ComparisonSide,
  type ComparisonSource,
  type SideName,
  comparedDifference,
  comparisonSide,
  comparisonSurviving,
  listenedSide,
  promotion,
  startComparison,
  switchSide,
} from './comparison.js';

export {
  type EntityKind,
  type EntityReference,
  type HistoryRow,
  type HistoryRowModel,
  type RowContext,
  type RowQuery,
  affectedEntities,
  historyRowModel,
} from './history-rows.js';
export { type HistoryRowOrder, historyRowOrder } from './history-row-order.js';

export {
  type CompactionContext,
  type CompactionPlan,
  type CompactionRequest,
  type LostCapability,
  planCompaction,
} from './compaction-plan.js';
export { applyCompaction } from './compaction-apply.js';

export { type ContentRetention, contentRetention, retainedStates } from './retention.js';

export {
  historyFromRecord,
  historyRecordOf,
  nodeFromRecord,
  storedPreferences,
} from './history-conversion.js';
