/**
 * Reading a project tree's state: the project's files put back together as
 * the project's own document and read through the one reader of projects, so
 * a tree's state is exactly as valid as a document's, and every problem is
 * placed at the file it came from (REQ-STOR-103, REQ-EXEC-136.12).
 */

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import type { JsonValue } from './canonical-json.js';
import { PROJECT_DOCUMENT_FORMAT, readProjectDocument } from './project-json.js';
import type { ProjectState } from './project-state.js';
import { namedValues, type TreeReading } from './project-tree-files.js';
import type { TreeHeader } from './project-tree-header.js';
import {
  ENTITY_DIRECTORIES,
  EXPORT_SETTINGS_PATH,
  GAME_AUDIO_PATH,
  SETTINGS_PATH,
  TRACK_ORDER_PATH,
} from './project-tree-layout.js';

/** The project's state from its files, put back together and read whole. */
export async function readTreeState(
  tree: TreeReading,
  header: TreeHeader,
): Promise<ProjectState | undefined> {
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
  const [exportFile] = tree.ofKind('export-settings');
  const exportSettings = exportFile === undefined ? undefined : await tree.valueOf(exportFile);
  const [gameFile] = tree.ofKind('game-audio');
  const gameAudio = gameFile === undefined ? undefined : await tree.valueOf(gameFile);
  if (settings === undefined || trackOrder === undefined) return undefined;
  if (exportFile !== undefined && exportSettings === undefined) return undefined;
  if (gameFile !== undefined && gameAudio === undefined) return undefined;
  const state = readProjectDocument({
    format: PROJECT_DOCUMENT_FORMAT,
    schemaVersion: SCHEMA_VERSIONS.projectDocument,
    project: { ...project, settings, trackOrder },
    sources: sources.values,
    ...(exportSettings === undefined ? {} : { exportSettings }),
    ...(gameAudio === undefined ? {} : { gameAudio }),
  });
  if (state.ok) return state.value;
  tree.locate(state.failures, { lists, members: PROJECT_MEMBER_FILES });
  return undefined;
}

/** The file each member of the project put back together came from. */
const PROJECT_MEMBER_FILES: ReadonlyMap<string, string> = new Map([
  ['project.settings', SETTINGS_PATH],
  ['project.trackOrder', TRACK_ORDER_PATH],
  ['exportSettings', EXPORT_SETTINGS_PATH],
  ['gameAudio', GAME_AUDIO_PATH],
]);
