/**
 * What project storage works with in this browser, made once by the composition
 * root from what the browser offers (ADR-0020, REQ-STOR-021, REQ-STOR-098,
 * REQ-EXEC-216).
 *
 * The tree is the origin-private file system, written by the storage worker;
 * the digest is the browser's SHA-256; identifiers and tokens are drawn from
 * its random numbers; the write leases are Web Locks with a broadcast channel
 * beside them; the media store and the caches sit on the one tree. Each is made
 * here and nowhere else, and every store and command is given them rather than
 * reaching for them (ADR-0011). Where the browser cannot keep projects at all,
 * which needs the private file system, the digest and random numbers, the
 * answer says so, and the Capabilities panel says why; where it lacks only Web
 * Locks, projects open read-only, as the storage decides (REQ-STOR-098).
 */

import {
  FileHandleKeeper,
  createLeaseCoordinator,
  randomTokens,
  startOriginPrivateTree,
  webDigest,
  yieldToHost,
} from '@audiogubbins/browser-storage';
import type { StoragePlatform } from '@audiogubbins/capabilities';
import { createCommandBus, createCommandRegistry, type CommandBus } from '@audiogubbins/commands';
import type { Clock, DiagnosticCentre } from '@audiogubbins/diagnostics';
import { createIdGenerator } from '@audiogubbins/domain';
import { MediaObjectStore, type YieldToHost } from '@audiogubbins/media-store';
import { projectCommands } from '@audiogubbins/project-commands';
import type { ProjectState } from '@audiogubbins/project-format';
import {
  CacheStore,
  MEDIA_DIRECTORY,
  ProjectRepository,
  mediaSharingOf,
  type CleanupRunServices,
  type ImportServices,
  type LeaseCoordinator,
  type LeaseOwner,
  type OpeningServices,
} from '@audiogubbins/storage';

/**
 * Everything the project stores work with: what opening, importing, exporting,
 * backing up and cleaning up each take, which overlap, as one value.
 */
export interface ProjectServices extends OpeningServices, CleanupRunServices, ImportServices {
  readonly repository: ProjectRepository;

  /** Where the handles of linked files are kept, absent where the browser keeps none. */
  readonly keeper: FileHandleKeeper | undefined;
  readonly yieldToHost: YieldToHost;
}

/** Whether this browser can keep projects, and what it keeps them with. */
export type ProjectPlatform =
  | { readonly kind: 'available'; readonly services: ProjectServices }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Why no project can be kept here, pointing at the panel that says which part is missing. */
const CANNOT_KEEP_PROJECTS =
  'This browser cannot keep projects, so none can be made or opened here. The Capabilities panel says why.';

/**
 * How long a question to the other tabs waits for the tab holding a project to
 * say who it is, before that tab is taken to be one that cannot be described.
 */
const OWNER_PATIENCE_MILLISECONDS = 500;

/**
 * How a tab is named to the others: by the time it was opened, to the second,
 * so two tabs opened in one minute are told apart, and written to be read
 * inside a sentence.
 */
const OPENED_AT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Starts the storage worker, which Vite builds as a module of its own. */
function storageWorker(): Worker {
  return new Worker(new URL('./origin-private-tree.worker.ts', import.meta.url), {
    type: 'module',
    name: 'AudioGubbins storage',
  });
}

/**
 * The window's write leases over the browser's locks and channels, absent where
 * the browser has no Web Locks.
 */
function leasesOf(
  platform: StoragePlatform,
  owner: LeaseOwner,
  diagnostics: DiagnosticCentre,
): LeaseCoordinator | undefined {
  return createLeaseCoordinator({
    locks: platform.locks,
    openChannel: platform.openBroadcastChannel,
    instance: owner.instance,
    patience: () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, OWNER_PATIENCE_MILLISECONDS);
      }),
    logger: diagnostics.loggerFor('storage'),
  });
}

/** The bus every change to a project runs through, over the project commands. */
function projectBusOf(diagnostics: DiagnosticCentre): CommandBus<ProjectState> {
  const registry = createCommandRegistry<ProjectState>();
  for (const command of projectCommands()) registry.register(command);
  return createCommandBus(registry, diagnostics.loggerFor('project-commands'));
}

/** Makes what project storage works with, or says why this browser cannot keep projects. */
export function projectPlatformOf(
  platform: StoragePlatform,
  diagnostics: DiagnosticCentre,
  clock: Clock,
): ProjectPlatform {
  const { subtle, randomBytes } = platform;
  if (!platform.originPrivateFileSystem || subtle === undefined || randomBytes === undefined) {
    return { kind: 'unavailable', reason: CANNOT_KEEP_PROJECTS };
  }

  const tree = startOriginPrivateTree(storageWorker);
  const digest = webDigest(subtle);
  const nextToken = randomTokens(randomBytes);
  const ids = createIdGenerator(randomBytes);
  const owner = {
    instance: nextToken(),
    label: `the tab opened at ${OPENED_AT.format(clock.now())}`,
  };
  const coordinator = leasesOf(platform, owner, diagnostics);
  const coordinated = coordinator === undefined ? {} : { coordinator };
  const sharing = mediaSharingOf(coordinator);

  const services: ProjectServices = {
    tree,
    digest,
    clock,
    ids,
    owner,
    bus: projectBusOf(diagnostics),
    logger: diagnostics.loggerFor('projects'),
    store: new MediaObjectStore({ tree, root: MEDIA_DIRECTORY, digest, nextToken, sharing }),
    caches: new CacheStore(tree, digest),
    repository: new ProjectRepository({ tree, digest, clock, ids, owner, ...coordinated }),
    keeper:
      platform.indexedDb === undefined
        ? undefined
        : new FileHandleKeeper(platform.indexedDb, nextToken),
    yieldToHost: yieldToHost(platform.hostYielding),
    ...coordinated,
  };
  return { kind: 'available', services };
}
