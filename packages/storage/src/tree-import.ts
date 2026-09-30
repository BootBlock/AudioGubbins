/**
 * Bringing a project in from its tree, read from a bundle or an unpacked
 * directory: as itself, or as a copy under a new identity (REQ-STOR-103,
 * REQ-STOR-099, REQ-STOR-052, REQ-EXEC-136.15).
 *
 * Everything that can be checked without writing is checked first: the tree was
 * read whole and valid, it carries every piece of media its states refer to,
 * its caches are ones this build keeps, and its history is one the history
 * package accepts. A project brought in as itself keeps its identity, so a
 * project that goes to a repository and back is the same project with the same
 * files; one of an identity the storage already holds is refused, and the
 * person may bring it in as a copy instead. Media goes through the store, which
 * keeps each object once however many projects hold it, and each object must be
 * the one the tree names. The project is written as a new project is
 * (`project-creation.ts`), under its write lease, and records where it came
 * from. A failure part-way removes what was written of the project, and a crash
 * leaves it unfinished, never listed; media stored for it and never referenced
 * is left for a purge to find.
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
import { historyFromRecord, startHistory, type History } from '@audiogubbins/history';
import { contentReferencedBy, type MediaObjectStore } from '@audiogubbins/media-store';
import {
  DEFAULT_RETENTION_POLICY,
  projectTree,
  stateFingerprintOf,
  type ContentId,
  type Digest,
  type ProjectTreeContent,
  type StorageTree,
} from '@audiogubbins/project-format';

import type { BodyOpener } from './bundle-writing.js';
import { cacheKeyOf, type CacheStore } from './cache-store.js';
import { CheckedRecords } from './checked-records.js';
import { readPair } from './generational-pair.js';
import { writeProject, type ProjectContents } from './project-creation.js';
import { ProjectFiles } from './project-files.js';
import type { ProjectHeader } from './project-header.js';
import { contentAs } from './project-identity.js';
import { leaseRefused, noCoordination, refusalsReported } from './storage-failures.js';
import type { LeaseCoordinator, LeaseOwner } from './write-lease.js';

/** Whether a project is brought in as itself or as a copy under a new identity. */
export type ImportIdentity = 'original' | 'copy';

/** What bringing a project in works with, each made once by the composition root. */
export interface ImportServices {
  readonly tree: StorageTree;
  readonly digest: Digest;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;

  /** The platform's lease coordination, absent where it has none. */
  readonly coordinator?: LeaseCoordinator;
  readonly owner: LeaseOwner;
}

