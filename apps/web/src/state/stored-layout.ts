/**
 * The layout that was mounted when the application last closed: where it is
 * stored, and how it is read.
 *
 * Apart from the workspace store because it is a text of its own, with a key
 * of its own, as the collection is (`workspace-collection.ts`). Where its text
 * is kept when it cannot be used is `workspace-custody.ts`.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import {
  resolveStoredLayout,
  type PanelDescriptor,
  type PanelKind,
  type ResolvedLayout,
  type WorkspaceLayout,
} from '@audiogubbins/workspace';

import type { StateStorage } from './state-storage.js';

/**
 * Where the mounted layout is kept: the one layout on screen, written with
 * every change to it. Separate from the collection's key, which holds every
 * workspace the user saved.
 */
export const MOUNTED_KEY = 'audiogubbins.workspace';

/**
 * The layout to mount: the one stored, where it can be used, and `fallback`
 * where there is none or it cannot be, with why it could not.
 */
export function readMountedLayout(
  storage: StateStorage,
  fallback: WorkspaceLayout,
  descriptors: ReadonlyMap<PanelKind, PanelDescriptor>,
  logger: Logger,
): ResolvedLayout {
  return resolveStoredLayout(storage.read(MOUNTED_KEY), fallback, descriptors, logger);
}
