/**
 * The assets an editor view can open: the open project's assets and regions
 * (`project-assets.ts`), the deterministic test assets, and the sound of a
 * reference picture once the browser has decoded it (REQ-AUDIO-156).
 *
 * The project's entries follow the project as it changes; the rest belong to
 * the session and take no marker, region or edit. A view names its asset by
 * identity, so a view of an asset not open says why: one of the project's
 * whose files are still being read, or cannot be, says so, and any other
 * offers the list. The list is kept, never made again: an entry nothing
 * changed is the value it was, so what reads it redraws nothing.
 */

import type { Logger } from '@audiogubbins/diagnostics';
import type { DomainResult } from '@audiogubbins/domain';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { ProjectEntries, ProjectEntry } from '../assets/project-assets.js';
import { reasonOf } from './abandoning.js';
import { observable, type Observable } from './observable.js';

/** An entry of the project that cannot be opened yet, and why. */
export type UnopenedEntry = Exclude<ProjectEntry, { readonly kind: 'open' }>;

/** What the catalogue holds. */
export interface AssetCatalogueState {
  /** The project's assets and regions first, in the project's order, then the session's. */
  readonly assets: readonly EditorAsset[];
  /** The project's entries a view cannot open yet, by identity. */
  readonly unopened: ReadonlyMap<string, UnopenedEntry>;
  /** Why an asset that should be here is not, in sentences a reader is shown. */
  readonly problems: readonly string[];
}

/** The assets an editor view can open. */
export interface AssetCatalogue extends Observable<AssetCatalogueState> {
  /** The asset of identity `id`, or `undefined` where none is open. */
  readonly find: (id: string) => EditorAsset | undefined;
  /** Adds an asset of the session, or takes the place of the one of its identity. */
  readonly add: (asset: EditorAsset) => void;
  /** Makes `entries` the project's, in place of those it had. */
  readonly showProject: (entries: ProjectEntries) => void;
}

/** Whether two lists hold the same assets in the same order. */
function sameAssets(one: readonly EditorAsset[], other: readonly EditorAsset[]): boolean {
  return one.length === other.length && one.every((asset, index) => asset === other[index]);
}

/** Makes the catalogue from the assets every session has, saying why any could not be made. */
export function createAssetCatalogue(
  initial: DomainResult<readonly EditorAsset[]>,
  logger: Logger,
): AssetCatalogue {
  const problems = initial.ok ? [] : initial.failures.map((one) => one.summary);
  for (const reason of problems) logger.error('A test asset could not be made.', { reason });
  const state = observable<AssetCatalogueState>({
    assets: initial.ok ? initial.value : [],
    unopened: new Map(),
    problems,
  });
  // The project's open entries, so the session's are the rest.
  let fromProject = new Set<EditorAsset>();
  return {
    get: state.get,
    subscribe: state.subscribe,
    find: (id) => state.get().assets.find((asset) => asset.id === id),
    add: (asset) => {
      state.update((current) => {
        const index = current.assets.findIndex((each) => each.id === asset.id);
        const assets = index < 0 ? [...current.assets, asset] : current.assets.with(index, asset);
        return { ...current, assets };
      });
    },
    showProject: (entries) => {
      const current = state.get();
      const opened: EditorAsset[] = [];
      const unopened = new Map<string, UnopenedEntry>();
      for (const [id, entry] of entries) {
        if (entry.kind === 'open') opened.push(entry.asset);
        else unopened.set(id, entry);
      }
      const ofSession = current.assets.filter((asset) => !fromProject.has(asset));
      const assets = [...opened, ...ofSession];
      const sameUnopened =
        unopened.size === current.unopened.size &&
        [...unopened].every(([id, entry]) => current.unopened.get(id) === entry);
      fromProject = new Set(opened);
      if (sameAssets(assets, current.assets) && sameUnopened) return;
      state.set({
        ...current,
        assets: sameAssets(assets, current.assets) ? current.assets : assets,
        unopened: sameUnopened ? current.unopened : unopened,
      });
    },
  };
}

/**
 * The asset of identity `id` once a view can open it, or why it cannot once
 * that is known: an entry still being found, or not listed yet, is waited for.
 * Rejects with the signal's reason once `signal` aborts.
 */
export function settledEntry(
  catalogue: AssetCatalogue,
  id: string,
  signal: AbortSignal,
): Promise<EditorAsset | UnopenedEntry> {
  const settled = (): EditorAsset | UnopenedEntry | undefined => {
    const found = catalogue.find(id);
    if (found !== undefined) return found;
    const unopened = catalogue.get().unopened.get(id);
    return unopened?.kind === 'unavailable' ? unopened : undefined;
  };
  return new Promise((resolve, reject) => {
    const now = settled();
    if (now !== undefined) {
      resolve(now);
      return;
    }
    if (signal.aborted) {
      reject(reasonOf(signal));
      return;
    }
    const stop = (): void => {
      unsubscribe();
      signal.removeEventListener('abort', abort);
    };
    const abort = (): void => {
      stop();
      reject(reasonOf(signal));
    };
    const unsubscribe = catalogue.subscribe(() => {
      const entry = settled();
      if (entry === undefined) return;
      stop();
      resolve(entry);
    });
    signal.addEventListener('abort', abort, { once: true });
  });
}
