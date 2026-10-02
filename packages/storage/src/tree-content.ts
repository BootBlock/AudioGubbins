/**
 * A copied project as the files of its unpacked tree, with every piece of media
 * it needs, whatever other projects share it (REQ-STOR-099, REQ-STOR-103,
 * REQ-STOR-166, REQ-STOR-027).
 *
 * Deduplication never keeps a project from travelling whole: the tree carries
 * every managed object its state refers to, and for a whole history every
 * object its kept states refer to and every one its changes name that the store
 * holds, so undo and redo work where it is opened. A tree of the state alone
 * keeps provenance at the level the person chose; a whole history keeps all of
 * it, since its changes carry the provenance they were made with. The caches go
 * only where asked for, and only those derived from the project or from media
 * it carries. An asset linked to a file outside the storage, with no copy the
 * store keeps, cannot travel as bytes and is reported, so the person can
 * consolidate first.
 */

import {
  FailureKind,
  fail,
  failure,
  mapResult,
  succeed,
  type AssetId,
  type DomainResult,
} from '@audiogubbins/domain';
import { historyRecordOf } from '@audiogubbins/history';
import { contentReferencedBy, type MediaObjectStore } from '@audiogubbins/media-store';
import {
  projectTree,
  writeHistoryRecord,
  type ContentId,
  type Digest,
  type ProjectState,
  type ProjectTreeContent,
  type ProjectTreeFile,
  type ProvenanceLevel,
  type StateFingerprint,
  type TreeCache,
  type TreeMedia,
} from '@audiogubbins/project-format';

import type { BodyOpener } from './bundle-writing.js';
import { bytesSource } from './byte-streams.js';
import { CACHE_CLEANUP_ORDER, cacheKeyOf, cachePathOf, type CacheStore } from './cache-store.js';
import { choiceOf } from './comparison-record.js';
import { contentIdsIn } from './content-references.js';
import { offeredStates, type ProjectCopy } from './project-copy.js';
import { provedMedia } from './proved-media.js';
import { refusalsReported } from './storage-failures.js';

/**
 * How much of a project a bundle or tree holds: the whole history, with full
 * provenance, or the state alone at the provenance level chosen.
 */
export type BundleScope =
  | { readonly kind: 'whole-history' }
  | { readonly kind: 'current-state'; readonly provenance: ProvenanceLevel };

/** What a bundle or tree of a project holds. */
export interface CopyOptions {
  readonly scope: BundleScope;

  /** Whether the project's caches go with it. */
  readonly includeCaches: boolean;
}

/** Where a tree's media and caches are read from. */
export interface TreeSources {
  readonly store: MediaObjectStore;
  readonly caches: CacheStore;

  /** What media read out of the store is proved with as it is read. */
  readonly digest: Digest;
}

/** A project's tree, and what of it could not travel as bytes. */
interface CopiedTree {
  readonly files: readonly ProjectTreeFile[];

  /** Assets linked to files outside the storage, with no copy the store keeps. */
  readonly linked: readonly AssetId[];
}

/** The tree of a copied project (see the module comment). */
export async function treeOfCopy(
  copy: ProjectCopy,
  options: CopyOptions,
  sources: TreeSources,
  signal?: AbortSignal,
): Promise<DomainResult<CopiedTree>> {
  const { model } = copy;
  const required = new Set(contentReferencedBy(model.state));
  const wanted = new Set<ContentId>();
  let content: Omit<ProjectTreeContent, 'media' | 'caches'>;
  if (options.scope.kind === 'whole-history') {
    const states = await loadedStatesOf(copy, signal);
    if (!states.ok) return states;
    for (const state of states.value.values()) {
      for (const each of contentReferencedBy(state)) required.add(each);
    }
    const record = historyRecordOf(model.history);
    for (const each of contentIdsIn(writeHistoryRecord(record))) wanted.add(each);
    content = {
      state: model.state,
      scope: {
        kind: 'history',
        history: {
          record,
          retention: model.retention,
          states: states.value,
          ...(model.comparison === undefined ? {} : { comparison: choiceOf(model.comparison) }),
        },
      },
      exports: model.exports,
      backup: model.backup,
    };
  } else {
    const { provenance } = options.scope;
    content = {
      state: model.state,
      scope: { kind: 'state', provenance },
      exports: model.exports,
      backup: model.backup,
    };
  }

  const media = await mediaOf(sources.store, required, wanted);
  if (!media.ok) return media;
  const caches = options.includeCaches
    ? await cachesOf(copy, new Set(media.value.map(({ contentId }) => contentId)), sources, signal)
    : undefined;
  if (caches !== undefined && !caches.ok) return caches;
  const files = projectTree({
    ...content,
    media: media.value,
    ...(caches === undefined ? {} : { caches: caches.value }),
  });
  return mapResult(files, (written) => ({ files: written, linked: linkedAssets(model.state) }));
}

