/**
 * The persisted form of a project's branching history: its nodes, the node the
 * project is at, the child each node's redo follows, branch names, named
 * snapshots, and the retention policy that says what compaction may remove.
 *
 * These are plain values the storage layer writes and reads. The history
 * itself, and every rule of how it changes, is `@audiogubbins/history`'s, which
 * depends on this package; this package cannot depend on the command layer, so
 * an invocation here is {@link InvocationRecord}, whose command identifier is
 * text of the command-identifier shape, and a node is generic over its
 * invocation so the history's nodes, which hold branded command identifiers,
 * are records of this shape without being copied. Serves REQ-STOR-021,
 * REQ-STOR-055, REQ-STOR-193, REQ-STOR-194 and REQ-STOR-198.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type AssetId,
  type Branded,
  type BusId,
  type ClipId,
  type DomainResult,
  type EffectChainId,
  type MarkerId,
  type ProjectId,
  type RegionId,
  type TrackId,
} from '@audiogubbins/domain';

import type { StateFingerprint } from './content-identity.js';
import type { ExportRecordId } from './export-provenance.js';

/**
 * Identifies one node of a project's history. Stable for the node's life, so a
 * snapshot, an export record and a branch name can refer to it (REQ-STOR-193).
 */
export type HistoryNodeId = Branded<'HistoryNodeId'>;

/** Identifies one named snapshot. */
export type SnapshotId = Branded<'SnapshotId'>;

/**
 * A name a person gives a branch or a snapshot: trimmed, not empty, without a
 * control character, and at most {@link LONGEST_HISTORY_LABEL} code units. Made
 * only by {@link historyLabelFrom} or by reading a stored history, so every
 * label held can be written and read back.
 */
export type HistoryLabel = Branded<'HistoryLabel'>;

/** The longest {@link HistoryLabel}, in UTF-16 code units. */
export const LONGEST_HISTORY_LABEL = 1_024;

/** A label as {@link historyLabelFrom} leaves one: no edge space, no control. */
export const HISTORY_LABEL = /^[^\s\p{Cc}](?:[^\p{Cc}]*[^\s\p{Cc}])?$/u;

/** A command invocation as it is stored. */
export interface InvocationRecord {
  /**
   * The command's identifier, of the shape `@audiogubbins/commands` gives one:
   * dotted lower-case segments such as `project.rename`.
   */
  readonly commandId: string;
  readonly arguments?: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * The entities one change touched, by kind, each list sorted and without a
 * repeat. `project` says whether the project's own name, settings or track
 * order changed. Serves the History panel's indication of what a change
 * affected (REQ-STOR-196).
 */
export interface AffectedEntities {
  readonly assets: readonly AssetId[];
  readonly tracks: readonly TrackId[];
  readonly buses: readonly BusId[];
  readonly clips: readonly ClipId[];
  readonly regions: readonly RegionId[];
  readonly markers: readonly MarkerId[];
  readonly effectChains: readonly EffectChainId[];
  readonly project: boolean;
}

/** How a project's history began. */
export type ProjectOrigin =
  | { readonly kind: 'new' }
  | { readonly kind: 'import' }
  | {
      /**
       * A fork of another project's state (REQ-STOR-199): the project and the
       * node it was taken from, which the fork never changes, and the
       * fingerprint of the state it began as there (REQ-STOR-194), which says
       * which state of the source it is even once that node is compacted away.
       */
      readonly kind: 'fork';
      readonly project: ProjectId;
      readonly node: HistoryNodeId;
      readonly stateFingerprint: StateFingerprint;
    };

/**
 * The state a history starts from. It is the root and has no change: nothing
 * can be undone past it.
 */
export interface OriginNodeRecord {
  readonly kind: 'origin';
  readonly id: HistoryNodeId;

  /** When the history began, in milliseconds since the epoch. */
  readonly at: number;
  readonly origin: ProjectOrigin;

  /** The fingerprint of the state at this node, where it has been computed. */
  readonly stateFingerprint?: StateFingerprint;
}

/**
 * One reversible change: the invocations that made it and those that reverse
 * it, as the command layer's history entry gives them.
 *
 * `parent` is absent only on the root of a compacted history, whose earlier
 * changes were removed and whose state the storage layer keeps whole; its
 * change can then no longer be undone.
 */
export interface ChangeNodeRecord<TInvocation extends InvocationRecord = InvocationRecord> {
  readonly kind: 'change';
  readonly id: HistoryNodeId;
  readonly parent?: HistoryNodeId;

