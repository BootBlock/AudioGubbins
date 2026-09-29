/**
 * The content-addressed object store every project's managed media shares
 * (REQ-STOR-099): bytes kept once by their {@link ContentId}, over the storage
 * tree, whatever project or history holds them.
 *
 * The tree writes nothing atomically and cannot rename (ADR-0020), so an object
 * is trusted only once its seal exists: a one-line checksummed record of its
 * identity and length, written after the object is whole. The protocol of a
 * store, where `<t>` is a token from the injected token source:
 *
 *   1. Receive: stream the source into `incoming/<t>`, hashing as it is
 *      written, one chunk at a time (REQ-EXEC-216).
 *   2. If the identity is already stored whole, it is deduplicated: go to 6.
 *   3. Write `incoming/<t>.intent`, naming the identity.
 *   4. Remove any remnant of the object, then stream `incoming/<t>` into the
 *      object's name, hashing again, and check the copy's identity and length.
 *   5. Write the seal.
 *   6. Remove the intent, then `incoming/<t>`.
 *
 * Removal under a collection warrant writes an intent, removes the object, then
 * the seal, then the intent. Recovery reads every intent: an object it names
 * that is not whole (sealed, and of its sealed length) is removed with its
 * seal, and then `incoming` is removed. A crash at any step therefore leaves
 * every sealed object whole, and recovery touches only objects an intent names.
 *
 * The invariant recovery relies on: a project records a reference to an object
 * only after the store that returned its identity has resolved, which is after
 * step 5. An object recovery removes was never referenced. Between a store
 * resolving and its reference being recorded, the object is held
 * ({@link MediaObjectStore.release}), and collection keeps what is held.
 *
 * Across windows, every store shares the storage-wide lock through the injected
 * {@link MediaSharing} from before it receives a byte until its hold is
 * released, and a purge takes that lock alone, so a purge in one window never
 * removes what another has stored and not yet referred to, nor an object
 * another has just found stored already. Within this instance
 * {@link ExclusionGate} keeps recovery and removal apart from stores in
 * progress.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  contentIdOf,
  type ByteSource,
  type ContentId,
  type Digest,
  type HashingOptions,
  type StorageTree,
} from '@audiogubbins/project-format';

import { ExclusionGate, KeyedQueue } from './exclusion-gate.js';
import {
  MediaLayout,
  isIntentName,
  isObjectName,
  isShardName,
  sealNameOf,
} from './media-layout.js';
import { objectDamaged, objectMissing, refusalsReported } from './media-failures.js';
import {
  discard,
  receive,
  storeReceived,
  type ObjectFiles,
  type PutOptions,
} from './object-writing.js';
import { intentBytes, readIntent, readSeal } from './store-records.js';

/** An object the store holds whole. */
export interface StoredObject {
  readonly contentId: ContentId;
  readonly byteLength: number;
}

/** What storing bytes produced. */
export interface PutOutcome extends StoredObject {
  /** Whether the store already held these bytes, so nothing new was kept. */
  readonly deduplicated: boolean;
}

/** A unique tree segment for each store or removal, such as a random identifier. */
export type TokenSource = () => string;

/**
 * Keeps other windows' purges from running while this one stores media it has
 * yet to refer to (REQ-STOR-102).
 */
export interface MediaSharing {
  /**
   * Waits until no purge runs, then keeps any from starting until the returned
   * function is called. Rejects with the signal's reason where `signal` aborts
   * first.
   */
  share(signal?: AbortSignal): Promise<() => void>;
}

/** What a store is built from. */
export interface MediaStoreServices {
  readonly tree: StorageTree;

  /** The directory of the tree the store keeps everything under, such as `media`. */
  readonly root: string;
  readonly digest: Digest;
  readonly nextToken: TokenSource;
  readonly sharing: MediaSharing;
}

/** What recovery undid: the objects left incomplete by a change that never finished. */
export interface RecoveryReport {
  readonly undone: readonly ContentId[];
}

/**
 * The objects collection found unreachable against fresh roots, and the only
 * way to remove anything from a store (REQ-STOR-102). The private field makes
 * the class nominal, so no object literal passes for one, and the package's
 * entry point does not offer its constructor.
 */
export class CollectionWarrant {
  readonly #objects: readonly StoredObject[];

