/**
 * The storage worker's own composition, serving a page across a port pair,
 * over parts in memory: a tree, the leases of one browser profile, seeded
 * identifiers and a clock that steps. Nothing reaches the real machine: the
 * digest is the environment's Web Crypto. A second set of services over the
 * same tree and leases lets a test look into the storage as another window of
 * the profile would, and two pages given one tree and one set of leases are
 * two tabs of one profile, each with its worker; each draws its identifiers
 * from a seed of its own, so the two never mint one.
 *
 * A worker in memory serves whichever page a test joins to it, so an
 * application's test connects its own page as the application does; a page of
 * this package's own keeps its records in a log store of its own, admitting
 * Info and above.
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
  FailureKind,
  StandardLayouts,
  createDeterministicIdGenerator,
  fail,
  failure,
  sampleRate,
  type ProjectSettings,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { MemoryStorageTree, countingTokens } from '@audiogubbins/media-store/testing';
import type { StorageTree, YieldToHost } from '@audiogubbins/project-format';
import { MemoryLeaseCoordinator } from '@audiogubbins/storage/testing';

import { PagePorts } from '../client/page-ports.js';
import { storageClientOver, type StorageClient } from '../client/storage-client.js';
import {
  hostServices,
  type HostLogs,
  type HostParts,
  type HostServices,
} from '../host/host-services.js';
import type { CatalogueSource } from '../host/pack-services.js';
import { serveStorage } from '../host/storage-host.js';
import { PortChannel, type PortEndpoint } from '../protocol/port-channel.js';
import { portPair, type PortPair } from './port-pair.js';

/** What a new project is made with in these tests. */
export const SETTINGS: ProjectSettings = {
  sampleRate: expectSuccess(sampleRate(48_000)),
  channelLayout: StandardLayouts.stereo,
};

/** A storage worker in memory, and what a test looks at of it. */
export interface MemoryWorker {
  readonly coordinator: MemoryLeaseCoordinator;

  /** The worker's loggers, for a test to make a record in the worker. */
  readonly hostLogs: HostLogs;

  /** Services over the worker's tree and leases, as another window's (see the module comment). */
  readonly another: HostServices;
}

/** A page served by a storage worker in memory, and what a test looks at. */
export interface MemoryStorage extends MemoryWorker {
  readonly client: StorageClient;
  readonly pair: PortPair;

  /** The records the page's diagnostics kept. */
  readonly logs: LogStore;

  /** How many ports the page has lent the worker now. */
  readonly lentPorts: () => number;
}

/** How the worker in memory is made. */
export interface MemoryStorageOptions {
  /** The tree the worker keeps projects in, where a test watches it. */
  readonly tree?: StorageTree;

  /** The turns the worker's storage paths take: none where not given. */
  readonly yieldToHost?: YieldToHost;

  /** The leases of the profile, where another page shares them. */
  readonly coordinator?: MemoryLeaseCoordinator;

  /**
   * The tab, as other tabs are told of it, and its identifiers' seed: called
   * `the window called <name>` where no label is given.
   */
  readonly tab?: { readonly name: string; readonly seed: number; readonly label?: string };

  /** The clock the worker reads, where the tabs of a test share one: one that steps where not. */
  readonly clock?: Clock;

  /**
   * Where a catalogue's packs come from, in place of the network: where not
   * given, a source that offers nothing and refuses every read, so no test
   * reaches the network by forgetting to say.
   */
  readonly packSource?: CatalogueSource;

  /** The storage estimate the worker reads: none where not given, as a browser may give none. */
  readonly estimate?: HostParts['estimate'];
}

/** Why a catalogue cannot be read in a worker in memory that was given none. */
const NO_CATALOGUE = failure(
  'model-pack.no-test-catalogue',
  FailureKind.Rejected,
  'This storage worker in memory was given no catalogue, and reaches no network.',
);

