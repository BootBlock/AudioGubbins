/**
 * The services a test of kept projects runs with, made the same way on every
 * run: a deterministic clock and identifiers shared by every window of the
 * test, so no two sessions mint one identifier; the test commands' bus; the
 * digest the caller hashes with; and windows that share one coordinator.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  StandardLayouts,
  createDeterministicIdGenerator,
  sampleRate,
  type IdGenerator,
  type ProjectId,
  type ProjectSettings,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { Digest, StorageTree } from '@audiogubbins/project-format';

import { ProjectRepository } from '../project-catalogue.js';
import type { ProjectHeader } from '../project-header.js';
import { openProject, type OpeningServices, type OpenedProject } from '../project-opening.js';
import type { ProjectSession } from '../project-session.js';
import type { SessionCadence } from '../session-contracts.js';
import type { LeaseCoordinator, LeaseOwner } from '../write-lease.js';
import { MemoryLeaseCoordinator } from './memory-leases.js';
import { silentLogger } from './silent-logger.js';
import { testBus } from './test-commands.js';

/** The first moment of a test, in milliseconds since the epoch. */
const EPOCH = 1_790_000_000_000;

export const SETTINGS: ProjectSettings = {
  sampleRate: expectSuccess(sampleRate(48_000)),
  channelLayout: StandardLayouts.stereo,
};

export const WINDOW_A: LeaseOwner = { instance: 'window-a', label: 'Window A' };
export const WINDOW_B: LeaseOwner = { instance: 'window-b', label: 'Window B' };

/** A clock that moves on a second each time it is read. */
function steppingClock(): Clock {
  let now = EPOCH;
  return {
    now: () => {
      now += 1_000;
      return now;
    },
  };
}

/** What one test's windows share. */
export interface Harness {
  readonly digest: Digest;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly coordinator: MemoryLeaseCoordinator;

  /** The services one window opens projects with, over a tree. */
  services(
    tree: StorageTree,
    options?: {
      readonly owner?: LeaseOwner;
      readonly cadence?: SessionCadence;
      readonly coordinator?: LeaseCoordinator | 'none';
    },
  ): OpeningServices;

  /** The catalogue over a tree, as window A. */
  repository(tree: StorageTree): ProjectRepository;
}

/** A harness hashing with `digest`, whose identifiers come from `seed`. */
export function harnessOver(digest: Digest, seed = 11): Harness {
  const clock = steppingClock();
  const ids = createDeterministicIdGenerator(seed);
  const coordinator = new MemoryLeaseCoordinator();
  const bus = testBus();
  const logger = silentLogger();
  return {
    digest,
    clock,
    ids,
    coordinator,
    services: (tree, options = {}) => {
      const chosen = options.coordinator ?? coordinator;
      return {
        tree,
        digest,
        bus,
        clock,
        ids,
        logger,
        owner: options.owner ?? WINDOW_A,
        ...(chosen === 'none' ? {} : { coordinator: chosen }),
        ...(options.cadence === undefined ? {} : { cadence: options.cadence }),
      };
    },
    repository: (tree) =>
      new ProjectRepository({ tree, digest, clock, ids, coordinator, owner: WINDOW_A }),
  };
}

/** Makes a project named `name` and gives its header, or throws. */
export async function madeProject(
  test: Harness,
  tree: StorageTree,
  name = 'Forest walk',
): Promise<ProjectHeader> {
  return expectSuccess(await test.repository(tree).create({ name, settings: SETTINGS }));
}

/** Opens a project to write and gives the session, or throws naming what opened instead. */
export function writable(opened: OpenedProject): ProjectSession {
  if (opened.kind !== 'writable')
    throw new Error(`Expected a writable project; it opened ${opened.kind}.`);
  return opened.session;
}

/** Opens a project to write through a harness window, or throws. */
export async function openToWrite(
  test: Harness,
  tree: StorageTree,
  project: ProjectId,
  options?: Parameters<Harness['services']>[1],
): Promise<ProjectSession> {
  return writable(
    expectSuccess(await openProject({ project, access: 'write' }, test.services(tree, options))),
  );
}