/**
 * Every state the history keeps that can be read. A snapshot's state that
 * cannot be read fails the copy, since a restore point would be lost; any other
 * is left out, and the history reaches its node by replay instead.
 */
export async function loadedStatesOf(
  copy: ProjectCopy,
  signal?: AbortSignal,
): Promise<DomainResult<ReadonlyMap<StateFingerprint, ProjectState>>> {
  const snapshotted = new Set(
    [...copy.model.history.snapshots.values()].map((snapshot) => snapshot.stateFingerprint),
  );
  const states = new Map<StateFingerprint, ProjectState>();
  for (const fingerprint of offeredStates(copy)) {
    const state = await copy.states.load(fingerprint, signal);
    if (state.ok) states.set(fingerprint, state.value);
    else if (snapshotted.has(fingerprint)) return state;
  }
  for (const fingerprint of snapshotted) {
    if (!states.has(fingerprint)) {
      return fail(
        failure(
          'storage.snapshot-state-missing',
          FailureKind.IntegrityViolation,
          'A snapshot’s state is not kept, so the project cannot be copied whole.',
          { details: { state: fingerprint } },
        ),
      );
    }
  }
  return succeed(states);
}

/** The objects a tree carries: every one required, and those wanted that the store holds. */
async function mediaOf(
  store: MediaObjectStore,
  required: ReadonlySet<ContentId>,
  wanted: ReadonlySet<ContentId>,
): Promise<DomainResult<readonly TreeMedia[]>> {
  const media: TreeMedia[] = [];
  for (const contentId of new Set([...required, ...wanted])) {
    const found = await store.find(contentId);
    if (!found.ok) return found;
    if (found.value !== undefined) media.push(found.value);
    else if (required.has(contentId)) {
      return fail(
        failure(
          'storage.media-missing',
          FailureKind.IntegrityViolation,
          'Media the project refers to is not in the store, so the project cannot be copied whole.',
          { details: { content: contentId } },
        ),
      );
    }
  }
  return succeed(media);
}

/**
 * The caches derived from the project or from media the tree carries. The
 * caches of audio the storage does not keep belong to no project and never
 * travel with one.
 */
async function cachesOf(
  copy: ProjectCopy,
  carried: ReadonlySet<ContentId>,
  sources: TreeSources,
  signal?: AbortSignal,
): Promise<DomainResult<readonly TreeCache[]>> {
  return await refusalsReported(async () => {
    const caches: TreeCache[] = [];
    for (const category of CACHE_CLEANUP_ORDER) {
      for await (const { key, byteLength } of sources.caches.entries(category, signal)) {
        const { scope } = key;
        const derived =
          (scope.kind === 'media' && carried.has(scope.content)) ||
          (scope.kind === 'project' && scope.project === copy.project);
        if (derived) caches.push({ path: cachePathOf(key), byteLength });
      }
    }
    return succeed(caches);
  });
}

/** The assets linked to files outside the storage, with no retained copy. */
function linkedAssets(state: ProjectState): readonly AssetId[] {
  return [...state.sources]
    .filter(([, { media }]) => media.kind === 'external' && media.retainedCopy === undefined)
    .map(([asset]) => asset);
}

/** How the bytes of each media file and cache of a tree are read from storage. */
export function storedBodies(sources: TreeSources): BodyOpener {
  return async ({ path, body }, signal) => {
    switch (body.kind) {
      case 'text':
        return succeed(bytesSource(body.bytes));
      case 'media': {
        const opened = await sources.store.open(body.contentId);
        return opened.ok
          ? await provedMedia(opened.value, body.contentId, path, sources.digest)
          : opened;
      }
      case 'cache': {
        const key = cacheKeyOf(body.path);
        const opened =
          key === undefined ? succeed(undefined) : await sources.caches.open(key, signal);
        if (!opened.ok) return opened;
        return opened.value === undefined
          ? fail(
              failure(
                'storage.cache-gone',
                FailureKind.Conflict,
                'A cache was given up while the project was being copied.',
              ),
            )
          : succeed(opened.value);
      }
    }
  };
}
