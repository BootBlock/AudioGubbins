/**
 * What the storage worker keeps projects with, made once from the parts its
 * platform gives and handed to every area that serves the page (ADR-0022).
 *
 * The parts are what differ between the browser and a test: the tree, the
 * digest, the clock, identifiers and tokens, the window as others are told of
 * it, the leases, the turns and the loggers. Everything made from them is made
 * here alone, for both, so a test runs the worker's own composition over parts
 * in memory. Every storage path works through a tree that takes turns
 * (`host-turns.ts`).
 */

import { createCommandBus, createCommandRegistry } from '@audiogubbins/commands';
import type { Clock, Logger } from '@audiogubbins/diagnostics';
import type { IdGenerator } from '@audiogubbins/domain';
import { MediaObjectStore } from '@audiogubbins/media-store';
import { projectCommands } from '@audiogubbins/project-commands';
import type { Digest, ProjectState, StorageTree, YieldToHost } from '@audiogubbins/project-format';
import {
  CacheStore,
  MEDIA_DIRECTORY,
  ProjectRepository,
  mediaSharingOf,
  type CleanupRunServices,
  type LeaseCoordinator,
  type LeaseOwner,
  type OpeningServices,
} from '@audiogubbins/storage';

import { TurnTakingTree } from './host-turns.js';

/** Where the worker's loggers come from: a logger for each subsystem. */
export interface HostLogs {
  loggerFor(category: string): Logger;
}

/** What the worker's services are made from (see the module comment). */
export interface HostParts {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly clock: Clock;
  readonly ids: IdGenerator;

  /** Tokens no other window draws, which name stored objects as they are written. */
  readonly nextToken: () => string;
  readonly owner: LeaseOwner;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator: LeaseCoordinator | undefined;

  /** A turn given to the worker's host, which every storage path takes between operations. */
  readonly yieldToHost: YieldToHost;
  readonly logs: HostLogs;
}

/** Everything the areas serving the page work with, each made once. */
export interface HostServices extends OpeningServices, CleanupRunServices {
  readonly repository: ProjectRepository;
}

/** The services made from their parts (see the module comment). */
export function hostServices(parts: HostParts): HostServices {
  const { digest, clock, ids, owner, coordinator, nextToken, logs } = parts;
  const tree = new TurnTakingTree(parts.tree, parts.yieldToHost);
  const coordinated = coordinator === undefined ? {} : { coordinator };
  const registry = createCommandRegistry<ProjectState>();
  for (const command of projectCommands()) registry.register(command);
  return {
    tree,
    digest,
    clock,
    ids,
    owner,
    bus: createCommandBus(registry, logs.loggerFor('project-commands')),
    logger: logs.loggerFor('projects'),
    store: new MediaObjectStore({
      tree,
      root: MEDIA_DIRECTORY,
      digest,
      nextToken,
      sharing: mediaSharingOf(coordinator),
    }),
    caches: new CacheStore(tree, digest),
    repository: new ProjectRepository({
      tree,
      digest,
      clock,
      ids,
      owner,
      yieldToHost: parts.yieldToHost,
      ...coordinated,
    }),
    yieldToHost: parts.yieldToHost,
    ...coordinated,
  };
}
