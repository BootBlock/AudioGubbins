/**
 * A copied project's whole history as its tree holds it: the states it keeps,
 * each read only when it is asked for, the media they and its changes need,
 * and what of where its audio came from it keeps (REQ-STOR-099, REQ-STOR-166,
 * REQ-STOR-193, REQ-EXEC-216).
 *
 * Every state of a history is the state of its first node changed by the
 * changes on the way, so what its kept states refer to is what that first
 * state refers to and what the changes name, which is known before any state
 * is written. Below full provenance the history is stripped first, its changes
 * with its states, through the port the command layer gives
 * (`history-stripping.ts` in the project format), since its changes carry the
 * provenance they were made with.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';
import { historyRecordOf } from '@audiogubbins/history';
import { contentReferencedBy } from '@audiogubbins/media-store';
import {
  Turns,
  stripHistory,
  writeHistoryNodeRecord,
  type ContentId,
  type Digest,
  type ExportRecord,
  type HistoryRecord,
  type InvocationProvenance,
  type ProjectState,
  type ProjectTreeScope,
  type ProvenanceLevel,
  type TreeStates,
  type YieldToHost,
} from '@audiogubbins/project-format';

import { choiceOf } from './comparison-record.js';
import { contentIdsIn } from './content-references.js';
import { offeredStates, type ProjectCopy } from './project-copy.js';

/** What a whole history is stripped with, below full provenance. */
export interface HistoryStrippingParts {
  /**
   * Which arguments of a change hold provenance, as the command layer
   * declares, for a whole history kept at less than all of it.
   */
  readonly invocationProvenance: InvocationProvenance;
  readonly digest: Digest;

  /** Asked between the states and changes of a history as it is stripped. */
  readonly yieldToHost: YieldToHost;
}

/**
 * How much of a copy its tree holds, the state and export log it holds, and
 * the media the tree must and may carry.
 */
export interface CopiedScope {
  readonly scope: ProjectTreeScope;
  readonly state: ProjectState;
  readonly exports: readonly ExportRecord[];

  /** Referred to by the state or the states kept, so the tree is refused without it. */
  readonly required: ReadonlySet<ContentId>;

  /** Named by the history's changes, and carried where the store holds it. */
  readonly wanted: ReadonlySet<ContentId>;
}

/**
 * A copy's whole history, stripped to `provenance`, and the media its tree must
 * and may carry, besides the `required` the state refers to.
 */
export async function historyScope(
  copy: ProjectCopy,
  provenance: ProvenanceLevel,
  required: Set<ContentId>,
  services: HistoryStrippingParts,
  signal?: AbortSignal,
): Promise<DomainResult<CopiedScope>> {
  const { model } = copy;
  const states = copiedStates(copy);
  if (!states.ok) return states;
  const record = historyRecordOf(model.history);
  const first = await firstReferences(record, states.value, signal);
  if (!first.ok) return first;
  for (const each of first.value) required.add(each);
  const wanted = new Set<ContentId>();
  for (const node of record.nodes) {
    for (const each of contentIdsIn(writeHistoryNodeRecord(node))) wanted.add(each);
  }
  const history = {
    record,
    retention: model.retention,
    states: states.value,
    ...(model.comparison === undefined ? {} : { comparison: choiceOf(model.comparison) }),
  };
  const stripped = await stripHistory(
    { state: model.state, history, exports: model.exports },
    provenance,
    { ...services, turns: new Turns(services.yieldToHost, signal) },
  );
  if (!stripped.ok) return stripped;
  return succeed({
    scope: { kind: 'history', history: stripped.value.history, provenance },
    state: stripped.value.state,
    exports: stripped.value.exports,
    required,
    wanted,
  });
}

/**
 * The states a copy's history keeps, each read only when it is asked for. One
 * that cannot be read is left out, and the history reaches its node by replay
 * instead; a snapshot's must be read, since a restore point would be lost, and
 * the copy is refused at once where one is not kept at all.
 */
export function copiedStates(copy: ProjectCopy): DomainResult<TreeStates> {
  const snapshotted = new Set(
    [...copy.model.history.snapshots.values()].map((snapshot) => snapshot.stateFingerprint),
  );
  const fingerprints = offeredStates(copy);
  const offered = new Set(fingerprints);
  for (const fingerprint of snapshotted) {
    if (!offered.has(fingerprint)) {
      return fail(
        failure(
          'storage.snapshot-state-missing',
          FailureKind.IntegrityViolation,
          'A snapshot’s state is not kept, so the project cannot be copied whole.',
          { details: { state: fingerprint } },
        ),
      );
    }
  }
  return succeed({
    fingerprints,
    load: async (fingerprint, signal) => {
      const state = await copy.states.load(fingerprint, signal);
      return state.ok || snapshotted.has(fingerprint) ? state : succeed(undefined);
    },
  });
}

/**
 * What the state the history begins from refers to, which with what its changes
 * name is what every state it keeps refers to; where that state is not kept or
 * cannot be read, what every kept state that can be read refers to, each read
 * in turn.
 */
async function firstReferences(
  record: HistoryRecord,
  states: TreeStates,
  signal?: AbortSignal,
): Promise<DomainResult<ReadonlySet<ContentId>>> {
  const root = record.nodes.find((node) => node.kind === 'origin' || node.parent === undefined);
  const first = root?.stateFingerprint;
  if (first !== undefined && states.fingerprints.includes(first)) {
    const state = await states.load(first, signal);
    if (!state.ok) return state;
    if (state.value !== undefined) return succeed(new Set(contentReferencedBy(state.value)));
  }
  return await everyReference(states, signal);
}

/** What every kept state that can be read refers to, each read in turn. */
async function everyReference(
  states: TreeStates,
  signal?: AbortSignal,
): Promise<DomainResult<ReadonlySet<ContentId>>> {
  const referred = new Set<ContentId>();
  for (const fingerprint of states.fingerprints) {
    const state = await states.load(fingerprint, signal);
    if (!state.ok) return state;
    for (const each of state.value === undefined ? [] : contentReferencedBy(state.value)) {
      referred.add(each);
    }
  }
  return succeed(referred);
}
