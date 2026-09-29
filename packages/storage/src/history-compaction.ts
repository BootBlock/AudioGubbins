/**
 * Compacting a kept project's history: what its retention policy lets go, how
 * many bytes that frees, and the project once a plan the person confirmed is
 * applied (REQ-STOR-055, REQ-STOR-200, REQ-STOR-106).
 *
 * The history package plans and applies a compaction as a pure function of the
 * history; what it needs of storage is the bytes each node holds alone, which
 * is its record and any state kept for it and for nothing else. A plan never
 * removes a node the open comparison stands on, since the comparison would no
 * longer name its side. A plan that moves the root needs the state at the new
 * root kept whole, since no earlier state is left to reach it from: applying it
 * makes that state, names it on the root, and gives it for the writer to keep.
 *
 * Nothing here is applied without a confirmation of the plan's reclaimable
 * bytes, as the person was shown them with the capabilities it loses.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  applyCompaction,
  planCompaction,
  withStateFingerprint,
  type CompactionContext,
  type CompactionPlan,
  type CompactionRequest,
  type HistoryNode,
} from '@audiogubbins/history';
import {
  canonicalJson,
  encodeUtf8,
  writeHistoryNodeRecord,
  type HistoryNodeId,
  type ProjectState,
  type StateFingerprint,
} from '@audiogubbins/project-format';

import { stateAt, type MoveServices } from './history-moves.js';
import type { ProjectFiles } from './project-files.js';
import type { ProjectModel } from './project-model.js';
import type { KeptState } from './session-events.js';

/** The person's confirmation of a compaction: the bytes they were shown it frees. */
export interface CompactionConfirmation {
  readonly reclaimableBytes: number;
}

/** What reaching the new root's state needs: the moves, and the naming of a state. */
export interface CompactionServices extends MoveServices {
  readonly fingerprint: (state: ProjectState) => Promise<StateFingerprint>;
}

/** A compaction applied: the project after it, and the new root's state to keep. */
export interface CompactedModel {
  readonly model: ProjectModel;
  readonly rootState?: KeptState;
}

/**
 * What planning a compaction of a kept project needs beside its history: the
 * bytes each node holds alone, the time, the nodes the open comparison stands
 * on, and the export log.
 */
async function compactionContext(
  files: ProjectFiles,
  model: Pick<ProjectModel, 'history' | 'comparison' | 'exports'>,
  now: number,
  signal?: AbortSignal,
): Promise<CompactionContext> {
  const { history, comparison } = model;
  const namings = new Map<StateFingerprint, number>();
  for (const node of history.nodes.values()) {
    if (node.stateFingerprint !== undefined) {
      namings.set(node.stateFingerprint, (namings.get(node.stateFingerprint) ?? 0) + 1);
    }
  }
  for (const snapshot of history.snapshots.values()) {
    namings.set(snapshot.stateFingerprint, (namings.get(snapshot.stateFingerprint) ?? 0) + 1);
  }
  const alone = new Map<HistoryNodeId, number>();
  for (const node of history.nodes.values()) {
    signal?.throwIfAborted();
    const state = node.stateFingerprint;
    const stateBytes =
      state !== undefined && namings.get(state) === 1
        ? ((await files.records.tree.openFile(files.states.path(state)))?.size ?? 0)
        : 0;
    alone.set(node.id, recordBytes(node) + stateBytes);
  }
  return {
    sizeOf: (node) => alone.get(node.id) ?? recordBytes(node),
    now,
    protectedNodes: comparison === undefined ? [] : [comparison.a.node, comparison.b.node],
    exports: model.exports,
  };
}

/** The bytes a node's record takes, as a checkpoint writes it. */
function recordBytes(node: HistoryNode): number {
  return encodeUtf8(canonicalJson(writeHistoryNodeRecord(node))).length;
}

/** A plan of what `request` lets go of a kept project's history. */
export async function planHistoryCompaction(
  files: ProjectFiles,
  model: Pick<ProjectModel, 'history' | 'comparison' | 'exports'>,
  request: CompactionRequest,
  now: number,
  signal?: AbortSignal,
): Promise<DomainResult<CompactionPlan>> {
  return planCompaction(model.history, request, await compactionContext(files, model, now, signal));
}

/**
 * The project with a confirmed plan applied, and the new root's state where the
 * root moves. Refused where the confirmation is of another plan, or the plan no
 * longer fits the history, which may have moved on since it was made.
 */
export async function compactedModel(
  model: ProjectModel,
  plan: CompactionPlan,
  confirmation: CompactionConfirmation,
  services: CompactionServices,
  signal?: AbortSignal,
): Promise<DomainResult<CompactedModel>> {
  if (confirmation.reclaimableBytes !== plan.reclaimableBytes) {
    return fail(
      failure(
        'storage.compaction-unconfirmed',
        FailureKind.Rejected,
        'The confirmation is of another compaction than the one given to carry out.',
      ),
    );
  }
  const { comparison } = model;
  if (
    comparison !== undefined &&
    [comparison.a.node, comparison.b.node].some((node) => plan.removable.includes(node))
  ) {
    return fail(
      failure(
        'compaction.stale-plan',
        FailureKind.Conflict,
        'The plan removes a state the open comparison stands on.',
      ),
    );
  }
  const newRoot = plan.newRoot;
  const rootState =
    newRoot === undefined ? undefined : await keptRootState(model, newRoot, services, signal);
  if (rootState?.ok === false) return rootState;
  const compacted = applyCompaction(model.history, plan);
  if (!compacted.ok) return compacted;
  if (newRoot === undefined || rootState === undefined) {
    return succeed({ model: { ...model, history: compacted.value } });
  }
  const named = withStateFingerprint(compacted.value, newRoot, rootState.value.fingerprint);
  if (!named.ok) return named;
  return succeed({ model: { ...model, history: named.value }, rootState: rootState.value });
}

/** The state at the node that becomes the root, reached before anything is removed. */
async function keptRootState(
  model: ProjectModel,
  root: HistoryNodeId,
  services: CompactionServices,
  signal?: AbortSignal,
): Promise<DomainResult<KeptState>> {
  const reached = await stateAt(model.history, model.state, root, services, signal);
  if (!reached.ok) return reached;
  return succeed({ state: reached.value, fingerprint: await services.fingerprint(reached.value) });
}
