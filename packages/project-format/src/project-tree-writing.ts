/**
 * A project as the files of its unpacked tree: the Git-friendly form, and the
 * content of a portable bundle (REQ-STOR-103, REQ-STOR-099, REQ-STOR-166).
 *
 * Every file is the pretty canonical JSON of one part of the project, cut from
 * the very values its documents are written as, so a part is written one way
 * wherever it is kept, and the same project always gives the same files, byte
 * for byte, in the same order. Media and caches are named, never inlined: the
 * caller streams their bytes from wherever it keeps them. The provenance level
 * of a tree of the state alone is applied here, so what the header says the
 * tree keeps is what it keeps. A whole history is given at its level already
 * (`history-stripping.ts`), since stripping one reads the states it keeps and
 * takes the command layer's word on which arguments of a change hold
 * provenance; the reader holds both to the level the header says.
 *
 * A history may keep more states, and hold more nodes, than fit in memory as
 * text at once (REQ-EXEC-216), so a text file's bytes are made only when its
 * writer asks for them, and a kept state is read only then: whatever writes the
 * tree holds one file's text, and one kept state, at a time.
 */

import { mapResult, type DomainResult, type ProjectId } from '@audiogubbins/domain';

import { compareCodeUnits, isJsonArray, isJsonObject, memberOf } from './canonical-json.js';
import type { JsonObject, JsonValue } from './canonical-json.js';
import type { ContentId, StateFingerprint } from './content-identity.js';
import type { ExportRecord } from './export-provenance.js';
import { writeExportRecord } from './export-record-json.js';
import { writeBranchNames, writePreferences } from './history-json.js';
import { writeHistoryNodeRecord } from './history-node-json.js';
import type { HistoryRecord, RetentionPolicy } from './history-record.js';
import { writeProjectDocument } from './project-json.js';
import type { ProjectState } from './project-state.js';
import { writeTreeHeader } from './project-tree-header.js';
import {
  BACKUP_POLICY_PATH,
  BRANCH_NAMES_PATH,
  CACHE_INDEX_PATH,
  COMPARISON_PATH,
  CURSOR_PATH,
  ENTITY_DIRECTORIES,
  RETENTION_PATH,
  SETTINGS_PATH,
  TRACK_ORDER_PATH,
  TREE_HEADER_PATH,
  cachePath,
  entityPath,
  exportPath,
  mediaPath,
  nodePath,
  snapshotPath,
  sourcePath,
  statePath,
} from './project-tree-layout.js';
import { TreeFiles, type ProjectTreeFile } from './project-tree-texts.js';
import {
  stripAssetProvenance,
  stripExportRecords,
  type ProvenanceLevel,
} from './provenance-stripping.js';
import { writeRetentionPolicy } from './retention-json.js';
import { writeBackupPolicy, type BackupPolicy } from './backup-policy-json.js';
import { writeCacheIndex, type TreeCache } from './cache-index-json.js';
import { writeComparisonChoice, type ComparisonChoiceRecord } from './comparison-choice-json.js';
import { writeSnapshotRecord } from './snapshot-json.js';

/** A piece of managed media a tree carries. */
export interface TreeMedia {
  readonly contentId: ContentId;
  readonly byteLength: number;
}

/**
 * The states a history keeps whole, each read only when it is wanted, so no
 * more of them is held at once than whatever reads them holds.
 */
export interface TreeStates {
  /** The fingerprint of each state kept, once. */
  readonly fingerprints: readonly StateFingerprint[];

  /**
   * The state of one of them, read and checked; `undefined` where it cannot be
   * read and the history reaches it by replay instead, so a copy leaves it out.
   */
  load(
    fingerprint: StateFingerprint,
    signal?: AbortSignal,
  ): Promise<DomainResult<ProjectState | undefined>>;
}

/** A project's history as a tree carries it, with the states it keeps whole. */
export interface ProjectTreeHistory {
  readonly record: HistoryRecord;
  readonly retention: RetentionPolicy;

  /** The states kept whole: at least every snapshot's. */
  readonly states: TreeStates;

  /** The A/B comparison open between two of its states, where one is (REQ-STOR-195). */
  readonly comparison?: ComparisonChoiceRecord;
}

/**
 * How much of a project a tree holds, the history or the state alone, and the
 * provenance level it keeps: a history's content is at that level already.
 */
export type ProjectTreeScope =
  | {
      readonly kind: 'history';
      readonly history: ProjectTreeHistory;
      readonly provenance: ProvenanceLevel;
    }
  | { readonly kind: 'state'; readonly provenance: ProvenanceLevel };

/** Everything a project's tree holds. */
export interface ProjectTreeContent {
  /** The state the project is in, which names the project. */
  readonly state: ProjectState;
  readonly scope: ProjectTreeScope;

  /** The export log, oldest first. */
  readonly exports: readonly ExportRecord[];

  /** The project's backup policy, which is the project's as its settings are. */
  readonly backup: BackupPolicy;
  readonly media: readonly TreeMedia[];

