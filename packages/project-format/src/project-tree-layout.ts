/**
 * Where each part of a project lies in its unpacked tree: the Git-friendly form
 * of a project, and the content of a portable bundle (REQ-STOR-103).
 *
 * - `audiogubbins-project.json`: the header (`project-tree-header.ts`).
 * - `project/settings.json` and `project/track-order.json`: the project's
 *   settings and the order of its tracks.
 * - `project/<list>/<id>.json`: one entity of a list, such as a track at
 *   `project/tracks/<id>.json`.
 * - `project/assets/<id>.source.json`: where an asset's bytes come from and how
 *   it was imported, beside the asset.
 * - `history/cursor.json`: the node the project is at, and the child redo
 *   follows from each node.
 * - `history/branch-names.json` and `history/retention.json`.
 * - `history/nodes/<id>.json` and `history/snapshots/<id>.json`: one node or
 *   named snapshot each.
 * - `history/states/<fingerprint>.json`: a state the history keeps whole.
 * - `exports/<id>.json`: one export record.
 * - `media/<content id>`: managed media, as binary.
 * - `caches/<path>`: disposable caches, present only where asked for.
 *
 * One entity to a file, named by its stable identifier, is what keeps a change
 * to a project a change to the few files it touched, and a merge of two
 * branches of work a merge of files. Metadata is JSON a person can read, and
 * media is apart from it, so a repository may keep media however it keeps
 * binaries.
 */

import { isWellFormedId } from '@audiogubbins/domain';

import {
  contentIdFrom,
  stateFingerprintFrom,
  type ContentId,
  type StateFingerprint,
} from './content-identity.js';
import { isTreePath } from './storage-tree.js';

/** The tree's header. */
export const TREE_HEADER_PATH = 'audiogubbins-project.json';

/** A list of entities the project holds, as the project's own member names it. */
type EntityList = 'assets' | 'tracks' | 'buses' | 'clips' | 'regions' | 'markers' | 'effectChains';

/** Each list of entities and the directory its files lie in. */
export const ENTITY_DIRECTORIES: ReadonlyMap<EntityList, string> = new Map([
  ['assets', 'assets'],
  ['tracks', 'tracks'],
  ['buses', 'buses'],
  ['clips', 'clips'],
  ['regions', 'regions'],
  ['markers', 'markers'],
  ['effectChains', 'effect-chains'],
]);

const LISTS_BY_DIRECTORY: ReadonlyMap<string, EntityList> = new Map(
  [...ENTITY_DIRECTORIES].map(([list, directory]) => [directory, list]),
);

export const SETTINGS_PATH = 'project/settings.json';
export const TRACK_ORDER_PATH = 'project/track-order.json';
export const CURSOR_PATH = 'history/cursor.json';
export const BRANCH_NAMES_PATH = 'history/branch-names.json';
export const RETENTION_PATH = 'history/retention.json';

const ENTITY_FILE = /^project\/([a-z-]+)\/([0-9a-f-]+)\.json$/u;
const SOURCE_FILE = /^project\/assets\/([0-9a-f-]+)\.source\.json$/u;
const NODE_FILE = /^history\/nodes\/([0-9a-f-]+)\.json$/u;
const SNAPSHOT_FILE = /^history\/snapshots\/([0-9a-f-]+)\.json$/u;
const STATE_FILE = /^history\/states\/(s1-[0-9a-f]{64})\.json$/u;
const EXPORT_FILE = /^exports\/([0-9a-f-]+)\.json$/u;
const MEDIA_FILE = /^media\/(c1-[0-9a-f]{64})$/u;
const CACHES_PREFIX = 'caches/';

/** What a path of the tree holds, read from the path alone. */
export type TreePlace =
  | { readonly kind: 'header' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'track-order' }
  | { readonly kind: 'entity'; readonly list: EntityList; readonly id: string }
  | { readonly kind: 'source'; readonly asset: string }
  | { readonly kind: 'cursor' }
  | { readonly kind: 'branch-names' }
  | { readonly kind: 'retention' }
  | { readonly kind: 'node'; readonly id: string }
  | { readonly kind: 'snapshot'; readonly id: string }
  | { readonly kind: 'state'; readonly fingerprint: StateFingerprint }
  | { readonly kind: 'export'; readonly id: string }
  | { readonly kind: 'media'; readonly contentId: ContentId }
  | { readonly kind: 'cache'; readonly path: string };

