/**
 * What the shell reads of the project system, so it draws again whenever any of
 * it changes: the menus and the palette ask each command whether it can run,
 * and a command's answer reads these stores (REQ-EDIT-073).
 *
 * A hook of its own beside `use-shell-state.ts`, since the project system is
 * absent where the browser keeps no projects, and each store is read through a
 * stand-in then, as a hook cannot be called only sometimes.
 */

import { useSyncExternalStore } from 'react';

import type { Observable } from '../state/observable.js';
import type { ProjectStores } from '../state/project-stores.js';
import type { StorageRootStore } from '../state/storage-root-store.js';

/** A store that never changes, standing in for one the browser does not have. */
const NOTHING: Observable<undefined> = {
  get: () => undefined,
  subscribe: () => () => undefined,
};

/** Reads one store where it exists, and nothing otherwise. */
function useMaybe<TValue>(store: Observable<TValue> | undefined): TValue | undefined {
  const read: Observable<TValue | undefined> = store ?? NOTHING;
  return useSyncExternalStore(read.subscribe, read.get);
}

/** Reads every store of the project system a command's availability reads. */
export function useProjectState(root: StorageRootStore, projects: ProjectStores | undefined) {
  return {
    root: useSyncExternalStore(root.subscribe, root.get),
    open: useMaybe(projects?.project),
    library: useMaybe(projects?.library),
    review: useMaybe(projects?.review),
    usage: useMaybe(projects?.usage),
    sources: useMaybe(projects?.sources),
    transfer: useMaybe(projects?.transfer),
  };
}