/** The source a worker in memory reads a catalogue from where a test gives none. */
const NO_PACK_SOURCE: CatalogueSource = () => ({
  catalogue: () => Promise.resolve(fail(NO_CATALOGUE)),
  read: () => Promise.resolve(fail(NO_CATALOGUE)),
});

/** A clock that moves on a second each time it is read. */
export function steppingClock(): Clock {
  let now = 1_790_000_000_000;
  return {
    now: () => {
      now += 1_000;
      return now;
    },
  };
}

/** The parts of a window over shared parts, its identifiers seeded by `seed`. */
function partsOf(
  owner: HostParts['owner'],
  seed: number,
  shared: Pick<HostParts, 'tree' | 'clock' | 'coordinator' | 'yieldToHost' | 'logs'> &
    Partial<Pick<HostParts, 'packSource' | 'estimate'>>,
): HostParts {
  return {
    packSource: NO_PACK_SOURCE,
    estimate: () => Promise.resolve(undefined),
    ...shared,
    digest: webDigest(crypto.subtle),
    ids: createDeterministicIdGenerator(seed),
    nextToken: countingTokens(),
    owner,
    // A snapshot of the bytes the tree holds now, as the browser's file is.
    fileAt: async (path) => {
      const bytes = await shared.tree.readFile(path);
      return bytes === undefined ? undefined : new Blob([bytes]);
    },
  };
}

/** A storage worker in memory, serving the page at the other end of `endpoint`. */
export function serveMemoryStorage(
  endpoint: PortEndpoint,
  options: MemoryStorageOptions = {},
): MemoryWorker {
  const clock = options.clock ?? steppingClock();
  const tree = options.tree ?? new MemoryStorageTree();
  const coordinator = options.coordinator ?? new MemoryLeaseCoordinator();
  const tab = options.tab ?? { name: 'worker', seed: 29 };
  const owner = { instance: tab.name, label: tab.label ?? `the window called ${tab.name}` };
  const yieldToHost = options.yieldToHost ?? (() => Promise.resolve());
  let hostLogs: HostLogs | undefined;
  serveStorage(endpoint, clock, (logs) => {
    hostLogs = logs;
    return partsOf(owner, tab.seed, {
      tree,
      clock,
      coordinator,
      yieldToHost,
      logs,
      ...(options.packSource === undefined ? {} : { packSource: options.packSource }),
      ...(options.estimate === undefined ? {} : { estimate: options.estimate }),
    });
  });
  if (hostLogs === undefined) throw new Error('The worker made its services without loggers.');

  const another = memoryHostServices({
    tree,
    coordinator,
    clock,
    tab: { name: `${tab.name}, another`, seed: tab.seed + 1_000 },
  });
  return { coordinator, hostLogs, another };
}

/**
 * The worker's services over storage in memory, served to no page: another
 * window of the profile, as a test looks into the storage through it.
 */
export function memoryHostServices(
  options: Required<Pick<MemoryStorageOptions, 'tree' | 'coordinator' | 'clock' | 'tab'>>,
): HostServices {
  const { tree, coordinator, clock, tab } = options;
  const owner = { instance: tab.name, label: tab.label ?? `the window called ${tab.name}` };
  return hostServices(
    partsOf(owner, tab.seed, {
      tree,
      clock,
      coordinator,
      yieldToHost: () => Promise.resolve(),
      logs: createDiagnosticCentre(createLogStore(), clock),
    }),
  );
}

/** A storage worker in memory, serving a page's client (see the module comment). */
export function memoryStorage(options: MemoryStorageOptions = {}): MemoryStorage {
  const pair = portPair();
  const clock = options.clock ?? steppingClock();
  const worker = serveMemoryStorage(pair.worker, { ...options, clock });
  const logs = createLogStore();
  const diagnostics = createDiagnosticCentre(logs, clock, {
    defaultSeverity: LogSeverity.Info,
    categoryOverrides: {},
  });
  const ports = new PagePorts();
  const client = storageClientOver(new PortChannel(pair.page), ports, diagnostics);
  const lentPorts = (): number => ports.lent;
  return { ...worker, client, pair, logs, lentPorts };
}
