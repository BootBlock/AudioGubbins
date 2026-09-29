/**
 * Reading a project's unpacked tree back, with every part validated as the
 * project's own documents are (REQ-STOR-103, REQ-STOR-052, REQ-EXEC-136.12).
 *
 * The header is read first, and a tree of another schema is refused with the
 * version it was found to be before anything else is read. Then every file is
 * placed by its path, and a file no tree has, or one the header says the tree
 * does not hold, is refused rather than ignored. The project's files are put
 * back together as the project's own value and read through the one reader of
 * projects, and the history's as the history's, so a tree is exactly as valid
 * as the project it holds. A file must name what it holds: an entity whose
 * identifier is not its file's name is refused, and so is a kept state whose
 * fingerprint is not its name. Every snapshot's state must be in the tree.
 *
 * Every problem is reported, each at the path of its file. Media and caches are
 * placed by their paths and lengths and never read here: their bytes are the
 * caller's to stream and check. What is read round-trips: the files written
 * from it are the files it was read from, where those were written by
 * {@link projectTree}.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import type { Digest } from './byte-ports.js';
import { compareCodeUnits, type JsonObject, type JsonValue } from './canonical-json.js';
import type { StateFingerprint } from './content-identity.js';
import { objectOf, required, startReading, type Converter } from './document-reading.js';
import type { ExportRecord } from './export-provenance.js';
import { readExportRecord } from './export-record-json.js';
import { readHistoryRecord } from './history-json.js';
import type { HistoryRecord, RetentionPolicy } from './history-record.js';
import {
  PROJECT_DOCUMENT_FORMAT,
  readProjectDocument,
  stateFingerprintOf,
} from './project-json.js';
import type { ProjectState } from './project-state.js';
import { TreeReading, atFile, namedValues, type ProjectTreeListing } from './project-tree-files.js';
import type { TreeHeader } from './project-tree-header.js';
import {
  BACKUP_POLICY_PATH,
  BRANCH_NAMES_PATH,
  COMPARISON_PATH,
  CURSOR_PATH,
  ENTITY_DIRECTORIES,
  RETENTION_PATH,
  SETTINGS_PATH,
  TRACK_ORDER_PATH,
  snapshotPath,
} from './project-tree-layout.js';
import type { ProjectTreeContent, ProjectTreeHistory, TreeCache } from './project-tree-writing.js';
import { stripAssetProvenance, stripExportRecords } from './provenance-stripping.js';
import { readRetentionPolicy } from './retention-json.js';
import { readBackupPolicy, type BackupPolicy } from './backup-policy-json.js';
import { readComparisonChoice, type ComparisonChoiceRecord } from './comparison-choice-json.js';

const CURSOR_MEMBERS: ReadonlySet<string> = new Set(['cursor', 'preferred']);

/** Reads a tree (see the module comment). */
export async function readProjectTree(
  listing: ProjectTreeListing,
  digest: Digest,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectTreeContent>> {
  const tree = new TreeReading(listing, signal);
  const header = await tree.header();
  if (!header.ok) return header;
  tree.placeEvery(header.value);

  const state = await readState(tree, header.value);
  const backup = await readBackup(tree);
  const history = header.value.history
    ? await readHistory(tree, header.value, state, digest)
    : undefined;
  const exports = await readExports(tree);
  const media = tree.ofKind('media').map(({ place, size }) => ({
    contentId: place.contentId,
    byteLength: size,
  }));
  const caches: TreeCache[] = tree
    .ofKind('cache')
    .map(({ place, size }) => ({ path: place.path, byteLength: size }));

  const [first, ...rest] = tree.problems;
  if (first !== undefined) return fail(first, ...rest);
  if (
    state === undefined ||
    backup === undefined ||
    (header.value.history && history === undefined)
  ) {
    throw new Error('A tree read with no problem found must have given its parts.');
  }
  const { provenance } = header.value;
  return succeed({
    state: stripAssetProvenance(state, provenance),
    scope: history === undefined ? { kind: 'state', provenance } : { kind: 'history', history },
    exports: stripExportRecords(exports, provenance),
    backup,
    media,
    ...(header.value.caches ? { caches } : {}),
  });
}

/** The project's state from its files, put back together and read whole. */
async function readState(tree: TreeReading, header: TreeHeader): Promise<ProjectState | undefined> {
  const settings = await tree.single('settings', SETTINGS_PATH);
  const trackOrder = await tree.single('track-order', TRACK_ORDER_PATH);
  const project: Record<string, JsonValue> = {
    id: header.project,
    displayName: header.displayName,
  };
  const lists = new Map<string, readonly string[]>();
  for (const list of ENTITY_DIRECTORIES.keys()) {
    const files = tree.ofKind('entity').filter(({ place }) => place.list === list);
    const read = await namedValues(tree, files, 'id', ({ place }) => place.id);
    project[list] = read.values;
    lists.set(`project.${list}`, read.paths);
  }
  const sources = await namedValues(tree, tree.ofKind('source'), 'assetId', ({ place }) => {
    return place.asset;
  });
  lists.set('sources', sources.paths);
  if (settings === undefined || trackOrder === undefined) return undefined;
  const state = readProjectDocument({
    format: PROJECT_DOCUMENT_FORMAT,
    schemaVersion: SCHEMA_VERSIONS.projectDocument,
    project: { ...project, settings, trackOrder },
    sources: sources.values,
  });
  if (state.ok) return state.value;
  tree.locate(state.failures, { lists, members: PROJECT_MEMBER_FILES });
  return undefined;
}

/** The file each member of the project put back together came from. */
const PROJECT_MEMBER_FILES: ReadonlyMap<string, string> = new Map([
  ['project.settings', SETTINGS_PATH],
  ['project.trackOrder', TRACK_ORDER_PATH],
]);

/** The file each member of the history put back together came from. */
const HISTORY_MEMBER_FILES: ReadonlyMap<string, string> = new Map([
  ['cursor', CURSOR_PATH],
  ['preferred', CURSOR_PATH],
  ['branchNames', BRANCH_NAMES_PATH],
]);

/** The history from its files, with the states it keeps, each checked. */
async function readHistory(
  tree: TreeReading,
  header: TreeHeader,
  state: ProjectState | undefined,
  digest: Digest,
): Promise<ProjectTreeHistory | undefined> {
  const record = await readRecord(tree, header);
  const retention = await readRetention(tree);
  const comparison = record === undefined ? undefined : await readComparison(tree, record);
  const states = await readStates(tree, header, digest);
  if (record === undefined || retention === undefined || state === undefined) return undefined;

  for (const snapshot of record.snapshots) {
    if (!states.has(snapshot.stateFingerprint)) {
      tree.refuse('tree.snapshot-state-missing', snapshotPath(snapshot.id));
    }
  }
  const cursor = record.nodes.find((node) => node.id === record.cursor);
  const named = cursor?.stateFingerprint;
  if (named !== undefined && named !== (await stateFingerprintOf(state, digest))) {
    tree.refuse('tree.cursor-state-mismatch', CURSOR_PATH);
  }
  return { record, retention, states, ...(comparison === undefined ? {} : { comparison }) };
}

/** The history's record, put back together from its files and read whole. */
async function readRecord(
  tree: TreeReading,
  header: TreeHeader,
): Promise<HistoryRecord | undefined> {
  const position = await tree.single('cursor', CURSOR_PATH);
  const branchNames = await tree.single('branch-names', BRANCH_NAMES_PATH);
  const nodes = await namedValues(tree, tree.ofKind('node'), 'id', ({ place }) => place.id);
  const snapshots = await namedValues(tree, tree.ofKind('snapshot'), 'id', ({ place }) => {
    return place.id;
  });
  const lists = new Map([
    ['nodes', nodes.paths],
    ['snapshots', snapshots.paths],
  ]);
  if (position === undefined || branchNames === undefined) return undefined;
  const members = tree.convertedValue(position, CURSOR_PATH, (reading, value, parent, key) => {
    const object = objectOf(reading, value, parent, key, CURSOR_MEMBERS);
    if (object === undefined) return undefined;
    const cursor = required(reading, object, '', 'cursor', anyValue);
    const preferred = required(reading, object, '', 'preferred', anyValue);
    return cursor === undefined || preferred === undefined ? undefined : { cursor, preferred };
  });
  if (members === undefined) return undefined;
  const value: JsonObject = {
    project: header.project,
    ...members,
    branchNames,
    nodes: nodes.values,
    snapshots: snapshots.values,
  };
  const reading = startReading();
  const record = reading.outcome(readHistoryRecord(reading, value, '', ''));
  if (record.ok) return record.value;
  tree.locate(record.failures, { lists, members: HISTORY_MEMBER_FILES });
  return undefined;
}

/** The history's retention policy. */
async function readRetention(tree: TreeReading): Promise<RetentionPolicy | undefined> {
  const [file] = tree.ofKind('retention');
  if (file !== undefined) return await tree.converted(file, readRetentionPolicy);
  tree.refuse('tree.missing-file', RETENTION_PATH);
  return undefined;
}

/** The project's backup policy. */
async function readBackup(tree: TreeReading): Promise<BackupPolicy | undefined> {
  const [file] = tree.ofKind('backup-policy');
  if (file !== undefined) return await tree.converted(file, readBackupPolicy);
  tree.refuse('tree.missing-file', BACKUP_POLICY_PATH);
  return undefined;
}

/**
 * The comparison open, where the tree holds one, refused where a side names a
 * node or snapshot the history does not hold.
 */
async function readComparison(
  tree: TreeReading,
  record: HistoryRecord,
): Promise<ComparisonChoiceRecord | undefined> {
  const [file] = tree.ofKind('comparison');
  if (file === undefined) return undefined;
  const choice = await tree.converted(file, readComparisonChoice);
  if (choice === undefined) return undefined;
  const nodes = new Set<string>(record.nodes.map((node) => node.id));
  const snapshots = new Set<string>(record.snapshots.map((snapshot) => snapshot.id));
  const held = [choice.a, choice.b].every((source) =>
    source.kind === 'node' ? nodes.has(source.node) : snapshots.has(source.snapshot),
  );
  if (held) return choice;
  tree.refuse('tree.comparison-unknown', COMPARISON_PATH);
  return undefined;
}

/** Any value, which the history's own reader then reads. */
const anyValue: Converter<JsonValue> = (_reading, value) => value;

/** The kept states, each checked to be the state its name promises. */
async function readStates(
  tree: TreeReading,
  header: TreeHeader,
  digest: Digest,
): Promise<ReadonlyMap<StateFingerprint, ProjectState>> {
  const states = new Map<StateFingerprint, ProjectState>();
  for (const file of tree.ofKind('state')) {
    const value = await tree.valueOf(file);
    if (value === undefined) continue;
    const state = readProjectDocument(value);
    if (!state.ok) {
      tree.problems.push(...state.failures.map((cause) => atFile(cause, file.path)));
    } else if (state.value.project.id !== header.project) {
      tree.refuse('tree.foreign-state', file.path);
    } else if ((await stateFingerprintOf(state.value, digest)) !== file.place.fingerprint) {
      tree.refuse('tree.state-mismatch', file.path);
    } else {
      states.set(file.place.fingerprint, state.value);
    }
  }
  return states;
}

/** The export log, oldest first, and by identifier where two share a time. */
async function readExports(tree: TreeReading): Promise<readonly ExportRecord[]> {
  const exports: ExportRecord[] = [];
  for (const file of tree.ofKind('export')) {
    const record = await tree.converted(file, readExportRecord);
    if (record === undefined) continue;
    if (record.id === file.place.id) exports.push(record);
    else tree.refuse('tree.misnamed-file', file.path);
  }
  return exports.sort((one, other) => one.at - other.at || compareCodeUnits(one.id, other.id));
}