const FIXED_PLACES: ReadonlyMap<string, TreePlace> = new Map<string, TreePlace>([
  [TREE_HEADER_PATH, { kind: 'header' }],
  [SETTINGS_PATH, { kind: 'settings' }],
  [TRACK_ORDER_PATH, { kind: 'track-order' }],
  [CURSOR_PATH, { kind: 'cursor' }],
  [BRANCH_NAMES_PATH, { kind: 'branch-names' }],
  [RETENTION_PATH, { kind: 'retention' }],
]);

/** What the file at `path` holds, or `undefined` for a path the tree never has. */
export function placeOf(path: string): TreePlace | undefined {
  const fixed = FIXED_PLACES.get(path);
  if (fixed !== undefined) return fixed;
  if (path.startsWith(CACHES_PREFIX)) {
    const rest = path.slice(CACHES_PREFIX.length);
    return rest !== '' && isTreePath(rest) ? { kind: 'cache', path: rest } : undefined;
  }
  const source = identifierIn(SOURCE_FILE, path);
  if (source !== undefined) return { kind: 'source', asset: source };
  const entity = ENTITY_FILE.exec(path);
  const list = LISTS_BY_DIRECTORY.get(entity?.[1] ?? '');
  const entityId = entity?.[2];
  if (list !== undefined && entityId !== undefined && isWellFormedId(entityId)) {
    return { kind: 'entity', list, id: entityId };
  }
  const node = identifierIn(NODE_FILE, path);
  if (node !== undefined) return { kind: 'node', id: node };
  const snapshot = identifierIn(SNAPSHOT_FILE, path);
  if (snapshot !== undefined) return { kind: 'snapshot', id: snapshot };
  const exported = identifierIn(EXPORT_FILE, path);
  if (exported !== undefined) return { kind: 'export', id: exported };
  const fingerprint = stateFingerprintFrom(STATE_FILE.exec(path)?.[1] ?? '');
  if (fingerprint.ok) return { kind: 'state', fingerprint: fingerprint.value };
  const content = contentIdFrom(MEDIA_FILE.exec(path)?.[1] ?? '');
  return content.ok ? { kind: 'media', contentId: content.value } : undefined;
}

/**
 * Whether a path is one a project's tree may hold, so a directory that holds a
 * tree beside other things is changed only where it holds the tree.
 */
export function isProjectTreePath(path: string): boolean {
  return placeOf(path) !== undefined;
}

/** The directories a tree holds its files in, and nothing else. */
const TREE_DIRECTORIES: ReadonlySet<string> = new Set([
  'project',
  'history',
  'exports',
  'media',
  'caches',
]);

/**
 * Whether a path lies where a project's tree keeps its files: the header, or
 * anything in one of the tree's directories. A file there that no tree has is
 * refused when the tree is read; a file anywhere else is none of the tree's.
 */
export function isWithinProjectTree(path: string): boolean {
  return path === TREE_HEADER_PATH || TREE_DIRECTORIES.has(path.split('/')[0] ?? '');
}

/** The identifier a path of this pattern names, where it is well formed. */
function identifierIn(pattern: RegExp, path: string): string | undefined {
  const id = pattern.exec(path)?.[1];
  return id !== undefined && isWellFormedId(id) ? id : undefined;
}

export function entityPath(list: EntityList, id: string): string {
  return `project/${ENTITY_DIRECTORIES.get(list) ?? list}/${id}.json`;
}

export function sourcePath(asset: string): string {
  return `project/assets/${asset}.source.json`;
}

export function nodePath(id: string): string {
  return `history/nodes/${id}.json`;
}

export function snapshotPath(id: string): string {
  return `history/snapshots/${id}.json`;
}

export function statePath(fingerprint: StateFingerprint): string {
  return `history/states/${fingerprint}.json`;
}

export function exportPath(id: string): string {
  return `exports/${id}.json`;
}

export function mediaPath(contentId: ContentId): string {
  return `media/${contentId}`;
}

export function cachePath(path: string): string {
  return `${CACHES_PREFIX}${path}`;
}
