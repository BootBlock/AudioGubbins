/**
 * The storage worker: a module the browser loads as a dedicated worker, where
 * the whole storage core runs (ADR-0022).
 *
 * It only reads what the worker's browser offers, through the capabilities
 * package, where the browser is asked for anything (REQ-EXEC-136.4), and hands
 * it with the worker's global scope to `startStorageHost`, which holds
 * everything the worker does, so that behaviour is tested without a worker. It
 * is compiled again, with everything it imports, by `scopes/dedicated-worker`,
 * against a worker's definitions alone.
 */

import { readOriginPrivateRoot, readStoragePlatform } from '@audiogubbins/capabilities';

import { startStorageHost } from '../host/browser-host.js';

startStorageHost(self, {
  storage: readStoragePlatform(navigator, self),
  readRoot: readOriginPrivateRoot(navigator),
  clock: { now: () => Date.now() },
  elapsed: () => performance.now(),
});
