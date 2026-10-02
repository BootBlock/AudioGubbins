/**
 * What each segment a checkpoint names holds, and the plan of which segments
 * the next checkpoint keeps and which nodes it writes anew (ADR-0020,
 * REQ-STOR-101).
 *
 * Planning scans the history once, as finding its retained states already does.
 * A segment is kept while every node it was written with is in the history with
 * the parent it was written with, and with no fingerprint but the one it was
 * written with, where it was written with one. Compaction, which removes nodes
 * and takes the parent from the new root, is the only change that breaks a
 * segment, so it needs no knowledge of segments. The nodes of a segment not
 * kept that the history still holds, and every node in no segment, are written
 * in new segments, cut at {@link SEGMENT_LENGTH}, the new nodes in the order
 * they were made: neighbouring changes then share a segment, so compacting the
 * oldest touches few. A fingerprint a node learned after its segment was
 * written is carried by the checkpoint instead.
 *
 * The newest segment is written again with the new nodes wherever the two fit
 * in one segment, so every pair of neighbouring segments holds more than one
 * segment's length: a project's segments number at most two for each such
 * length of its history, however often it checkpoints, and a checkpoint writes
 * at most that length again beyond what changed.
 */

import type { History, HistoryNode } from '@audiogubbins/history';
import {
  compareCodeUnits,
  type HistoryNodeId,
  type HistoryNodeRecord,
  type HistorySegmentReference,
  type StateFingerprint,
  type Turns,
} from '@audiogubbins/project-format';

/** The text a segment is filled to, in UTF-16 code units: 1 MiB. */
export const SEGMENT_LENGTH = 1_048_576;

/** A segment a checkpoint names, and the nodes it holds. */
export interface LedgerSegment {
  readonly reference: HistorySegmentReference;
  readonly nodes: readonly HistoryNodeId[];

  /** The length of the segment's text, where it is known. */
  readonly length: number | undefined;
}

/** A segment as it was read or written: its nodes as they are in it. */
export interface HeldSegment {
  readonly reference: HistorySegmentReference;
  readonly nodes: readonly HistoryNodeRecord[];
  readonly length: number | undefined;
}

/** What the next checkpoint keeps and writes. */
export interface SegmentPlan {
  /** The segments it names that are written already, in order. */
  readonly kept: readonly LedgerSegment[];

  /** Each segment to write, in order, named after the kept ones. */
  readonly fresh: readonly FreshSegment[];

  /** The fingerprints of nodes whose kept segment lacks the one they have. */
  readonly fingerprints: ReadonlyMap<HistoryNodeId, StateFingerprint>;
}

/** A segment to write: its nodes, and the length of their text. */
export interface FreshSegment {
  readonly nodes: readonly HistoryNode[];
  readonly length: number;
}

/** What a node was written with, and the segment holding it. */
interface Placed {
  readonly segment: LedgerSegment;
  readonly parent: HistoryNodeId | undefined;
  readonly fingerprint: StateFingerprint | undefined;
}

/** A node and the length of its text. */
interface Measured {
  readonly node: HistoryNode;
  readonly length: number;
}

/**
 * The segments the newest confirmed checkpoint names. Changed only by
 * {@link SegmentLedger.commit}, once a checkpoint naming new segments is
 * confirmed, so a checkpoint that fails leaves it as it was.
 */
export class SegmentLedger {
  private segments: readonly LedgerSegment[] = [];
  private readonly placed = new Map<HistoryNodeId, Placed>();

  /** A ledger of the segments as read or written. */
  constructor(held: readonly HeldSegment[] = []) {
    this.commit({ kept: [], fresh: [], fingerprints: new Map() }, held);
  }

  /** The segments, in order. */
  get named(): readonly LedgerSegment[] {
    return this.segments;
  }

