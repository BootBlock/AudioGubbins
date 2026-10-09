/**
 * The storage worker's composition root in the browser: the parts its services
 * are made from, read from what the worker's browser offers (ADR-0022,
 * REQ-STOR-021, REQ-STOR-098, REQ-EXEC-216).
 *
 * The tree is the origin-private file system, which the worker writes through
 * synchronous access handles; the digest is the browser's SHA-256; identifiers
 * and tokens are drawn from its random numbers; the write leases are Web Locks
 * with a broadcast channel beside them, where the worker has Web Locks, and
 * projects open read-only where it has not. The page starts the worker only
 * where projects can be kept, so a worker without the digest or random numbers
 * fails to start, which the page's end of the port reports as storage
 * unavailable for every call.
 */

import {
  createLeaseCoordinator,
  originPrivateFile,
  originPrivateTree,
  randomTokens,
  webDigest,
  yieldToHost,
} from '@audiogubbins/browser-storage';
import type { StoragePlatform } from '@audiogubbins/capabilities';
import type { Clock } from '@audiogubbins/diagnostics';
import { createIdGenerator } from '@audiogubbins/domain';
import { HttpPackSource } from '@audiogubbins/model-packs';

import type { PortEndpoint } from '../protocol/port-channel.js';
import { turnsEvery } from './host-turns.js';
import type { HostLogs, HostParts } from './host-services.js';
import { serveStorage } from './storage-host.js';
import { timeOfDay } from '@audiogubbins/text';

/** What the worker's browser offers, read by the worker's entry module. */
export interface HostPlatform {
  readonly storage: StoragePlatform;

  /** The origin-private file system's root, absent where the worker is offered none. */
  readonly readRoot: (() => Promise<FileSystemDirectoryHandle>) | undefined;
  readonly clock: Clock;

  /** Milliseconds from a fixed moment, which only move on: how long work has run. */
  readonly elapsed: () => number;
}

/**
 * How long storage work runs between turns given to the worker's host: short
 * enough that a cancel is heard at once, as a person sees it, and long enough
 * that the turns cost the work nothing it would notice.
 */
const TURN_MILLISECONDS = 8;

/**
 * How long a question to the other tabs waits for the tab holding a project to
 * say who it is, before that tab is taken to be one that cannot be described.
 */
const OWNER_PATIENCE_MILLISECONDS = 500;

/** The parts, from the platform, with the digest and random numbers it was found to have. */
function partsOf(
  platform: HostPlatform,
  logs: HostLogs,
  subtle: SubtleCrypto,
  randomBytes: (length: number) => Uint8Array,
): HostParts {
  const { storage, clock } = platform;
  const nextToken = randomTokens(randomBytes);
  const owner = {
    instance: nextToken(),
    // A tab is named to the others by the time it was opened, to the
    // second, so two tabs opened in one minute are told apart. The worker
    // starts as its tab opens.
    label: `the tab opened at ${timeOfDay(clock.now())}`,
  };
  return {
    tree: originPrivateTree(platform.readRoot),
    digest: webDigest(subtle),
    clock,
    ids: createIdGenerator(randomBytes),
    nextToken,
    owner,
    coordinator: createLeaseCoordinator({
      locks: storage.locks,
      openChannel: storage.openBroadcastChannel,
      instance: owner.instance,
      patience: () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, OWNER_PATIENCE_MILLISECONDS);
        }),
      logger: logs.loggerFor('storage'),
    }),
    yieldToHost: turnsEvery(TURN_MILLISECONDS, platform.elapsed, yieldToHost(storage.hostYielding)),
    logs,
    fileAt: originPrivateFile(platform.readRoot),
    packSource: (catalogue) => new HttpPackSource(catalogue),
    estimate: estimateOf(storage.estimate),
  };
}

/**
 * The storage estimate from the browser's, where it gives both its numbers.
 * A browser that refuses to estimate, as one may in a context it does not
 * trust, has given no estimate, and the time left is then unknown rather than
 * assumed (REQ-EXEC-216).
 */
function estimateOf(read: StoragePlatform['estimate']): HostParts['estimate'] {
  return async () => {
    if (read === undefined) return undefined;
    let given: StorageEstimate;
    try {
      given = await read();
    } catch (error) {
      // The browser rejects with its own error, a DOMException as a rule.
      if (error instanceof Error) return undefined;
      throw error;
    }
    const { quota, usage } = given;
    return quota === undefined || usage === undefined ? undefined : { quota, usage };
  };
}

/** Serves the page from inside the storage worker, over what its browser offers. */
export function startStorageHost(scope: PortEndpoint, platform: HostPlatform): void {
  const { subtle, randomBytes } = platform.storage;
  if (subtle === undefined || randomBytes === undefined) {
    throw new Error(
      'The storage worker cannot keep projects: its browser offers no digest or no random numbers.',
    );
  }
  serveStorage(scope, platform.clock, (logs) => partsOf(platform, logs, subtle, randomBytes));
}
