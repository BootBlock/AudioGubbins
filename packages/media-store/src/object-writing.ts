/**
 * The writing steps of the media store's protocol (`object-store.ts`, which
 * states the whole of it): receiving a source under a token, and storing what
 * was received under its identity, sealed (REQ-STOR-099, REQ-EXEC-216).
 *
 * Each step streams one chunk at a time and hashes as it writes, and each
 * leaves on failure or abort only what recovery removes: a received file in
 * `incoming`, or an unsealed object an intent names. Deciding whether a step is
 * needed, and keeping steps apart, is the store's.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';
import {
  TreeFailure,
  createContentHasher,
  type ByteSink,
  type ByteSource,
  type ContentIdentity,
  type Digest,
  type StorageTree,
} from '@audiogubbins/project-format';

import { forEachChunk } from './chunk-reading.js';
import type { MediaLayout } from './media-layout.js';
import { objectDamaged } from './media-failures.js';
import { intentBytes, sealBytes } from './store-records.js';

/**
 * How far a store has come: receiving the source, then storing the received
 * bytes under their name, which a deduplicated store skips.
 */
export interface StoreProgress {
  readonly stage: 'receiving' | 'storing';
  readonly done: number;
  readonly total: number;
}

/** What a store may be told. */
export interface PutOptions {
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((progress: StoreProgress) => void) | undefined;
}

/** What the writing steps work on: one store's tree, layout and digest. */
export interface ObjectFiles {
  readonly tree: StorageTree;
  readonly layout: MediaLayout;
  readonly digest: Digest;
}

/** Step 1: streams the source into the file received under `token`, giving its identity. */
export async function receive(
  files: ObjectFiles,
  source: ByteSource,
  token: string,
  options: PutOptions,
): Promise<DomainResult<ContentIdentity>> {
  return await copyHashed(files, source, files.layout.received(token), 'receiving', options);
}

/**
 * Steps 3 to 5: announces the object in an intent, stores the bytes received
 * under `token` by their name, checks them, and seals them; then removes the
 * intent. Undoes the object where any of it fails, and leaves the intent where
 * even that fails, for recovery.
 */
export async function storeReceived(
  files: ObjectFiles,
  identity: ContentIdentity,
  token: string,
  options: PutOptions,
): Promise<DomainResult<undefined>> {
  const { tree, layout, digest } = files;
  const { contentId } = identity;
  const intent = layout.intent(token);
  await tree.writeFile(intent, await intentBytes(contentId, digest));
  let sealed = false;
  try {
    const stored = await copyReceived(files, identity, token, options);
    if (!stored.ok) return stored;
    await tree.writeFile(layout.seal(contentId), await sealBytes(identity, digest));
    sealed = true;
    return succeed(undefined);
  } finally {
    const undone =
      sealed ||
      ((await discard(tree, layout.object(contentId))) &&
        (await discard(tree, layout.seal(contentId))));
    if (undone) await discard(tree, intent);
  }
}

/**
 * Removes a file the protocol no longer needs, reporting whether it went. A
 * refusal is not the operation's failure: what is left is named by an intent
 * or lies in `incoming`, and recovery removes it.
 */
export async function discard(tree: StorageTree, path: string): Promise<boolean> {
  try {
    await tree.remove(path);
    return true;
  } catch (error) {
    if (error instanceof TreeFailure) return false;
    throw error;
  }
}

/** Step 4: the received bytes, streamed under the object's name and checked. */
async function copyReceived(
  files: ObjectFiles,
  identity: ContentIdentity,
  token: string,
  options: PutOptions,
): Promise<DomainResult<undefined>> {
  const { tree, layout } = files;
  const { contentId, byteLength } = identity;
  const object = layout.object(contentId);
  // A seal of an object that is not whole could otherwise stand beside the
  // bytes while they are written.
  await tree.remove(layout.seal(contentId));
  await tree.remove(object);

  const received = await tree.openFile(layout.received(token));
  if (received?.size !== byteLength) return fail(objectDamaged(contentId, 'received-lost'));
  const copied = await copyHashed(files, received, object, 'storing', options);
  if (!copied.ok || copied.value.contentId !== contentId) {
    return fail(objectDamaged(contentId, 'received-changed'));
  }
  const stored = await tree.openFile(object);
  return stored?.size === byteLength
    ? succeed(undefined)
    : fail(objectDamaged(contentId, 'stored-length'));
}

/**
 * Streams a source into a new file at `path`, hashing it on the way, and gives
 * the identity of what was read.
 */
async function copyHashed(
  { tree, digest }: ObjectFiles,
  source: ByteSource,
  path: string,
  stage: StoreProgress['stage'],
  { signal, onProgress }: PutOptions,
): Promise<DomainResult<ContentIdentity>> {
  const hasher = createContentHasher(digest);
  const written = await writeThrough(
    await tree.createFile(path),
    async (take) =>
      await forEachChunk(
        source,
        async (chunk) => {
          await hasher.update(chunk);
          await take(chunk);
        },
        { signal, onChunk: (done, total) => onProgress?.({ stage, done, total }) },
      ),
  );
  return written.ok ? succeed(await hasher.finish()) : written;
}

/**
 * Writes through a sink, closing it once `write` succeeds and abandoning it
 * otherwise, so a sink is never left open whatever `write` does.
 */
async function writeThrough(
  sink: ByteSink,
  write: (take: (chunk: Uint8Array) => Promise<void>) => Promise<DomainResult<undefined>>,
): Promise<DomainResult<undefined>> {
  let closed = false;
  try {
    const written = await write(async (chunk) => {
      await sink.write(chunk);
    });
    if (written.ok) {
      await sink.close();
      closed = true;
    }
    return written;
  } finally {
    if (!closed) await abandon(sink);
  }
}

async function abandon(sink: ByteSink): Promise<void> {
  try {
    await sink.abort();
  } catch (error) {
    // What the sink held is removed with the file it was writing, by the store
    // or by recovery, so a sink that cannot abort harms nothing.
    if (!(error instanceof TreeFailure)) throw error;
  }
}
