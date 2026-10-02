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
 * the tree is written, one at a time. Every state of a history is the state of
 * its first node changed by the changes on the way, so what its kept states
 * refer to is what that first state refers to and what the changes name, which
 * is known before any is written; each kept state is held to it as it is read,
 * and refused where it refers to media the tree does not carry. A tree of the
 * state alone keeps provenance at the level the person chose; a whole history
 * keeps all of it, since its changes carry the provenance they were made with.
 * The caches go only where asked for, and only those derived from the project
 * or from media it carries. An asset linked to a file outside the storage, with
 * no copy the store keeps, cannot travel as bytes and is reported, so the
 * person can consolidate first.
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
import { historyRecordOf } from '@audiogubbins/history';
import { contentReferencedBy, type MediaObjectStore } from '@audiogubbins/media-store';
import {
  projectTree,
  writeHistoryNodeRecord,
  type ContentId,
  type Digest,
  type HistoryRecord,
  type ProjectState,
  type ProjectTreeFile,
  type ProjectTreeScope,
  type ProvenanceLevel,
  type TreeCache,
  type TreeMedia,
  type TreeStates,
} from '@audiogubbins/project-format';

import { CACHE_CLEANUP_ORDER, cacheKeyOf, cachePathOf, type CacheStore } from './cache-store.js';
import { choiceOf } from './comparison-record.js';
import { contentIdsIn } from './content-references.js';
import { offeredStates, type ProjectCopy } from './project-copy.js';
import { provedBytes } from './proved-bytes.js';
import { mediaDamaged, refusalsReported } from './storage-failures.js';
import type { BodyOpener } from './tree-bodies.js';

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
  const scoped = await scopeOf(copy, options.scope, signal);
  if (!scoped.ok) return scoped;
  const { scope, required, wanted } = scoped.value;
  const media = await mediaOf(sources.store, required, wanted);
  if (!media.ok) return media;
  const carried = new Set(media.value.map(({ contentId }) => contentId));
  const caches = options.includeCaches ? await cachesOf(copy, carried, sources, signal) : undefined;
  if (caches !== undefined && !caches.ok) return caches;
  const files = projectTree({
    state: model.state,
    scope:
      scope.kind === 'history'
        ? {
            kind: 'history',
            history: { ...scope.history, states: carriedStates(scope.history.states, carried) },
          }
        : scope,
    exports: model.exports,
    backup: model.backup,
    media: media.value,
    ...(caches === undefined ? {} : { caches: caches.value }),
  });
  return succeed({ files, linked: linkedAssets(model.state) });
}

/** How much of a copy its tree holds, and the media the tree must and may carry. */
interface CopiedScope {
  readonly scope: ProjectTreeScope;

  /** Referred to by the state or the states kept, so the tree is refused without it. */
  readonly required: ReadonlySet<ContentId>;

  /** Named by the history's changes, and carried where the store holds it. */
  readonly wanted: ReadonlySet<ContentId>;
}

/** What of a copy its tree holds, as `scope` asks (see the module comment). */
async function scopeOf(
  copy: ProjectCopy,
  scope: BundleScope,
  signal?: AbortSignal,
): Promise<DomainResult<CopiedScope>> {
  const { model } = copy;
  const required = new Set(contentReferencedBy(model.state));
  if (scope.kind === 'current-state') {
    return succeed({
      scope: { kind: 'state', provenance: scope.provenance },
      required,
      wanted: new Set(),
    });
  }
  const states = copiedStates(copy);
  if (!states.ok) return states;
  const record = historyRecordOf(model.history);
  const first = await firstReferences(record, states.value, signal);
  if (!first.ok) return first;
  for (const each of first.value) required.add(each);
  const wanted = new Set<ContentId>();
  for (const node of record.nodes) {
    for (const each of contentIdsIn(writeHistoryNodeRecord(node))) wanted.add(each);
  }
  const history = {
    record,
    retention: model.retention,
    states: states.value,
    ...(model.comparison === undefined ? {} : { comparison: choiceOf(model.comparison) }),
  };
  return succeed({ scope: { kind: 'history', history }, required, wanted });
}

/**
 * The states a copy's history keeps, each read only when it is asked for. One
 * that cannot be read is left out, and the history reaches its node by replay
 * instead; a snapshot's must be read, since a restore point would be lost, and
 * the copy is refused at once where one is not kept at all.
 */
export function copiedStates(copy: ProjectCopy): DomainResult<TreeStates> {
  const snapshotted = new Set(
    [...copy.model.history.snapshots.values()].map((snapshot) => snapshot.stateFingerprint),
  );
  const fingerprints = offeredStates(copy);
  const offered = new Set(fingerprints);
  for (const fingerprint of snapshotted) {
    if (!offered.has(fingerprint)) {
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
  return succeed({
    fingerprints,
    load: async (fingerprint, signal) => {
      const state = await copy.states.load(fingerprint, signal);
      return state.ok || snapshotted.has(fingerprint) ? state : succeed(undefined);
    },
  });
}

/**
 * What the state the history begins from refers to, which with what its changes
 * name is what every state it keeps refers to; where that state is not kept or
 * cannot be read, what every kept state that can be read refers to, each read
 * in turn.
 */
async function firstReferences(
  record: HistoryRecord,
  states: TreeStates,
  signal?: AbortSignal,
): Promise<DomainResult<ReadonlySet<ContentId>>> {
  const root = record.nodes.find((node) => node.kind === 'origin' || node.parent === undefined);
  const first = root?.stateFingerprint;
  if (first !== undefined && states.fingerprints.includes(first)) {
    const state = await states.load(first, signal);
    if (!state.ok) return state;
    if (state.value !== undefined) return succeed(new Set(contentReferencedBy(state.value)));
  }
  return await everyReference(states, signal);
}

/** What every kept state that can be read refers to, each read in turn. */
async function everyReference(
  states: TreeStates,
  signal?: AbortSignal,
): Promise<DomainResult<ReadonlySet<ContentId>>> {
  const referred = new Set<ContentId>();
  for (const fingerprint of states.fingerprints) {
    const state = await states.load(fingerprint, signal);
    if (!state.ok) return state;
    for (const each of state.value === undefined ? [] : contentReferencedBy(state.value)) {
      referred.add(each);
    }
  }
  return succeed(referred);
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