  /** When the change was made, in milliseconds since the epoch. */
  readonly at: number;

  /** What the change did, in British English, such as "Delete 3 regions". */
  readonly description: string;

  /** What was done, in order. */
  readonly forward: readonly [TInvocation, ...TInvocation[]];

  /** What reverses it, in the order it is replayed: last change first. */
  readonly inverse: readonly [TInvocation, ...TInvocation[]];
  readonly affects: AffectedEntities;

  /** The fingerprint of the state after the change, where it has been computed. */
  readonly stateFingerprint?: StateFingerprint;
}

/** A node of the history. */
export type HistoryNodeRecord<TInvocation extends InvocationRecord = InvocationRecord> =
  OriginNodeRecord | ChangeNodeRecord<TInvocation>;

/**
 * Why a snapshot was made: `named` by the person, `recovery` by the application
 * before something it cannot otherwise reverse, such as a compaction. Both are
 * kept by every compaction (REQ-STOR-055).
 */
export type SnapshotKind = 'named' | 'recovery';

/**
 * An explicit restore point (REQ-STOR-194). Immutable: it is made whole and
 * only ever deleted, never edited.
 */
export interface NamedSnapshot {
  readonly id: SnapshotId;
  readonly kind: SnapshotKind;
  readonly name: HistoryLabel;
  readonly notes?: string;

  /** When it was made, in milliseconds since the epoch. */
  readonly at: number;

  /** Who made it, as the person chose to be named, where they did. */
  readonly author?: string;

  /** The application and version that made it, such as `AudioGubbins 0.1.0`. */
  readonly application: string;

  /** The node whose state it keeps. */
  readonly node: HistoryNodeId;
  readonly stateFingerprint: StateFingerprint;

  /** The exports made from this state that the snapshot records (REQ-STOR-197). */
  readonly exports: readonly ExportRecordId[];
}

/** A project's history as it is stored. */
export interface HistoryRecord<TInvocation extends InvocationRecord = InvocationRecord> {
  readonly project: ProjectId;

  /** Every node, in any order; exactly one has no parent. */
  readonly nodes: readonly HistoryNodeRecord<TInvocation>[];

  /** The node the project is at. */
  readonly cursor: HistoryNodeId;

  /** The child redo follows from each node that has one recorded. */
  readonly preferred: ReadonlyMap<HistoryNodeId, HistoryNodeId>;

  /** The name of each branch, on the node the branch starts at. */
  readonly branchNames: ReadonlyMap<HistoryNodeId, HistoryLabel>;
  readonly snapshots: readonly NamedSnapshot[];
}

/**
 * A rule of automatic compaction: what it keeps. A node any rule keeps is kept.
 */
export type RetentionRule =
  | {
      /** The newest `count` changes the project can undo to. */
      readonly kind: 'recent-changes';
      readonly count: number;
    }
  | {
      /** Every node made in the last `days` days. */
      readonly kind: 'recent-days';
      readonly days: number;
    };

/**
 * What history a project keeps (REQ-STOR-055). The current node, its redo line,
 * snapshots and protected nodes are kept by every policy.
 */
export type RetentionPolicy =
  | {
      /** Everything, until the person compacts by hand: the default. */
      readonly kind: 'unlimited';
    }
  | {
      /** As much as fits in `bytes`, removing what matters least first. */
      readonly kind: 'budget';
      readonly bytes: number;
    }
  | { readonly kind: 'rules'; readonly rules: readonly [RetentionRule, ...RetentionRule[]] };

/**
 * The policy a project starts with, which favours reversibility (REQ-STOR-055).
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = { kind: 'unlimited' };

/** A label from what a person typed, trimmed, or why it cannot be one. */
export function historyLabelFrom(text: string): DomainResult<HistoryLabel> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return fail(failure('history-label.empty', FailureKind.Rejected, 'A name cannot be empty.'));
  }
  if (trimmed.length > LONGEST_HISTORY_LABEL) {
    return fail(
      failure(
        'history-label.too-long',
        FailureKind.Rejected,
        `A name is at most ${String(LONGEST_HISTORY_LABEL)} characters long.`,
        { details: { length: trimmed.length, maximum: LONGEST_HISTORY_LABEL } },
      ),
    );
  }
  if (!HISTORY_LABEL.test(trimmed)) {
    return fail(
      failure(
        'history-label.control-character',
        FailureKind.Rejected,
        'A name cannot hold a control character, such as a line break or a tab.',
      ),
    );
  }
  return succeed(unsafeBrandId<'HistoryLabel'>(trimmed));
}
