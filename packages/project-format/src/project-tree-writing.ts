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
 * tree keeps is what it keeps.
 */

import {
  fail,
  succeed,
  type DomainFailure,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';

import {
  compareCodeUnits,
  isJsonArray,
  isJsonObject,
  memberOf,
  prettyCanonicalJsonWithin,
  type JsonObject,
  type JsonValue,
} from './canonical-json.js';
import type { ContentId, StateFingerprint } from './content-identity.js';
import type { ExportRecord } from './export-provenance.js';
import { writeExportRecord } from './export-record-json.js';
import { writeHistoryRecord } from './history-json.js';
import type { HistoryRecord, RetentionPolicy } from './history-record.js';
import { writeProjectDocument } from './project-json.js';
import type { ProjectState } from './project-state.js';
import { writeTreeHeader } from './project-tree-header.js';
import {
  BACKUP_POLICY_PATH,
  BRANCH_NAMES_PATH,
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
import {
  ProvenanceLevel,
  stripAssetProvenance,
  stripExportRecords,
} from './provenance-stripping.js';
import { writeRetentionPolicy } from './retention-json.js';
import { writeBackupPolicy, type BackupPolicy } from './backup-policy-json.js';
import { writeComparisonChoice, type ComparisonChoiceRecord } from './comparison-choice-json.js';
import { LONGEST_METADATA, TREE_JSON_LIMITS, atFile, fileTooLarge } from './project-tree-files.js';
import { encodeUtf8 } from './utf8.js';

/** A piece of managed media a tree carries. */
export interface TreeMedia {
  readonly contentId: ContentId;
  readonly byteLength: number;
}

/** A cache a tree carries, by its path under `caches/`, which its keeper reads. */
export interface TreeCache {
  readonly path: string;
  readonly byteLength: number;
}

/** A project's history as a tree carries it, with the states it keeps whole. */
export interface ProjectTreeHistory {
  readonly record: HistoryRecord;
  readonly retention: RetentionPolicy;

  /** The states kept whole, by fingerprint: at least every snapshot's. */
  readonly states: ReadonlyMap<StateFingerprint, ProjectState>;

  /** The A/B comparison open between two of its states, where one is (REQ-STOR-195). */
  readonly comparison?: ComparisonChoiceRecord;
}

/**
 * How much of a project a tree holds: the history, which keeps full provenance,
 * or the state alone at the provenance level chosen.
 */
export type ProjectTreeScope =
  | { readonly kind: 'history'; readonly history: ProjectTreeHistory }
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

/** What one file of a tree holds. */
export type TreeFileBody =
  | { readonly kind: 'text'; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'media'; readonly contentId: ContentId; readonly byteLength: number }
  | { readonly kind: 'cache'; readonly path: string; readonly byteLength: number };

/** One file of a tree. */
export interface ProjectTreeFile {
  readonly path: string;
  readonly body: TreeFileBody;
}

/**
 * The files of a project's tree, sorted by path. Fails, at the first such file,
 * where a file would be past what the tree's reader reads, since a tree that
 * cannot be read back is no copy. Throws where the history is of another
 * project than the state, or two parts would share a path: the caller built the
 * content wrongly.
 */
export function projectTree(content: ProjectTreeContent): DomainResult<readonly ProjectTreeFile[]> {
  const files = new TreeFiles();
  const { scope } = content;
  const provenance = scope.kind === 'state' ? scope.provenance : ProvenanceLevel.Full;
  const state = stripAssetProvenance(content.state, provenance);

  files.text(
    TREE_HEADER_PATH,
    writeTreeHeader({
      project: state.project.id,
      displayName: state.project.displayName,
      history: scope.kind === 'history',
      caches: content.caches !== undefined,
      provenance,
    }),
  );
  addProject(files, state);
  files.text(BACKUP_POLICY_PATH, writeBackupPolicy(content.backup));
  if (scope.kind === 'history') addHistory(files, state.project.id, scope.history);
  for (const record of stripExportRecords(content.exports, provenance)) {
    files.text(exportPath(record.id), writeExportRecord(record));
  }
  for (const { contentId, byteLength } of content.media) {
    files.add(mediaPath(contentId), { kind: 'media', contentId, byteLength });
  }
  for (const { path, byteLength } of content.caches ?? []) {
    files.add(cachePath(path), { kind: 'cache', path, byteLength });
  }
  return files.sorted();
}

/** The files of a tree as they are added. */
class TreeFiles {
  private readonly files = new Map<string, TreeFileBody>();
  private problem: DomainFailure | undefined;

  add(path: string, body: TreeFileBody): void {
    if (this.files.has(path)) throw new Error(`Two parts of a project tree share ${path}.`);
    this.files.set(path, body);
  }

  /**
   * Adds the text of `value`, unless a file already refused means the tree is
   * not written, or this one is past what the reader reads: in characters, or
   * in bytes once encoded, which the reader measures first.
   */
  text(path: string, value: JsonValue): void {
    if (this.problem !== undefined) return;
    const text = prettyCanonicalJsonWithin(value, TREE_JSON_LIMITS);
    if (!text.ok) {
      this.problem = atFile(text.failures[0], path);
      return;
    }
    const bytes = encodeUtf8(text.value);
    if (bytes.length > LONGEST_METADATA) {
      this.problem = fileTooLarge(path);
      return;
    }
    this.add(path, { kind: 'text', bytes });
  }

  sorted(): DomainResult<readonly ProjectTreeFile[]> {
    if (this.problem !== undefined) return fail(this.problem);
    return succeed(
      [...this.files]
        .map(([path, body]) => ({ path, body }))
        .sort((one, other) => compareCodeUnits(one.path, other.path)),
    );
  }
}

/** The project's files: its settings, track order, entities and sources. */
function addProject(files: TreeFiles, state: ProjectState): void {
  const document = writeProjectDocument(state);
  const project = objectIn(document, 'project');
  files.text(SETTINGS_PATH, valueIn(project, 'settings'));
  files.text(TRACK_ORDER_PATH, valueIn(project, 'trackOrder'));
  for (const list of ENTITY_DIRECTORIES.keys()) {
    for (const entity of objectsIn(project, list)) {
      files.text(entityPath(list, textIn(entity, 'id')), entity);
    }
  }
  for (const source of objectsIn(document, 'sources')) {
    files.text(sourcePath(textIn(source, 'assetId')), source);
  }
}

/** The history's files: its position, names, retention, nodes, snapshots and states. */
function addHistory(files: TreeFiles, project: ProjectId, history: ProjectTreeHistory): void {
  if (history.record.project !== project) {
    throw new Error('A project tree holds the history of its own project only.');
  }
  const record = writeHistoryRecord(history.record);
  files.text(CURSOR_PATH, {
    cursor: valueIn(record, 'cursor'),
    preferred: valueIn(record, 'preferred'),
  });
  files.text(BRANCH_NAMES_PATH, valueIn(record, 'branchNames'));
  files.text(RETENTION_PATH, writeRetentionPolicy(history.retention));
  if (history.comparison !== undefined) {
    files.text(COMPARISON_PATH, writeComparisonChoice(history.comparison));
  }
  for (const node of objectsIn(record, 'nodes')) files.text(nodePath(textIn(node, 'id')), node);
  for (const snapshot of objectsIn(record, 'snapshots')) {
    files.text(snapshotPath(textIn(snapshot, 'id')), snapshot);
  }
  for (const [fingerprint, state] of history.states) {
    files.text(statePath(fingerprint), writeProjectDocument(state));
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
