/**
 * A copied project as the files of its unpacked tree, with every piece of media
 * it needs, whatever other projects share it (REQ-STOR-099, REQ-STOR-103,
 * REQ-STOR-166, REQ-STOR-027).
 *
 * Deduplication never keeps a project from travelling whole: the tree carries
 * every managed object its state refers to, and for a whole history every
 * object its kept states refer to and every one its changes name that the store
 * holds, so undo and redo work where it is opened. A history may keep more
 * states than fit in memory (REQ-EXEC-216), so its kept states are read only as
 * the tree is written, one at a time. What its kept states refer to is known
 * before any is written (`copied-history.ts`); each kept state is held to it as
 * it is read, and refused where it refers to media the tree does not carry. A
 * tree keeps provenance at the level the person chose: the state alone is
 * stripped as the tree is written, and a whole history before it. The caches go
 * only where asked for, and only those derived from the project or from media
 * it carries. An asset linked to a file outside the storage, with no copy the
 * store keeps, cannot travel as bytes and is reported, so the person can
 * consolidate first.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type AssetId,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import { contentReferencedBy, type MediaObjectStore } from '@audiogubbins/media-store';
import {
  projectTree,
  type ContentId,
  type Digest,
  type ProjectState,
  type ProjectTreeFile,
  type ProvenanceLevel,
  type TreeCache,
  type TreeMedia,
  type TreeStates,
} from '@audiogubbins/project-format';

import { CACHE_CLEANUP_ORDER, cacheKeyOf, cachePathOf, type CacheStore } from './cache-store.js';
import { historyScope, type CopiedScope, type HistoryStrippingParts } from './copied-history.js';
import type { ProjectCopy } from './project-copy.js';
import { provedBytes } from './proved-bytes.js';
import { mediaDamaged, refusalsReported } from './storage-failures.js';
import type { BodyOpener } from './tree-bodies.js';

/**
 * How much of a project a bundle or tree holds, the whole history or the state
 * alone, and how much of where its audio came from it keeps.
 */
export interface BundleScope {
  readonly kind: 'whole-history' | 'current-state';
  readonly provenance: ProvenanceLevel;
}

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

/** What a tree of a copied project is made with. */
export interface TreeCopying extends TreeSources, HistoryStrippingParts {}

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
  sources: TreeCopying,
  signal?: AbortSignal,
): Promise<DomainResult<CopiedTree>> {
  const { model } = copy;
  const scoped = await scopeOf(copy, options.scope, sources, signal);
  if (!scoped.ok) return scoped;
  const { scope, required, wanted, state, exports } = scoped.value;
  const media = await mediaOf(sources.store, required, wanted);
  if (!media.ok) return media;
  const carried = new Set(media.value.map(({ contentId }) => contentId));
  const caches = options.includeCaches ? await cachesOf(copy, carried, sources, signal) : undefined;
  if (caches !== undefined && !caches.ok) return caches;
  const files = projectTree({
    state,
    scope:
      scope.kind === 'history'
        ? {
            ...scope,
            history: { ...scope.history, states: carriedStates(scope.history.states, carried) },
          }
        : scope,
    exports,
    backup: model.backup,
    media: media.value,
    ...(caches === undefined ? {} : { caches: caches.value }),
  });
  return succeed({ files, linked: linkedAssets(model.state) });
}

/** What of a copy its tree holds, as `scope` asks (see the module comment). */
async function scopeOf(
  copy: ProjectCopy,
  scope: BundleScope,
  services: TreeCopying,
  signal?: AbortSignal,
): Promise<DomainResult<CopiedScope>> {
  const { model } = copy;
  const { provenance } = scope;
  const required = new Set(contentReferencedBy(model.state));
  if (scope.kind === 'current-state') {
    return succeed({
      scope: { kind: 'state', provenance },
      state: model.state,
      exports: model.exports,
      required,
      wanted: new Set(),
    });
  }
  return await historyScope(copy, provenance, required, services, signal);
}

/**
 * The kept states, each refused as it is read where it refers to media the
 * copy does not carry, which only a store missing media its history names
 * leaves out.
 */
function carriedStates(states: TreeStates, carried: ReadonlySet<ContentId>): TreeStates {
  return {
    fingerprints: states.fingerprints,
    load: async (fingerprint, signal) => {
      const state = await states.load(fingerprint, signal);
      if (!state.ok || state.value === undefined) return state;
      const missing = [...contentReferencedBy(state.value)].find((each) => !carried.has(each));
      return missing === undefined ? state : fail(mediaMissing(missing));
    },
  };
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
    else if (required.has(contentId)) return fail(mediaMissing(contentId));
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
      for await (const { key, byteLength, contentId } of sources.caches.entries(category, signal)) {
        const { scope } = key;
        const derived =
          (scope.kind === 'media' && carried.has(scope.content)) ||
          (scope.kind === 'project' && scope.project === copy.project);
        if (derived) caches.push({ path: cachePathOf(key), byteLength, contentId });
      }
    }
    return succeed(caches);
  });
}

function mediaMissing(contentId: ContentId): DomainFailure {
  return failure(
    'storage.media-missing',
    FailureKind.IntegrityViolation,
    'Media the project refers to is not in the store, so the project cannot be copied whole.',
    { details: { content: contentId } },
  );
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
        throw new Error(`A tree's text is made, never opened: ${path}`);
      case 'media': {
        const opened = await sources.store.open(body.contentId);
        return opened.ok
          ? await provedBytes(
              opened.value,
              body.contentId,
              sources.digest,
              mediaDamaged(path, body.contentId),
            )
          : opened;
      }
      case 'cache': {
        const key = cacheKeyOf(body.path);
        const opened =
          key === undefined ? succeed(undefined) : await sources.caches.open(key, signal);
        if (!opened.ok) return opened;
        // A cache given up or made again since the tree was listed is not the
        // cache the tree lists, which proving finds as it is read.
        const changed = failure(
          'storage.cache-gone',
          FailureKind.Conflict,
          'A cache was given up or made again while the project was being copied.',
          { details: { cache: body.path } },
        );
        return opened.value === undefined
          ? fail(changed)
          : await provedBytes(opened.value, body.contentId, sources.digest, changed);
      }
    }
  };
}
