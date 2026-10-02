/**
 * A whole history stripped to a provenance level, for a tree: its state, the
 * states it keeps, the changes it records and its export log (REQ-STOR-166,
 * REQ-STOR-193, REQ-EXEC-216).
 *
 * Undo and redo replay a history's changes, so stripping the states alone would
 * leave them restoring what was stripped. The changes are rewritten too,
 * through the port the command layer builds from what each command declares of
 * its arguments (`invocation-provenance.ts`), and every state and change of one
 * history is stripped with one set of placeholders, so each name, handle and
 * path stands for the same file throughout and the stripped changes replay to
 * the stripped states (`provenance-placeholders.ts`).
 *
 * A stripped state is another state, with another fingerprint, which the
 * history's nodes and snapshots name and which a tree writes them under before
 * the states themselves. So the states it keeps are each read once here to
 * learn it, one at a time and let go before the next, and read again only as
 * the tree is written: a history may keep more states than fit in memory. A
 * node names the new fingerprint where its state is kept, and none where it is
 * not, which only means a move to it replays; a snapshot's state is always
 * kept. Where the level keeps no export record, no snapshot names one. An
 * export record's fingerprint is of the state that was exported, as it was.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';

import type { Digest } from './byte-ports.js';
import type { StateFingerprint } from './content-identity.js';
import type { ExportRecord } from './export-provenance.js';
import type { HistoryNodeRecord, HistoryRecord, InvocationRecord } from './history-record.js';
import type { InvocationProvenance } from './invocation-provenance.js';
import { stateFingerprintOf } from './project-json.js';
import type { ProjectState } from './project-state.js';
import type { ProjectTreeHistory, TreeStates } from './project-tree-writing.js';
import { placeholderNames } from './provenance-placeholders.js';
import {
  ProvenanceLevel,
  historyStripping,
  rewriteSources,
  stripExportRecords,
  type SourceRewrite,
} from './provenance-stripping.js';
import type { Turns } from './work-turns.js';

/** The parts of a whole history's tree that hold provenance. */
export interface HistoryProvenanceParts {
  readonly state: ProjectState;
  readonly history: ProjectTreeHistory;
  readonly exports: readonly ExportRecord[];
}

/** What stripping a history works with. */
export interface HistoryStrippingServices {
  readonly invocationProvenance: InvocationProvenance;
  readonly digest: Digest;

  /** Taken between states and changes, and given up by their signal. */
  readonly turns: Turns;
}

/** The parts stripped to `level` (see the module comment). */
export async function stripHistory(
  parts: HistoryProvenanceParts,
  level: ProvenanceLevel,
  services: HistoryStrippingServices,
): Promise<DomainResult<HistoryProvenanceParts>> {
  if (level === ProvenanceLevel.Full) return succeed(parts);
  const rewrite = historyStripping(level, placeholderNames());
  const { history } = parts;
  const state = rewriteSources(parts.state, rewrite);
  const learnt = await learntFingerprints(history.states, rewrite, services);
  if (!learnt.ok) return learnt;
  const renamed = new Map(learnt.value);
  const cursor = history.record.nodes.find((node) => node.id === history.record.cursor);
  if (cursor?.stateFingerprint !== undefined) {
    renamed.set(cursor.stateFingerprint, await stateFingerprintOf(state, services.digest));
  }
  const nodes = await strippedNodes(history.record.nodes, rewrite, services);
  if (!nodes.ok) return nodes;
  const record = withStateFingerprints({ ...history.record, nodes: nodes.value }, renamed);
  return succeed({
    state,
    history: {
      ...history,
      record: level === ProvenanceLevel.None ? withoutExports(record) : record,
      states: strippedStates(history.states, learnt.value, rewrite),
    },
    exports: stripExportRecords(parts.exports, level),
  });
}

/**
 * The fingerprint each kept state that can be read has once stripped, by the
 * one it had, each read and let go before the next is read.
 */
