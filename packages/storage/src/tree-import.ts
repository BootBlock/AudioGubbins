/**
 * Bringing a project in from its tree, read from a bundle or an unpacked
 * directory: as itself, or as a copy under a new identity (REQ-STOR-103,
 * REQ-STOR-099, REQ-STOR-052, REQ-EXEC-136.15).
 *
 * Everything that can be checked without reading its kept states is checked
 * first: the tree was read whole and valid, it carries every piece of media its
 * state refers to, its caches are ones this build keeps, and its history is one
 * the history package accepts. A history may keep more states than fit in
 * memory (REQ-EXEC-216), so each kept state is checked as it is read to be
 * written, one at a time, and refused where it refers to media the tree does
 * not carry. A project brought in as itself keeps its identity, so a project
 * that goes to a repository and back is the same project with the same files;
 * one of an identity the storage already holds, or a window is bringing in, is
 * refused as itself, and comes in as a copy under a new identity where the
 * caller allows either, decided once the tree is read, so it is read once
 * whichever it becomes. Media goes through the store, which keeps each object
 * once however many projects hold it, and each object must be the one the tree
 * names. The project is written as a new project is (`project-creation.ts`),
 * under its write lease, and records where it came from. A failure part-way
 * removes what was written of the project, and a crash leaves it unfinished,
 * never listed; media stored for it and never referenced is left for a purge to
 * find.
 */

import type { Clock } from '@audiogubbins/diagnostics';
import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
  type IdGenerator,
  type ProjectId,
} from '@audiogubbins/domain';
import { contentReferencedBy, type MediaObjectStore } from '@audiogubbins/media-store';
import {
  Turns,
  projectTree,
  stateFingerprintOf,
  type ContentId,
  type Digest,
  type InvocationProvenance,
  type ProjectState,
  type ProjectTreeContent,
  type ProjectTreeFile,
  type StorageTree,
  type TreeFileBody,
  type TreeStates,
  type YieldToHost,
} from '@audiogubbins/project-format';

import { cacheKeyOf, type CacheScope, type CacheStore } from './cache-store.js';
import { begunHistory, writeProject, type ProjectContents } from './project-creation.js';
import { claimFor, type ImportIdentity, type ImportedProject } from './import-claim.js';
import { movedHistory, stateOf } from './project-identity.js';
import { noCoordination, refusalsReported } from './storage-failures.js';
import type { UnprovedBodies } from './tree-bodies.js';
import type { LeaseCoordinator, LeaseOwner } from './write-lease.js';

/** What bringing a project in works with, each made once by the composition root. */
export interface ImportServices {
  readonly tree: StorageTree;
  readonly digest: Digest;

  /**
   * Which arguments of a change hold provenance, as the command layer
   * declares, to hold a history kept at less than all of it to its level.
   */
  readonly invocationProvenance: InvocationProvenance;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;
  readonly owner: LeaseOwner;

  /** Asked through work over records or bytes held in memory. */
  readonly yieldToHost: YieldToHost;
}

