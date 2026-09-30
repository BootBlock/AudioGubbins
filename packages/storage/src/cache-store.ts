/**
 * Disposable caches: what is derived from media or from a project and can be
 * made again, kept apart from everything authoritative (REQ-STOR-027,
 * REQ-STOR-106, REQ-STOR-200).
 *
 * A cache is kept at `cache/<category>/<scope>/<name>`, where the scope is the
 * media or the project it was derived from, so the caches of one piece of media
 * or of one project can be found, travel with it in a bundle where asked for,
 * and are given up whole; or, for audio the storage does not keep, such as a
 * built-in test signal or the sound of a reference picture, the digest of the
 * identity it is known by, so its caches are counted and given up with the rest
 * (ADR-0043). The tree writes nothing atomically, so a cache is trusted only
 * once a checked seal beside it says how long it is; one that was torn, or
 * whose seal is missing, reads as absent, which is what losing a cache must
 * mean: the caller makes it again, and nothing authoritative ever depends on
 * it. The categories are ranked in the order storage pressure gives them up.
 */

import {
  isWellFormedId,
  succeed,
  unsafeBrandId,
  type DomainResult,
  type ProjectId,
} from '@audiogubbins/domain';
import {
  contentIdFrom,
  isContentId,
  isTreeSegment,
  objectOf,
  pathOf,
  required,
  type ByteSource,
  type ContentId,
  type Converter,
  type Digest,
  type StorageTree,
} from '@audiogubbins/project-format';

import { bytesSource, streamInto } from './byte-streams.js';
import { CheckedRecords, RecordKind } from './checked-records.js';
import { asWholeNumber } from './record-values.js';
import { refusalsReported } from './storage-failures.js';
import { CACHE_DIRECTORY } from './storage-layout.js';

/** What a cache holds, which decides when it is given up. */
export const CacheCategory = {
  /** Regenerable temporary data, the first to go. */
  Temporary: 'temporary',
  Render: 'render',
  Analysis: 'analysis',
  Waveform: 'waveform',
  Spectrogram: 'spectrogram',

  /** Intermediate processing results that nothing protects. */
  Intermediate: 'intermediate',
} as const;

/** What a cache holds, which decides when it is given up. */
export type CacheCategory = (typeof CacheCategory)[keyof typeof CacheCategory];

/** The order storage pressure gives the categories up in (REQ-STOR-106). */
export const CACHE_CLEANUP_ORDER: readonly CacheCategory[] = [
  CacheCategory.Temporary,
  CacheCategory.Render,
  CacheCategory.Analysis,
  CacheCategory.Waveform,
  CacheCategory.Spectrogram,
  CacheCategory.Intermediate,
];

const CATEGORIES: ReadonlySet<string> = new Set(CACHE_CLEANUP_ORDER);

/** What a cache was derived from. */
export type CacheScope =
  | { readonly kind: 'media'; readonly content: ContentId }
  | { readonly kind: 'project'; readonly project: ProjectId }
  /**
   * Audio the storage does not keep, by the SHA-256 of the identity it is
   * known by, in lower-case hexadecimal (see {@link unstoredScope}).
   */
  | { readonly kind: 'unstored'; readonly source: string };

/** The start of the path segment of an unstored scope, which no other scope's segment has. */
const UNSTORED_PREFIX = 'u-';

/** A SHA-256 digest, as an unstored scope names its source. */
const SOURCE_DIGEST = /^[0-9a-f]{64}$/u;

const TEXT = new TextEncoder();

/**
 * The scope of the caches of audio the storage does not keep, from the
 * identity it is known by, which may hold any character: its digest is what
 * the path holds, so one identity always names one scope.
 */
export async function unstoredScope(identity: string, digest: Digest): Promise<CacheScope> {
  const hash = await digest(TEXT.encode(identity));
  const source = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { kind: 'unstored', source };
}