async function learntFingerprints(
  states: TreeStates,
  rewrite: SourceRewrite,
  { digest, turns }: HistoryStrippingServices,
): Promise<DomainResult<ReadonlyMap<StateFingerprint, StateFingerprint>>> {
  const learnt = new Map<StateFingerprint, StateFingerprint>();
  for (const fingerprint of states.fingerprints) {
    await turns.afterHeavyStep();
    const state = await states.load(fingerprint, turns.signal);
    if (!state.ok) return state;
    if (state.value === undefined) continue;
    learnt.set(fingerprint, await stateFingerprintOf(rewriteSources(state.value, rewrite), digest));
  }
  return succeed(learnt);
}

/** Every node with the provenance its changes hold rewritten. */
async function strippedNodes(
  nodes: readonly HistoryNodeRecord[],
  rewrite: SourceRewrite,
  { invocationProvenance, turns }: HistoryStrippingServices,
): Promise<DomainResult<readonly HistoryNodeRecord[]>> {
  const stripped: HistoryNodeRecord[] = [];
  const strip = (invocation: InvocationRecord) => invocationProvenance(invocation, rewrite);
  for (const node of nodes) {
    await turns.afterStep();
    if (node.kind === 'origin') {
      stripped.push(node);
      continue;
    }
    const forward = everyOf(node.forward, strip);
    if (!forward.ok) return forward;
    const inverse = everyOf(node.inverse, strip);
    if (!inverse.ok) return inverse;
    stripped.push({ ...node, forward: forward.value, inverse: inverse.value });
  }
  return succeed(stripped);
}

/** Each invocation of a non-empty list rewritten, or the first reason one cannot be. */
function everyOf(
  invocations: readonly [InvocationRecord, ...InvocationRecord[]],
  strip: (invocation: InvocationRecord) => DomainResult<InvocationRecord>,
): DomainResult<readonly [InvocationRecord, ...InvocationRecord[]]> {
  const [first, ...rest] = invocations;
  const head = strip(first);
  if (!head.ok) return head;
  const tail: InvocationRecord[] = [];
  for (const invocation of rest) {
    const each = strip(invocation);
    if (!each.ok) return each;
    tail.push(each.value);
  }
  return succeed([head.value, ...tail]);
}

/**
 * The record with each node's and snapshot's fingerprint carried over by
 * `renamed`, and a node's left out where its state is not among them, which
 * only means a move to it replays. A snapshot's state is kept, so it is among
 * them wherever the states it was renamed from are all of those kept.
 */
export function withStateFingerprints(
  record: HistoryRecord,
  renamed: ReadonlyMap<StateFingerprint, StateFingerprint>,
): HistoryRecord {
  return {
    ...record,
    nodes: record.nodes.map((node) => {
      const { stateFingerprint, ...rest } = node;
      const carried = stateFingerprint === undefined ? undefined : renamed.get(stateFingerprint);
      return carried === undefined ? rest : { ...rest, stateFingerprint: carried };
    }),
    snapshots: record.snapshots.map((snapshot) => ({
      ...snapshot,
      stateFingerprint: renamed.get(snapshot.stateFingerprint) ?? snapshot.stateFingerprint,
    })),
  };
}

/** The record with no snapshot naming an export, where the level keeps none. */
function withoutExports(record: HistoryRecord): HistoryRecord {
  return {
    ...record,
    snapshots: record.snapshots.map((snapshot) =>
      snapshot.exports.length === 0 ? snapshot : { ...snapshot, exports: [] },
    ),
  };
}

/**
 * The kept states as stripped, listed by the fingerprints learnt, each read
 * and stripped again only when it is asked for. Two states that differ only in
 * what stripping leaves out are one state stripped, kept once.
 */
function strippedStates(
  states: TreeStates,
  learnt: ReadonlyMap<StateFingerprint, StateFingerprint>,
  rewrite: SourceRewrite,
): TreeStates {
  const from = new Map<StateFingerprint, StateFingerprint>();
  for (const [original, stripped] of learnt) if (!from.has(stripped)) from.set(stripped, original);
  return {
    fingerprints: [...from.keys()],
    load: async (fingerprint, signal) => {
      const original = from.get(fingerprint);
      if (original === undefined) throw new Error(`No kept state is ${fingerprint} stripped.`);
      const state = await states.load(original, signal);
      return state.ok && state.value !== undefined
        ? succeed(rewriteSources(state.value, rewrite))
        : state;
    },
  };
}
