/**
 * Claiming the identity a project brought in from a bundle or a tree is kept
 * under: its own, a new one for a copy, or its own where that is free and a new
 * one where it is taken (REQ-STOR-103, REQ-STOR-199).
 *
 * An identity is claimed under the project's write lease, so two windows never
 * bring a project in under one identity, and its place is made free first: a
 * project whose making or purge a crash cut short is removed, since nothing
 * refers to it. An identity a project the storage holds has, or one another
 * window holds the lease of, is taken; the person may then have the project as
 * a copy, which the caller allows by asking for either.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainFailureResult,
  type DomainResult,
  type IdGenerator,
  type ProjectId,
} from '@audiogubbins/domain';
import type { Digest, StorageTree } from '@audiogubbins/project-format';

import { CheckedRecords } from './checked-records.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectHeader } from './project-header.js';
import { leftOverOf, removeLeftOver } from './project-leftovers.js';
import { leaseRefused, refusalsReported } from './storage-failures.js';
import type { LeaseCoordinator, LeaseOwner, ProjectWriteLease } from './write-lease.js';

/**
 * Whether a project is brought in as itself, as a copy under a new identity, or
 * as itself where its identity is free and as a copy where it is taken.
 */
export type ImportIdentity = 'original' | 'copy' | 'original-or-copy';

/** A project brought in, and whether it came in as a copy. */
export interface ImportedProject {
  readonly header: ProjectHeader;
  readonly asCopy: boolean;
}

/** An identity claimed: the project's files, and the lease they are written under. */
interface Claimed {
  readonly files: ProjectFiles;
  readonly lease: ProjectWriteLease;
  readonly asCopy: boolean;
}

/**
 * What claiming an identity came to: claimed, taken already by a project the
 * storage holds or a window bringing it in, or refused for another reason.
 */
type Claim =
  | { readonly kind: 'claimed'; readonly claimed: Claimed }
  | { readonly kind: 'taken'; readonly why: DomainFailure }
  | { readonly kind: 'refused'; readonly why: DomainFailureResult };

/** What claiming an identity works with. */
interface ClaimServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly ids: IdGenerator;
  readonly owner: LeaseOwner;
}

/** Claims the identity the project is kept under, as `identity` allows. */
export async function claimFor(
  from: ProjectId,
  identity: ImportIdentity,
  coordinator: LeaseCoordinator,
  services: ClaimServices,
): Promise<DomainResult<Claimed>> {
  if (identity !== 'copy') {
    const own = await claim(from, false, coordinator, services);
    if (own.kind === 'claimed') return succeed(own.claimed);
    if (own.kind === 'refused') return own.why;
    if (identity === 'original') return fail(own.why);
  }
  const copy = await claim(services.ids.next<'ProjectId'>(), true, coordinator, services);
  switch (copy.kind) {
    case 'claimed':
      return succeed(copy.claimed);
    case 'taken':
      return fail(copy.why);
    case 'refused':
      return copy.why;
  }
}

/**
 * Claims `project` under its write lease and makes its place free: a project
 * whose making or purge was cut short is removed, and one that is there is
 * taken, since it may only be brought in again as a copy.
 */
async function claim(
  project: ProjectId,
  asCopy: boolean,
  coordinator: LeaseCoordinator,
  services: ClaimServices,
): Promise<Claim> {
  const acquired = await coordinator.acquire(project, { steal: false, owner: services.owner });
  if (acquired.kind !== 'held') {
    const why = leaseRefused(acquired, project);
    return acquired.kind === 'busy' ? { kind: 'taken', why } : { kind: 'refused', why: fail(why) };
  }
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), project);
  let claimed = false;
  try {
    const free = await refusalsReported(async () => succeed(await isFree(files)));
    if (!free.ok) return { kind: 'refused', why: free };
    if (!free.value) return { kind: 'taken', why: projectExists(project) };
    claimed = true;
    return { kind: 'claimed', claimed: { files, lease: acquired.lease, asCopy } };
  } finally {
    if (!claimed) await acquired.lease.release();
  }
}

/** Whether the project's place is free, once what a crash left of a project there is removed. */
async function isFree(files: ProjectFiles): Promise<boolean> {
  const tree = files.records.tree;
  if ((await tree.list(files.paths.directory)).length === 0) return true;
  const leftOver = await leftOverOf(files);
  if (leftOver === undefined) return false;
  await removeLeftOver(files, leftOver);
  return true;
}

function projectExists(project: ProjectId): DomainFailure {
  return failure(
    'storage.project-exists',
    FailureKind.Conflict,
    'The storage already holds this project; it can be brought in as a copy.',
    { details: { project } },
  );
}