  constructor(objects: readonly StoredObject[]) {
    this.#objects = objects;
  }

  get objects(): readonly StoredObject[] {
    return this.#objects;
  }
}

/** The shared store of managed media. */
export class MediaObjectStore {
  readonly #files: ObjectFiles;
  readonly #nextToken: TokenSource;
  readonly #sharing: MediaSharing;
  readonly #gate = new ExclusionGate();
  readonly #settling = new KeyedQueue<ContentId>();

  /** Each held object's holds, each the ending of the share its store took. */
  readonly #holds = new Map<ContentId, (() => void)[]>();

  constructor(services: MediaStoreServices) {
    const { tree, root, digest, nextToken, sharing } = services;
    this.#files = { tree, layout: new MediaLayout(root), digest };
    this.#nextToken = nextToken;
    this.#sharing = sharing;
  }

  /**
   * Stores every byte of `source` under its identity, or finds it already
   * stored, once no purge runs. The identity is held, and the storage-wide lock
   * shared, until {@link release}d. Rejects with the signal's reason on abort,
   * leaving nothing named by an identity.
   */
  async put(source: ByteSource, options: PutOptions = {}): Promise<DomainResult<PutOutcome>> {
    const unshare = await this.#sharing.share(options.signal);
    let held = false;
    try {
      const outcome = await this.#stored(source, options);
      if (outcome.ok) {
        const { contentId } = outcome.value;
        this.#holds.set(contentId, [...(this.#holds.get(contentId) ?? []), unshare]);
        held = true;
      }
      return outcome;
    } finally {
      if (!held) unshare();
    }
  }

  /** Stores `source`, or finds it stored, within this instance's gate. */
  async #stored(source: ByteSource, options: PutOptions): Promise<DomainResult<PutOutcome>> {
    return await this.#gate.shared(
      async () =>
        await refusalsReported(async () => {
          const token = this.#nextToken();
          try {
            const identity = await receive(this.#files, source, token, options);
            if (!identity.ok) return identity;
            const { contentId } = identity.value;
            const outcome = await this.#settling.run(contentId, async () => {
              if ((await this.#whole(contentId)) !== undefined) {
                return succeed({ ...identity.value, deduplicated: true });
              }
              const stored = await storeReceived(this.#files, identity.value, token, options);
              return stored.ok ? succeed({ ...identity.value, deduplicated: false }) : stored;
            });
            return outcome;
          } finally {
            await discard(this.#files.tree, this.#files.layout.received(token));
          }
        }),
    );
  }

  /**
   * Lets collection consider an object again, once the reference a store was
   * made for is recorded in a project's state or abandoned. Releasing what is
   * not held is a programmer error.
   */
  release(contentId: ContentId): void {
    const holds = this.#holds.get(contentId);
    const unshare = holds?.[0];
    if (holds === undefined || unshare === undefined) {
      throw new Error('Only a held media object can be released.');
    }
    if (holds.length === 1) this.#holds.delete(contentId);
    else this.#holds.set(contentId, holds.slice(1));
    unshare();
  }

  /** Whether a store holds the object until it is released. */
  isHeld(contentId: ContentId): boolean {
    return this.#holds.has(contentId);
  }

  /** The object, where the store holds it whole. */
  async find(contentId: ContentId): Promise<DomainResult<StoredObject | undefined>> {
    return await refusalsReported(async () => {
      const whole = await this.#whole(contentId);
      return succeed(whole === undefined ? undefined : { contentId, byteLength: whole.size });
    });
  }

  /** The object's bytes to read in ranges, its length checked against its seal. */
  async open(contentId: ContentId): Promise<DomainResult<ByteSource>> {
    return await refusalsReported(async () => {
      const whole = await this.#whole(contentId);
      return whole === undefined ? fail(objectMissing(contentId)) : succeed(whole);
    });
  }