/** Brings a project in from its tree, whose media and caches `open` reads. */
export async function importTree(
  content: ProjectTreeContent,
  open: BodyOpener,
  identity: ImportIdentity,
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<ProjectHeader>> {
  const checked = selfContained(content);
  if (!checked.ok) return checked;
  const from = content.state.project.id;
  const project = identity === 'copy' ? services.ids.next<'ProjectId'>() : from;
  const at = services.clock.now();
  const contents = await contentsOf(
    await contentAs(content, project, services.digest),
    at,
    services,
  );
  if (!contents.ok) return contents;

  const { coordinator, owner } = services;
  if (coordinator === undefined) return fail(noCoordination());
  const acquired = await coordinator.acquire(project, { steal: false, owner });
  if (acquired.kind !== 'held') return fail(leaseRefused(acquired, project));
  const held: ContentId[] = [];
  const files = new ProjectFiles(new CheckedRecords(services.tree, services.digest), project);
  try {
    const free = await refusalsReported(async () => await madeFree(files));
    if (!free.ok) return free;
    const written = await refusalsReported(async () => {
      const brought = await bringBodies(content, project, open, held, services, signal);
      if (!brought.ok) return brought;
      const imported = { from, at };
      return await writeProject(files, { ...contents.value, imported }, services.ids, signal);
    });
    // A designed failure leaves nothing of the project behind; a crash, which
    // rejects, leaves it unfinished, for cleanup or the next import to remove.
    if (!written.ok) await services.tree.remove(files.paths.directory);
    return written;
  } finally {
    for (const contentId of held) services.store.release(contentId);
    await acquired.lease.release();
  }
}

/**
 * Makes the project's place free, under its lease: a project whose making was
 * cut short is removed, and one that is there is refused, since it may only be
 * brought in again as a copy.
 */
async function madeFree(files: ProjectFiles): Promise<DomainResult<void>> {
  const tree = files.records.tree;
  if ((await tree.list(files.paths.directory)).length === 0) return succeed(undefined);
  const header = await readPair(files.records, files.header);
  if (header.valid.length === 0 && (await files.isUnfinished())) {
    await tree.remove(files.paths.directory);
    return succeed(undefined);
  }
  return fail(
    failure(
      'storage.project-exists',
      FailureKind.Conflict,
      'The storage already holds this project; it can be brought in as a copy.',
      { details: { project: files.project } },
    ),
  );
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
 * Whether the tree carries every piece of media its states refer to, and only
 * caches this build keeps, made from the project or from media it carries.
 */
function selfContained(content: ProjectTreeContent): DomainResult<void> {
  const carried = new Set(content.media.map(({ contentId }) => contentId));
  const states = [
    content.state,
    ...(content.scope.kind === 'history' ? content.scope.history.states.values() : []),
  ];
  const problems: DomainFailure[] = [];
  for (const contentId of new Set(states.flatMap((state) => [...contentReferencedBy(state)]))) {
    if (!carried.has(contentId)) {
      problems.push(
        failure(
          'storage.bundle-media-missing',
          FailureKind.IntegrityViolation,
          'The project refers to media it does not carry.',
          { details: { content: contentId } },
        ),
      );
    }
  }
  problems.push(...cacheProblems(content, carried));
  const [first, ...rest] = problems;
  return first === undefined ? succeed(undefined) : fail(first, ...rest);
}

/** What the project is written with, its history accepted before anything is written. */
async function contentsOf(
  content: ProjectTreeContent,
  at: number,
  services: ImportServices,
): Promise<DomainResult<Omit<ProjectContents, 'imported'>>> {
  const { state, scope } = content;
  let history: History;
  if (scope.kind === 'history') {
    const read = historyFromRecord(scope.history.record);
    if (!read.ok) return read;
    history = read.value;
  } else {
    history = startHistory(state.project.id, {
      kind: 'origin',
      id: services.ids.next<'HistoryNodeId'>(),
      at,
      origin: { kind: 'import' },
      stateFingerprint: await stateFingerprintOf(state, services.digest),
    });
  }
  return succeed({
    state,
    history,
    kept: scope.kind === 'history' ? scope.history.states : new Map(),
    exports: content.exports,
    retention: scope.kind === 'history' ? scope.history.retention : DEFAULT_RETENTION_POLICY,
    backup: content.backup,
    ...(scope.kind === 'history' && scope.history.comparison !== undefined
      ? { comparison: scope.history.comparison }
      : {}),
    created: at,
  });
}

/**
 * Keeps the tree's media in the store and its caches in the cache store, each
 * read from where the tree was, and a cache derived from the project under the
 * identity the project is kept under. The identity of each object stored is
 * held in `held` until the project that refers to it is written.
 */
async function bringBodies(
  content: ProjectTreeContent,
  project: ProjectId,
  open: BodyOpener,
  held: ContentId[],
  services: ImportServices,
  signal?: AbortSignal,
): Promise<DomainResult<void>> {
  const from = content.state.project.id;
  for (const file of projectTree(content)) {
    const { body } = file;
    if (body.kind === 'text') continue;
    const source = await open(file, signal);
    if (!source.ok) return source;
    if (body.kind === 'media') {
      const stored = await services.store.put(source.value, signal === undefined ? {} : { signal });
      if (!stored.ok) return stored;
      held.push(stored.value.contentId);
      if (stored.value.contentId !== body.contentId) return fail(mediaNotNamed(file.path));
      continue;
    }
    const key = cacheKeyOf(body.path);
    if (key === undefined) continue;
    const scope =
      key.scope.kind === 'project' && key.scope.project === from
        ? { kind: 'project' as const, project }
        : key.scope;
    const kept = await services.caches.put({ ...key, scope }, source.value, signal);
    if (!kept.ok) return kept;
  }
  return succeed(undefined);
}

function mediaNotNamed(path: string): DomainFailure {
  return failure(
    'storage.media-damaged',
    FailureKind.IntegrityViolation,
    'A media file is not the media its name says it is.',
    { details: { file: path } },
  );
}
