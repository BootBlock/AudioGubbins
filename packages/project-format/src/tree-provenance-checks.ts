/**
 * Holding a tree to the provenance level its header says it keeps
 * (REQ-STOR-166, REQ-STOR-052).
 *
 * Below full, every part of a tree that holds provenance must be at the level
 * already, and is refused where it keeps more. It is checked, never stripped
 * again: what is read is what was written, so a tree read and written again is
 * the tree it was, and a history's states still name the fingerprints its
 * nodes name. A part is at a level exactly where stripping it to the level
 * gives it back unchanged (`provenance-stripping.ts`). The state alone is held
 * to the level as the state alone is stripped. A whole history's state, each
 * state it keeps and each change it records are held to it as a history is
 * stripped, with placeholders that keep only what is a placeholder already, so
 * a name, handle or path that is not one is refused, and a change's arguments
 * are found through the command layer's port. The export log, and every
 * snapshot's list of exports, are held to it as the log is stripped.
 */

import type { ExportRecord } from './export-provenance.js';
import type { HistoryRecord, InvocationRecord } from './history-record.js';
import type { InvocationProvenance } from './invocation-provenance.js';
import type { ProjectState } from './project-state.js';
import { atFile, type TreeReading } from './project-tree-files.js';
import type { TreeHeader } from './project-tree-header.js';
import { exportPath, nodePath, snapshotPath, sourcePath } from './project-tree-layout.js';
import { KEEP_PLACEHOLDERS } from './provenance-placeholders.js';
import {
  ProvenanceLevel,
  historyStripping,
  rewriteSources,
  stateStripping,
  stripExportRecords,
  type SourceRewrite,
} from './provenance-stripping.js';

/** What a tree's parts are held to: the level its header says, and how it is checked. */
export class ProvenanceCheck {
  readonly #level: ProvenanceLevel;
  readonly #rewrite: SourceRewrite;
  readonly #invocations: InvocationProvenance;

  constructor(header: TreeHeader, invocations: InvocationProvenance) {
    this.#level = header.provenance;
    this.#rewrite = header.history
      ? historyStripping(header.provenance, KEEP_PLACEHOLDERS)
      : stateStripping(header.provenance);
    this.#invocations = invocations;
  }

  /** Whether a state keeps no more than the level. */
  holdsState(state: ProjectState): boolean {
    return rewriteSources(state, this.#rewrite) === state;
  }

  /** Refuses each source of the state that keeps more than the level, at its file. */
  checkState(tree: TreeReading, state: ProjectState): void {
    for (const [assetId, source] of state.sources) {
      if (this.#rewrite.source(source) !== source) {
        tree.refuse('tree.provenance-kept', sourcePath(assetId));
      }
    }
  }

  /** Refuses each export record that keeps more than the level, at its file. */
  checkExports(tree: TreeReading, records: readonly ExportRecord[]): void {
    const stripped = new Set(stripExportRecords(records, this.#level));
    for (const record of records) {
      if (!stripped.has(record)) tree.refuse('tree.provenance-kept', exportPath(record.id));
    }
  }

  /**
   * Refuses each change of the history whose invocations keep more than the
   * level, and each snapshot naming an export where the level keeps none.
   */
  checkHistory(tree: TreeReading, record: HistoryRecord): void {
    if (this.#level === ProvenanceLevel.Full) return;
    for (const node of record.nodes) {
      if (node.kind === 'change') {
        this.#checkInvocations(tree, nodePath(node.id), [...node.forward, ...node.inverse]);
      }
    }
    if (this.#level !== ProvenanceLevel.None) return;
    for (const snapshot of record.snapshots) {
      if (snapshot.exports.length > 0) {
        tree.refuse('tree.provenance-kept', snapshotPath(snapshot.id));
      }
    }
  }

  #checkInvocations(
    tree: TreeReading,
    path: string,
    invocations: readonly InvocationRecord[],
  ): void {
    for (const invocation of invocations) {
      const checked = this.#invocations(invocation, this.#rewrite);
      if (!checked.ok) {
        tree.problems.push(...checked.failures.map((cause) => atFile(cause, path)));
        return;
      }
      if (checked.value !== invocation) {
        tree.refuse('tree.provenance-kept', path);
        return;
      }
    }
  }
}