/** The path segment of a scope. */
function segmentOf(scope: CacheScope): string {
  switch (scope.kind) {
    case 'media':
      return scope.content;
    case 'project':
      return scope.project;
    case 'unstored':
      return `${UNSTORED_PREFIX}${scope.source}`;
  }
}

/** Where a cache is kept. */
export interface CacheKey {
  readonly category: CacheCategory;
  readonly scope: CacheScope;

  /** One segment of a tree path, not ending in `.seal`. */
  readonly name: string;
}

/** A cache kept whole, and its length. */
export interface CacheEntry {
  readonly key: CacheKey;
  readonly byteLength: number;
}

const SEAL_SUFFIX = '.seal';
const SEAL_MEMBERS: ReadonlySet<string> = new Set(['byteLength']);

const readSeal: Converter<number> = (reading, value, parent, key) => {
  const object = objectOf(reading, value, parent, key, SEAL_MEMBERS);
  return object === undefined
    ? undefined
    : required(reading, object, pathOf(parent, key), 'byteLength', asWholeNumber);
};

/** The path of a cache under the cache directory: `<category>/<scope>/<name>`. */
export function cachePathOf(key: CacheKey): string {
  return `${key.category}/${segmentOf(key.scope)}/${key.name}`;
}

/** The key a path under the cache directory names, or `undefined` for another path. */
export function cacheKeyOf(path: string): CacheKey | undefined {
  const [category = '', scope = '', name = '', ...rest] = path.split('/');
  if (rest.length > 0 || !CATEGORIES.has(category) || !isCacheName(name)) return undefined;
  const cacheScope = scopeOf(scope);
  const known = CACHE_CLEANUP_ORDER.find((each) => each === category);
  return cacheScope === undefined || known === undefined
    ? undefined
    : { category: known, scope: cacheScope, name };
}

function scopeOf(segment: string): CacheScope | undefined {
  if (segment.startsWith(UNSTORED_PREFIX)) {
    const source = segment.slice(UNSTORED_PREFIX.length);
    return SOURCE_DIGEST.test(source) ? { kind: 'unstored', source } : undefined;
  }
  if (isContentId(segment)) {
    const content = contentIdFrom(segment);
    return content.ok ? { kind: 'media', content: content.value } : undefined;
  }
  return isWellFormedId(segment)
    ? { kind: 'project', project: unsafeBrandId<'ProjectId'>(segment) }
    : undefined;
}

function isCacheName(name: string): boolean {
  return isTreeSegment(name) && !name.endsWith(SEAL_SUFFIX);
}

/** The caches of a storage (see the module comment). */
export class CacheStore {
  private readonly records: CheckedRecords;

  constructor(tree: StorageTree, digest: Digest) {
    this.records = new CheckedRecords(tree, digest);
  }

  /**
   * Keeps a cache, replacing any under its key. A key whose name is not one
   * segment of a tree path, or ends in `.seal`, is a programmer error.
   */
  async put(
    key: CacheKey,
    bytes: ByteSource | Uint8Array<ArrayBuffer>,
    signal?: AbortSignal,
  ): Promise<DomainResult<void>> {
    if (!isCacheName(key.name)) throw new Error(`Not a cache's name: ${key.name}`);
    const source = bytes instanceof Uint8Array ? bytesSource(bytes) : bytes;
    const path = this.path(key);
    return await refusalsReported(async () => {
      // The seal goes first, so a cache torn while it is replaced is never
      // taken for whole under the seal of the one before it.
      await this.tree.remove(`${path}${SEAL_SUFFIX}`);
      const written = await streamInto(source, await this.tree.createFile(path), signal);
      if (!written.ok) return written;
      return await this.records.write(
        `${path}${SEAL_SUFFIX}`,
        RecordKind.CacheSeal,
        { byteLength: source.size },
        signal,
      );
    });
  }