  /** The caches, where the tree holds them. */
  readonly caches?: readonly TreeCache[];
}

/**
 * The files of a project's tree, sorted by path, each text made when it is
 * asked for. Throws where the history is of another project than the state, or
 * two parts would share a path: the caller built the content wrongly.
 */
export function projectTree(content: ProjectTreeContent): readonly ProjectTreeFile[] {
  const files = new TreeFiles();
  const { scope } = content;
  const { provenance } = scope;
  const state =
    scope.kind === 'state' ? stripAssetProvenance(content.state, provenance) : content.state;

  files.text(TREE_HEADER_PATH, () =>
    writeTreeHeader({
      project: state.project.id,
      displayName: state.project.displayName,
      history: scope.kind === 'history',
      caches: content.caches !== undefined,
      provenance,
    }),
  );
  addProject(files, state);
  files.text(BACKUP_POLICY_PATH, () => writeBackupPolicy(content.backup));
  if (scope.kind === 'history') addHistory(files, state.project.id, scope.history);
  for (const record of stripExportRecords(content.exports, provenance)) {
    files.text(exportPath(record.id), () => writeExportRecord(record));
  }
  for (const { contentId, byteLength } of content.media) {
    files.add(mediaPath(contentId), { kind: 'media', contentId, byteLength });
  }
  if (content.caches !== undefined) {
    const caches = [...content.caches].sort((one, other) => compareCodeUnits(one.path, other.path));
    files.text(CACHE_INDEX_PATH, () => writeCacheIndex(caches));
    for (const { path, byteLength, contentId } of caches) {
      files.add(cachePath(path), { kind: 'cache', path, byteLength, contentId });
    }
  }
  return files.sorted();
}

/** The project's files: its settings, track order, entities and sources. */
function addProject(files: TreeFiles, state: ProjectState): void {
  const document = writeProjectDocument(state);
  const project = objectIn(document, 'project');
  files.text(SETTINGS_PATH, () => valueIn(project, 'settings'));
  files.text(TRACK_ORDER_PATH, () => valueIn(project, 'trackOrder'));
  for (const list of ENTITY_DIRECTORIES.keys()) {
    for (const entity of objectsIn(project, list)) {
      files.text(entityPath(list, textIn(entity, 'id')), () => entity);
    }
  }
  for (const source of objectsIn(document, 'sources')) {
    files.text(sourcePath(textIn(source, 'assetId')), () => source);
  }
}

/**
 * The history's files: its position, names, retention, nodes, snapshots and
 * the states it keeps, each node's and state's text made when it is asked for.
 */
function addHistory(files: TreeFiles, project: ProjectId, history: ProjectTreeHistory): void {
  const { record } = history;
  if (record.project !== project) {
    throw new Error('A project tree holds the history of its own project only.');
  }
  files.text(CURSOR_PATH, () => ({
    cursor: record.cursor,
    preferred: writePreferences(record.preferred),
  }));
  files.text(BRANCH_NAMES_PATH, () => writeBranchNames(record.branchNames));
  files.text(RETENTION_PATH, () => writeRetentionPolicy(history.retention));
  const { comparison } = history;
  if (comparison !== undefined) {
    files.text(COMPARISON_PATH, () => writeComparisonChoice(comparison));
  }
  for (const node of record.nodes)
    files.text(nodePath(node.id), () => writeHistoryNodeRecord(node));
  for (const snapshot of record.snapshots) {
    files.text(snapshotPath(snapshot.id), () => writeSnapshotRecord(snapshot));
  }
  const { states } = history;
  for (const fingerprint of states.fingerprints) {
    files.read(statePath(fingerprint), async (signal) =>
      mapResult(await states.load(fingerprint, signal), (state) =>
        state === undefined ? undefined : writeProjectDocument(state),
      ),
    );
  }
}

/**
 * A member of a value this package's own writers made, whose shape is known: a
 * member missing or of another kind is a defect here, not a problem with
 * anyone's data, so it throws, as the three below do.
 */
function valueIn(object: JsonObject, key: string): JsonValue {
  const value = memberOf(object, key);
  if (value === undefined) throw new Error(`A written project value has no ${key}.`);
  return value;
}

function objectIn(object: JsonObject, key: string): JsonObject {
  const value = valueIn(object, key);
  if (!isJsonObject(value)) throw new Error(`A written project value's ${key} is no object.`);
  return value;
}

function objectsIn(object: JsonObject, key: string): readonly JsonObject[] {
  const list = valueIn(object, key);
  if (!isJsonArray(list)) throw new Error(`A written project value's ${key} is no list.`);
  return list.map((item) => {
    if (!isJsonObject(item)) throw new Error(`A written project value's ${key} holds no object.`);
    return item;
  });
}

function textIn(object: JsonObject, key: string): string {
  const value = valueIn(object, key);
  if (typeof value !== 'string') throw new Error(`A written project value's ${key} is no text.`);
  return value;
}
