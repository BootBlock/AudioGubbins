/**
 * The pack manager as a test builds it: over a window's storage worker in
 * memory, whose catalogue is packs in memory (`project-context.ts`), or over
 * none, as in a browser that keeps no packs. The folders the person would
 * choose are scripted, and the catalogue's URL is the page's own `packs/`, as
 * the build configures it by default; nothing reaches the network.
 */

import type { PacksClient, PageFolder } from '@audiogubbins/storage-runtime';

import { PackManager } from '../ml/pack-manager.js';
import type { KnownAvailability } from '../ml/model-availability.js';
import { observable, type Observable } from '../state/observable.js';

/** The catalogue's URL in every test: the page's own `packs/`. */
export const TEST_CATALOGUE = 'http://localhost/packs/';

/**
 * A manager over `packs`, with what it reads of availability, its folders
 * chosen by `chooseFolder`, its calls given up once `lifetime` ends.
 */
export function packManagerOver(
  packs: PacksClient | undefined,
  availability: Observable<KnownAvailability>,
  chooseFolder: () => Promise<PageFolder | undefined>,
  lifetime: AbortSignal,
): PackManager {
  return new PackManager({
    packs,
    catalogueUrl: () => Promise.resolve(TEST_CATALOGUE),
    chooseFolder,
    availability,
    lifetime,
  });
}

/** A manager in a browser that keeps no packs, whose availability is never known. */
export function noPackManager(): PackManager {
  return packManagerOver(
    undefined,
    observable<KnownAvailability>({ kind: 'unknown' }),
    () => Promise.resolve(undefined),
    new AbortController().signal,
  );
}
