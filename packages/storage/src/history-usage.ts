/**
 * What one project's history takes up and keeps, by the part of the history
 * that takes or keeps it, for usage by category (REQ-STOR-200).
 *
 * A history's nodes are written in segments shared by every branch, so the
 * bytes of each segment are split between the line the project is on and the
 * other branches by the length of the text of the nodes it holds of each. And
 * media no project's state holds is kept by the history in one of three ways
 * the person decides about apart, named by the history package's
 * `contentRetention`: by a snapshot, by the line the project is on, which undo
 * reaches, or only by another branch. What a node keeps is the media its
 * invocations name, and the media of the state it or a snapshot of it keeps
 * whole; the media of a state between kept ones is kept by the node whose kept
 * state or invocation brought it in, earlier on the same line.
 */

import { activeLine, contentRetention, type HistoryNode } from '@audiogubbins/history';
import { contentReferencedBy } from '@audiogubbins/media-store';
import {
  canonicalJson,
  writeHistoryNodeRecord,
  type ContentId,
  type HistoryNodeId,
  type StateFingerprint,
  type Turns,
} from '@audiogubbins/project-format';

import type { StoredCheckpoint } from './checkpoint-files.js';
import { contentIdsIn } from './content-references.js';
import type { UnreadableRoot } from './media-roots.js';
import type { ProjectFiles } from './project-files.js';

/** The part of a history keeping a piece of media, the first a person would keep. */
export type RetainedBy = 'namedSnapshots' | 'undo' | 'alternativeBranches';

/** The order the parts are kept in: a snapshot first, another branch last. */
const STRENGTH: Readonly<Record<RetainedBy, number>> = {
  namedSnapshots: 2,
  undo: 1,
  alternativeBranches: 0,
};

/** What one history takes up off the line the project is on, and what it keeps. */
export interface HistoryUsage {
  /** The bytes of the history's segments that hold the nodes of other branches. */
  readonly branchBytes: number;

  /** The part of the history keeping each piece of media it keeps. */
  readonly retainedBy: ReadonlyMap<ContentId, RetainedBy>;
}

/** A node as it is written: the length of its text and the media it names. */
interface Written {
  readonly length: number;
  readonly names: readonly ContentId[];
}

/** Measures the history `checkpoint` holds (see the module comment). */
export async function historyUsage(
  files: ProjectFiles,
  checkpoint: StoredCheckpoint,
  turns: Turns,
  unreadable: UnreadableRoot[],
): Promise<HistoryUsage> {
  const { history } = checkpoint;
  const written = new Map<HistoryNodeId, Written>();
  for (const node of history.nodes.values()) {
    await turns.afterStep();
    const record = writeHistoryNodeRecord(node);
    written.set(node.id, {
      length: canonicalJson(record).length,
      names: [...contentIdsIn(record)],
    });
  }
  const line = new Set(activeLine(history).map(({ id }) => id));
  const branchBytes = await segmentBytesOffLine(files, checkpoint, written, line);

  const keptAt = new Map<HistoryNodeId, StateFingerprint[]>();
  const keep = (node: HistoryNodeId, state: StateFingerprint): void => {
    keptAt.set(node, [...(keptAt.get(node) ?? []), state]);
  };
  for (const node of history.nodes.values()) {
    if (node.stateFingerprint !== undefined) keep(node.id, node.stateFingerprint);
  }
  for (const snapshot of history.snapshots.values()) keep(snapshot.node, snapshot.stateFingerprint);
  const states = await stateMedia(files, [...keptAt.values()].flat(), turns, unreadable);

  const contentOf = (node: HistoryNode): Iterable<ContentId> => [
    ...(written.get(node.id)?.names ?? []),
    ...(keptAt.get(node.id) ?? []).flatMap((state) => states.get(state) ?? []),
  ];
  const retainedBy = new Map<ContentId, RetainedBy>();
  for (const [content, retention] of contentRetention(history, contentOf)) {
    retainedBy.set(
      content,
      retention.snapshots.length > 0
        ? 'namedSnapshots'
        : retention.onActiveLine
          ? 'undo'
          : 'alternativeBranches',
    );
  }
  return { branchBytes, retainedBy };
}

/** The bytes of each segment, split by the text of the nodes it holds off the line. */
async function segmentBytesOffLine(
  files: ProjectFiles,
  checkpoint: StoredCheckpoint,
  written: ReadonlyMap<HistoryNodeId, Written>,
  line: ReadonlySet<HistoryNodeId>,
): Promise<number> {
  let bytes = 0;
  for (const segment of checkpoint.segments.named) {
    let all = 0;
    let off = 0;
    for (const node of segment.nodes) {
      const length = written.get(node)?.length ?? 0;
      all += length;
      if (!line.has(node)) off += length;
    }
    if (off === 0) continue;
    const size = (await files.records.tree.openFile(files.paths.segment(segment.reference)))?.size;
    bytes += Math.round(((size ?? 0) * off) / all);
  }
  return bytes;
}

/** The media each kept state holds, each state read once. */
async function stateMedia(
  files: ProjectFiles,
  kept: readonly StateFingerprint[],
  turns: Turns,
  unreadable: UnreadableRoot[],
): Promise<ReadonlyMap<StateFingerprint, readonly ContentId[]>> {
  const media = new Map<StateFingerprint, readonly ContentId[]>();
  for (const fingerprint of new Set(kept)) {
    await turns.afterStep();
    const state = await files.states.get(fingerprint, turns.signal);
    if (state.ok) media.set(fingerprint, [...contentReferencedBy(state.value)]);
    else unreadable.push({ path: files.states.path(fingerprint), failure: state.failures[0] });
  }
  return media;
}

/** The stronger of two parts keeping one piece of media, as two projects may both keep it. */
export function strongerOf(one: RetainedBy | undefined, other: RetainedBy): RetainedBy {
  return one !== undefined && STRENGTH[one] >= STRENGTH[other] ? one : other;
}