  /** The cache under a key, where it is kept whole. */
  async open(key: CacheKey, signal?: AbortSignal): Promise<DomainResult<ByteSource | undefined>> {
    return await refusalsReported(async () => succeed(await this.whole(this.path(key), signal)));
  }

  /** Gives up the cache under a key. */
  async evict(key: CacheKey): Promise<DomainResult<void>> {
    return await refusalsReported(async () => {
      const path = this.path(key);
      await this.tree.remove(`${path}${SEAL_SUFFIX}`);
      await this.tree.remove(path);
      return succeed(undefined);
    });
  }

  /**
   * Gives up every cache of one scope in a category, as a cache kept by
   * revision does before it keeps a newer one, so revisions never accumulate.
   */
  async evictScope(category: CacheCategory, scope: CacheScope): Promise<DomainResult<void>> {
    return await refusalsReported(async () => {
      await this.tree.remove(`${CACHE_DIRECTORY}/${category}/${segmentOf(scope)}`);
      return succeed(undefined);
    });
  }

  /** Gives up every cache of a category, and says how many bytes that freed. */
  async evictCategory(
    category: CacheCategory,
    signal?: AbortSignal,
  ): Promise<DomainResult<number>> {
    return await refusalsReported(async () => {
      let freed = 0;
      for await (const path of this.filesOf(category, signal)) {
        freed += (await this.tree.openFile(path))?.size ?? 0;
      }
      await this.tree.remove(`${CACHE_DIRECTORY}/${category}`);
      return succeed(freed);
    });
  }

  /** The caches of a category kept whole, in path order. */
  async *entries(
    category: CacheCategory,
    signal?: AbortSignal,
  ): AsyncGenerator<CacheEntry, void, undefined> {
    for await (const path of this.filesOf(category, signal)) {
      const key = cacheKeyOf(path.slice(CACHE_DIRECTORY.length + 1));
      if (key === undefined) continue;
      const whole = await this.whole(path, signal);
      if (whole !== undefined) yield { key, byteLength: whole.size };
    }
  }

  /** The bytes every category takes, whole caches, torn ones and seals alike. */
  async usage(signal?: AbortSignal): Promise<DomainResult<ReadonlyMap<CacheCategory, number>>> {
    return await refusalsReported(async () => {
      const usage = new Map<CacheCategory, number>();
      for (const category of CACHE_CLEANUP_ORDER) {
        let bytes = 0;
        for await (const path of this.filesOf(category, signal)) {
          bytes += (await this.tree.openFile(path))?.size ?? 0;
        }
        usage.set(category, bytes);
      }
      return succeed<ReadonlyMap<CacheCategory, number>>(usage);
    });
  }

  private get tree(): StorageTree {
    return this.records.tree;
  }

  private path(key: CacheKey): string {
    return `${CACHE_DIRECTORY}/${cachePathOf(key)}`;
  }

  /** The cache at a path, where its seal is valid and its length is the seal's. */
  private async whole(path: string, signal?: AbortSignal): Promise<ByteSource | undefined> {
    const seal = await this.records.read(
      `${path}${SEAL_SUFFIX}`,
      RecordKind.CacheSeal,
      readSeal,
      signal,
    );
    if (seal.kind !== 'valid') return undefined;
    const data = await this.tree.openFile(path);
    return data?.size === seal.value ? data : undefined;
  }

  /** Every file of a category, seals among them, in path order. */
  private async *filesOf(
    category: CacheCategory,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void, undefined> {
    const directory = `${CACHE_DIRECTORY}/${category}`;
    for (const scope of await this.tree.list(directory)) {
      signal?.throwIfAborted();
      const scopeDirectory = `${directory}/${scope.name}`;
      if (scope.kind !== 'directory') {
        yield scopeDirectory;
        continue;
      }
      for (const file of await this.tree.list(scopeDirectory)) {
        yield `${scopeDirectory}/${file.name}`;
      }
    }
  }
}