  /** Hashes the object again, to prove its bytes are still the ones it is named by. */
  async verify(
    contentId: ContentId,
    options: HashingOptions = {},
  ): Promise<DomainResult<StoredObject>> {
    const opened = await this.open(contentId);
    if (!opened.ok) return opened;
    return await refusalsReported(async () => {
      const hashed = await contentIdOf(opened.value, this.#files.digest, options);
      if (!hashed.ok) return fail(objectDamaged(contentId, 'short-read'));
      return hashed.value.contentId === contentId
        ? succeed(hashed.value)
        : fail(objectDamaged(contentId, 'content-differs'));
    });
  }

  /**
   * Every sealed object, in identifier order, one shard listed at a time. The
   * lengths are the seals'; {@link find} and {@link open} check each against
   * its object. Rejects with a `TreeFailure` where the tree refuses.
   */
  async *list(signal?: AbortSignal): AsyncGenerator<StoredObject, void, undefined> {
    for (const shard of await this.#files.tree.list(this.#files.layout.root)) {
      if (shard.kind !== 'directory' || !isShardName(shard.name)) continue;
      signal?.throwIfAborted();
      const entries = await this.#files.tree.list(this.#files.layout.shard(shard.name));
      const files = new Set(
        entries.filter((entry) => entry.kind === 'file').map(({ name }) => name),
      );
      for (const name of files) {
        if (!isObjectName(name) || !files.has(sealNameOf(name))) continue;
        const sealPath = `${this.#files.layout.shard(shard.name)}/${sealNameOf(name)}`;
        const sealed = await this.#sealNamed(name, sealPath);
        if (sealed !== undefined) yield sealed;
      }
    }
  }

  /** Completes or undoes every change a crash left unfinished. Run before any store. */
  async recoverIncomplete(): Promise<DomainResult<RecoveryReport>> {
    return await this.#gate.exclusive(
      async () =>
        await refusalsReported(async () => {
          const undone: ContentId[] = [];
          for (const entry of await this.#files.tree.list(this.#files.layout.incoming)) {
            if (entry.kind !== 'file' || !isIntentName(entry.name)) continue;
            const bytes = await this.#files.tree.readFile(
              `${this.#files.layout.incoming}/${entry.name}`,
            );
            const named =
              bytes === undefined ? undefined : await readIntent(bytes, this.#files.digest);
            if (named === undefined || (await this.#whole(named)) !== undefined) continue;
            await this.#files.tree.remove(this.#files.layout.object(named));
            await this.#files.tree.remove(this.#files.layout.seal(named));
            undone.push(named);
          }
          await this.#files.tree.remove(this.#files.layout.incoming);
          return succeed({ undone });
        }),
    );
  }

  /**
   * Removes the warranted objects that are still whole and not held, giving
   * those it removed. A refusal part-way stops the removal; what is left is
   * found by planning again.
   */
  async remove(
    warrant: CollectionWarrant,
    signal?: AbortSignal,
  ): Promise<DomainResult<readonly StoredObject[]>> {
    return await this.#gate.exclusive(
      async () =>
        await refusalsReported(async () => {
          const removed: StoredObject[] = [];
          for (const { contentId } of warrant.objects) {
            signal?.throwIfAborted();
            const whole = this.#holds.has(contentId) ? undefined : await this.#whole(contentId);
            if (whole === undefined) continue;
            const intent = this.#files.layout.intent(this.#nextToken());
            await this.#files.tree.writeFile(
              intent,
              await intentBytes(contentId, this.#files.digest),
            );
            await this.#files.tree.remove(this.#files.layout.object(contentId));
            await this.#files.tree.remove(this.#files.layout.seal(contentId));
            await this.#files.tree.remove(intent);
            removed.push({ contentId, byteLength: whole.size });
          }
          return succeed(removed);
        }),
    );
  }

  /** The object's bytes, where it is sealed and of its sealed length. */
  async #whole(contentId: ContentId): Promise<ByteSource | undefined> {
    const sealed = await this.#sealNamed(contentId, this.#files.layout.seal(contentId));
    if (sealed === undefined) return undefined;
    const object = await this.#files.tree.openFile(this.#files.layout.object(contentId));
    return object?.size === sealed.byteLength ? object : undefined;
  }

  /** The object a valid seal at `path` describes, where it names `name`. */
  async #sealNamed(name: string, path: string): Promise<StoredObject | undefined> {
    const bytes = await this.#files.tree.readFile(path);
    const seal = bytes === undefined ? undefined : await readSeal(bytes, this.#files.digest);
    return seal?.contentId === name ? seal : undefined;
  }
}
