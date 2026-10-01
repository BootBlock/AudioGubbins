/**
 * The storage worker's own composition, serving a page's client across the
 * port pair, over parts in memory: a tree, the leases of one browser profile,
 * seeded identifiers and a clock that steps. Nothing reaches the real machine:
 * the digest is the environment's Web Crypto. The page's records are kept in a
 * log store of its own, admitting Info and above. A second set of services
 * over the same tree and leases lets a test look into the storage as another
 * window of the profile would.
 */

import { webDigest } from '@audiogubbins/browser-storage';
import {
  LogSeverity,
  createDiagnosticCentre,
  createLogStore,
  type Clock,
  type LogStore,
} from '@audiogubbins/diagnostics';
import {
  StandardLayouts,
  createDeterministicIdGenerator,
  sampleRate,
  type ProjectSettings,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { YieldToHost } from '@audiogubbins/media-store';
import { MemoryStorageTree, countingTokens } from '@audiogubbins/media-store/testing';
import type { StorageTree } from '@audiogubbins/project-format';
import { MemoryLeaseCoordinator } from '@audiogubbins/storage/testing';

import { connectStorage, type StorageClient } from '../client/storage-client.js';
import {
  hostServices,
  type HostLogs,
  type HostParts,
  type HostServices,
} from '../host/host-services.js';
import { serveStorage } from '../host/storage-host.js';
import { portPair, type PortPair } from './port-pair.js';

/** What a new project is made with in these tests. */
export const SETTINGS: ProjectSettings = {
  sampleRate: expectSuccess(sampleRate(48_000)),
  channelLayout: StandardLayouts.stereo,
};

/** A page served by a storage worker in memory, and what a test looks at. */
export interface MemoryStorage {
  readonly client: StorageClient;
  readonly pair: PortPair;
  readonly coordinator: MemoryLeaseCoordinator;

  /** The records the page's diagnostics kept. */
  readonly logs: LogStore;

  /** The worker's loggers, for a test to make a record in the worker. */
  readonly hostLogs: HostLogs;

  /** Services over the worker's tree and leases, as another window's (see the module comment). */
  readonly another: HostServices;
}

/** How the worker in memory is made. */
export interface MemoryStorageOptions {
  /** The tree the worker keeps projects in, where a test watches it. */
  readonly tree?: StorageTree;

  /** The turns the worker's storage paths take: none where not given. */
  readonly yieldToHost?: YieldToHost;
}

/** A clock that moves on a second each time it is read. */
function steppingClock(): Clock {
  let now = 1_790_000_000_000;
  return {
    now: () => {
      now += 1_000;
      return now;
    },
  };
}

/** The parts of a window over `tree` and `coordinator`, its identifiers seeded by `seed`. */
function partsOf(
  window: string,
  seed: number,
  shared: Pick<HostParts, 'tree' | 'clock' | 'coordinator' | 'yieldToHost' | 'logs'>,
): HostParts {
  return {
    ...shared,
    digest: webDigest(crypto.subtle),
    ids: createDeterministicIdGenerator(seed),
    nextToken: countingTokens(),
    owner: { instance: window, label: `the window called ${window}` },
    keeper: undefined,
  };
}

/** A storage worker in memory, serving a page's client (see the module comment). */
export function memoryStorage(options: MemoryStorageOptions = {}): MemoryStorage {
  const pair = portPair();
  const clock = steppingClock();
  const tree = options.tree ?? new MemoryStorageTree();
  const coordinator = new MemoryLeaseCoordinator();
  const yieldToHost = options.yieldToHost ?? (() => Promise.resolve());
  let hostLogs: HostLogs | undefined;
  serveStorage(pair.worker, clock, (logs) => {
    hostLogs = logs;
    return partsOf('worker', 29, { tree, clock, coordinator, yieldToHost, logs });
  });
  if (hostLogs === undefined) throw new Error('The worker made its services without loggers.');

  const logs = createLogStore();
  const diagnostics = createDiagnosticCentre(logs, clock, {
    defaultSeverity: LogSeverity.Info,
    categoryOverrides: {},
  });
  const another = hostServices(
    partsOf('another', 31, {
      tree,
      clock,
      coordinator,
      yieldToHost: () => Promise.resolve(),
      logs: createDiagnosticCentre(createLogStore(), clock),
    }),
  );
  const client = connectStorage(pair.page, diagnostics);
  return { client, pair, coordinator, logs, hostLogs, another };
}