/** Brings a project in from its tree, whose media and caches `open` reads. */
export async function importTree(
  content: ProjectTreeContent,
  open: UnprovedBodies,
  identity: ImportIdentity,
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ImportedProject>> {
  const checked = selfContained(content);
  if (!checked.ok) return checked;
  const { coordinator } = services;
  if (coordinator === undefined) return fail(noCoordination());
  const from = content.state.project.id;
  const claimed = await claimFor(from, identity, coordinator, services);
  if (!claimed.ok) return claimed;
  const { files, lease, asCopy } = claimed.value;
  const { project } = files;
  const held: ContentId[] = [];
  try {
    const at = services.clock.now();
    const turns = new Turns(services.yieldToHost, signal);
    const contents = await contentsOf(content, project, at, services);
    if (!contents.ok) return contents;
    const written = await refusalsReported(async () => {
      const brought = await bringBodies(content, project, open, held, services, signal);
      if (!brought.ok) return brought;
      const imported = { from, at };
      return await writeProject(
        files,
        { ...contents.value, imported },
        { ids: services.ids, turns, coordinator },
      );
    });
    // A designed failure leaves nothing of the project behind; a crash, which
    // rejects, leaves it unfinished, for cleanup or the next import to remove.
    if (!written.ok) {
      await services.tree.remove(files.paths.directory);
      return written;
    }
    return succeed({ header: written.value, asCopy });
  } finally {
    for (const contentId of held) services.store.release(contentId);
    await lease.release();
  }
}

/**
 * Why each cache the tree carries cannot be kept: one this build does not
 * keep, or one made from neither the project nor the media the tree carries.
 */
function cacheProblems(
  content: ProjectTreeContent,
  carried: ReadonlySet<ContentId>,
): readonly DomainFailure[] {
  const project = content.state.project.id;
  const problems: DomainFailure[] = [];
  for (const { path } of content.caches ?? []) {
    const key = cacheKeyOf(path);
    if (key === undefined) {
      problems.push(
        failure(
          'storage.bundle-cache-unknown',
          FailureKind.IntegrityViolation,
          'The project carries a cache this version does not keep.',
          { details: { cache: path } },
        ),
      );
      continue;
    }
    // Kept as it is, a cache made from something else would stand in the
    // storage as though derived from what the storage holds.
    const { scope } = key;
    const derived =
      (scope.kind === 'project' && scope.project === project) ||
      (scope.kind === 'media' && carried.has(scope.content));
    if (!derived) {
      problems.push(
        failure(
          'storage.bundle-cache-foreign',
          FailureKind.IntegrityViolation,
          'The project carries a cache made from neither the project nor the media it carries.',
          { details: { cache: path } },
        ),
      );
    }
  }
  return problems;
}

/**
 * Whether the tree carries every piece of media its state refers to, and only
 * caches this build keeps, made from the project or from media it carries.
 */
function selfContained(content: ProjectTreeContent): DomainResult<void> {
  const carried = carriedBy(content);
  const problems = [...uncarried(content.state, carried), ...cacheProblems(content, carried)];
  const [first, ...rest] = problems;
  return first === undefined ? succeed(undefined) : fail(first, ...rest);
}

/** The media a tree carries. */
function carriedBy(content: ProjectTreeContent): ReadonlySet<ContentId> {
  return new Set(content.media.map(({ contentId }) => contentId));
}

/** Why a state refers to media the tree does not carry, for each piece it lacks. */
function uncarried(state: ProjectState, carried: ReadonlySet<ContentId>): DomainFailure[] {
  return [...contentReferencedBy(state)]
    .filter((contentId) => !carried.has(contentId))
    .map((contentId) =>
      failure(
        'storage.bundle-media-missing',
        FailureKind.IntegrityViolation,
        'The project refers to media it does not carry.',
        { details: { content: contentId } },
      ),
    );
}

/** The kept states, each refused as it is read where it refers to media the tree does not carry. */
function carriedStates(states: TreeStates, carried: ReadonlySet<ContentId>): TreeStates {
  return {
    fingerprints: states.fingerprints,
    load: async (fingerprint, signal) => {
      const state = await states.load(fingerprint, signal);
      if (!state.ok || state.value === undefined) return state;
      const [first, ...rest] = uncarried(state.value, carried);
      return first === undefined ? state : fail(first, ...rest);
    },
  };
}

/**
 * What the project is written with, as the project `project` holds it, its
 * history accepted before anything is written.
 */
async function contentsOf(
  content: ProjectTreeContent,
  project: ProjectId,
  at: number,
  services: ImportServices,
): Promise<DomainResult<Omit<ProjectContents, 'imported'>>> {
  const { scope } = content;
  const state = stateOf(content.state, project);
  let written: Pick<ProjectContents, 'history' | 'kept' | 'retention'>;
  if (scope.kind === 'history') {
    const kept = carriedStates(scope.history.states, carriedBy(content));
    const moved = movedHistory(scope.history, project, kept);
    if (!moved.ok) return moved;
    written = { ...moved.value, retention: scope.history.retention };
  } else {
    written = begunHistory(
      {
        project,
        origin: { kind: 'import' },
        at,
        stateFingerprint: await stateFingerprintOf(state, services.digest),
      },
      services.ids,
    );
  }
  return succeed({
    state,
    ...written,
    exports: content.exports,
    backup: content.backup,
    ...(scope.kind === 'history' && scope.history.comparison !== undefined
      ? { comparison: scope.history.comparison }
      : {}),
    created: at,
  });
}

/**
 * Keeps the tree's media in the store and its caches in the cache store, each
 * read from where the tree was. The identity of each object stored is held in
 * `held` until the project that refers to it is written.
 */
async function bringBodies(
  content: ProjectTreeContent,
  project: ProjectId,
  open: UnprovedBodies,
  held: ContentId[],
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  const from = content.state.project.id;
  for (const file of projectTree(content)) {
    const { body } = file;
    if (body.kind === 'text') continue;
    const brought =
      body.kind === 'media'
        ? await bringMedia(file, body.contentId, open, held, services, signal)
        : await bringCache(file, body, { from, project }, open, services, signal);
    if (!brought.ok) return brought;
  }
  return succeed(undefined);
}

/**
 * Keeps a piece of the tree's media in the store under the identity its name
 * says, which the store proves as it writes it, or by hashing the object it
 * holds already without reading the tree's at all.
 */
async function bringMedia(
  file: ProjectTreeFile,
  named: ContentId,
  open: UnprovedBodies,
  held: ContentId[],
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  const opened = await open(file, signal);
  if (!opened.ok) return opened;
  const stored = await services.store.putNamed(
    opened.value.unproved,
    named,
    signal === undefined ? {} : { signal },
  );
  if (!stored.ok) return stored;
  held.push(stored.value.contentId);
  return succeed(undefined);
}

/**
 * Keeps a cache the tree carries, refused where its bytes are not the ones the
 * tree's index lists: one derived from the project under the identity the
 * project is kept under, and one derived from media only where the storage
 * keeps none under its key. Media is shared, and so are its caches: one the
 * storage made serves every project holding the media, and one brought in
 * never replaces it.
 */
async function bringCache(
  file: ProjectTreeFile,
  body: Extract<TreeFileBody, { readonly kind: 'cache' }>,
  identity: { readonly from: ProjectId; readonly project: ProjectId },
  open: UnprovedBodies,
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  // A cache of no key this build keeps was refused before anything was written.
  const key = cacheKeyOf(body.path);
  if (key === undefined) return succeed(undefined);
  if (key.scope.kind === 'media') {
    const kept = await services.caches.holds(key, signal);
    if (!kept.ok || kept.value) return kept.ok ? succeed(undefined) : kept;
  }
  const scope: CacheScope =
    key.scope.kind === 'project' && key.scope.project === identity.from
      ? { kind: 'project', project: identity.project }
      : key.scope;
  const opened = await open(file, signal);
  if (!opened.ok) return opened;
  return await services.caches.putListed(
    { ...key, scope },
    opened.value.unproved,
    body.contentId,
    signal,
  );
}