  /**
   * The plan of the next checkpoint of `history` (see the module comment).
   * `measure` gives the length of a node's text. Every node is looked at and
   * many measured, so each takes a step of `turns`.
   */
  async plan(
    history: History,
    measure: (node: HistoryNode) => number,
    turns: Turns,
  ): Promise<SegmentPlan> {
    const { dirty, fresh, learned } = await this.#placing(history, turns);
    // Every node is either fresh or placed, so fewer placed than the ledger
    // holds means some were removed, and only then is each segment looked at.
    if (history.nodes.size - fresh.length < this.placed.size) {
      for (const segment of this.segments) {
        if (segment.nodes.some((id) => !history.nodes.has(id))) dirty.add(segment);
      }
    }
    fresh.sort((left, right) => left.at - right.at || compareCodeUnits(left.id, right.id));
    const survivors = [...dirty].flatMap((segment) => nodesOf(history, segment.nodes));
    let kept = this.segments.filter((segment) => !dirty.has(segment));
    let written = await measuredNodes([...survivors, ...fresh], measure, turns);
    const newest = kept.at(-1);
    const length = written.reduce((sum, item) => sum + item.length, 0);
    let start = 0;
    if (
      written.length > 0 &&
      newest?.length !== undefined &&
      newest.length + length <= SEGMENT_LENGTH
    ) {
      // The newest segment's nodes are taken at its length, not measured again.
      kept = kept.slice(0, -1);
      start = newest.length;
      const merged = nodesOf(history, newest.nodes).map((node) => ({ node, length: 0 }));
      written = [...merged, ...written];
    }
    const named = new Set(kept);
    return {
      kept,
      fresh: cut(written, start),
      fingerprints: new Map(
        learned
          .filter(([, , segment]) => named.has(segment))
          .map(([node, fingerprint]) => [node, fingerprint]),
      ),
    };
  }

  /**
   * Where each node of `history` stands against the ledger: placed as it was
   * written, in no segment yet, or changed since, which dirties its segment;
   * and the fingerprints learned of nodes placed as they were.
   */
  async #placing(history: History, turns: Turns) {
    const dirty = new Set<LedgerSegment>();
    const fresh: HistoryNode[] = [];
    const learned: [HistoryNodeId, StateFingerprint, LedgerSegment][] = [];
    for (const node of history.nodes.values()) {
      await turns.afterStep();
      const placed = this.placed.get(node.id);
      if (placed === undefined) {
        fresh.push(node);
      } else if (!isAsWritten(node, placed)) {
        dirty.add(placed.segment);
      } else if (node.stateFingerprint !== undefined && placed.fingerprint === undefined) {
        learned.push([node.id, node.stateFingerprint, placed.segment]);
      }
    }
    return { dirty, fresh, learned };
  }

  /**
   * Takes the segments a confirmed checkpoint names: those its plan kept, then
   * those it wrote, as written.
   */
  commit(plan: SegmentPlan, written: readonly HeldSegment[]): void {
    const kept = new Set(plan.kept);
    for (const segment of this.segments) {
      if (kept.has(segment)) continue;
      for (const id of segment.nodes) {
        if (this.placed.get(id)?.segment === segment) this.placed.delete(id);
      }
    }
    const added = written.map((held) => {
      const segment: LedgerSegment = {
        reference: held.reference,
        nodes: held.nodes.map((node) => node.id),
        length: held.length,
      };
      for (const node of held.nodes) {
        this.placed.set(node.id, {
          segment,
          parent: parentOf(node),
          fingerprint: node.stateFingerprint,
        });
      }
      return segment;
    });
    this.segments = [...plan.kept, ...added];
  }
}

function parentOf(node: HistoryNodeRecord): HistoryNodeId | undefined {
  return node.kind === 'change' ? node.parent : undefined;
}

/** Whether a node is as its segment holds it. */
function isAsWritten(node: HistoryNode, placed: Placed): boolean {
  return (
    parentOf(node) === placed.parent &&
    (placed.fingerprint === undefined || placed.fingerprint === node.stateFingerprint)
  );
}

/** The nodes of `ids` the history still holds. */
function nodesOf(history: History, ids: readonly HistoryNodeId[]): HistoryNode[] {
  return ids.flatMap((id) => {
    const node = history.nodes.get(id);
    return node === undefined ? [] : [node];
  });
}

/** Each node with the length of its text, a step of `turns` each. */
async function measuredNodes(
  nodes: readonly HistoryNode[],
  measure: (node: HistoryNode) => number,
  turns: Turns,
): Promise<Measured[]> {
  const measured: Measured[] = [];
  for (const node of nodes) {
    await turns.afterStep();
    measured.push({ node, length: measure(node) });
  }
  return measured;
}

/**
 * The nodes cut into segments of at most {@link SEGMENT_LENGTH}, save a node
 * longer than that alone. The first segment starts `start` long, for the nodes
 * of a segment merged into it, which are given no length of their own.
 */

function cut(measured: readonly Measured[], start: number): FreshSegment[] {
  const segments: FreshSegment[] = [];
  let nodes: HistoryNode[] = [];
  let length = start;
  for (const item of measured) {
    if (nodes.length > 0 && length + item.length > SEGMENT_LENGTH) {
      segments.push({ nodes, length });
      nodes = [];
      length = 0;
    }
    nodes.push(item.node);
    length += item.length;
  }
  if (nodes.length > 0) segments.push({ nodes, length });
  return segments;
}
