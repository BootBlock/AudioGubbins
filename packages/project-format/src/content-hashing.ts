/**
 * Computing a {@link ContentId} and a {@link StateFingerprint}.
 *
 * The content construction (ADR-0020, REQ-STOR-099) is part of the format:
 *
 *   SHA-256( length || SHA-256(chunk 0) || SHA-256(chunk 1) || ... )
 *
 * where `length` is the byte length as 8 bytes, big-endian, and each chunk is
 * exactly {@link CONTENT_CHUNK_BYTES} but the last, which is shorter and never
 * empty. Content of no bytes is the digest of the 8 length bytes alone. The
 * chunks are hashed one at a time through the injected digest, so a file is
 * never whole in memory (REQ-EXEC-216), and the platform's native SHA-256 does
 * the work, which a one-shot digest port could not do for a stream.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type DomainResult,
} from '@audiogubbins/domain';

import type { ByteSource, Digest } from './byte-ports.js';
import type { CanonicalJson } from './canonical-json.js';
import { hexOf, type ContentId, type StateFingerprint } from './content-identity.js';
import { encodeUtf8 } from './utf8.js';

/** The chunk size of the content construction: 1 MiB, fixed by the format. */
export const CONTENT_CHUNK_BYTES = 1_048_576;

/** The bytes of a SHA-256 digest. */
const DIGEST_BYTES = 32;

/** The bytes the length is written in. */
const LENGTH_BYTES = 8;

/** A run of bytes' identity and its length. */
export interface ContentIdentity {
  readonly contentId: ContentId;
  readonly byteLength: number;
}

/** What hashing a source may be told. */
export interface HashingOptions {
  readonly signal?: AbortSignal;

  /** Called after each chunk with the bytes hashed so far and the total. */
  readonly onProgress?: (hashed: number, total: number) => void;
}

/**
 * Hashes bytes handed over in pieces of any size, for content that is hashed
 * while it is written. The result is the same however the bytes are split.
 *
 * Each call must be awaited before the next: calling again while one is
 * running, or at all after {@link ContentHasher.finish}, is a programmer error
 * and throws.
 */
export interface ContentHasher {
  update(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  finish(): Promise<ContentIdentity>;
}

/**
 * The identity of every byte of `source`, read one chunk at a time.
 *
 * Fails with `content-id.short-read` when a read returns other than the bytes
 * asked for, which means the source changed while it was read. Rejects with the
 * signal's reason when `signal` aborts, as the source's own read does, so an
 * abort has one form whichever of the two notices it first.
 */
export async function contentIdOf(
  source: ByteSource,
  digest: Digest,
  options: HashingOptions = {},
): Promise<DomainResult<ContentIdentity>> {
  const { signal, onProgress } = options;
  if (!Number.isSafeInteger(source.size) || source.size < 0) {
    throw new RangeError('A byte source reports its size as a whole number of bytes.');
  }

  const hasher = createContentHasher(digest);
  for (let offset = 0; offset < source.size; offset += CONTENT_CHUNK_BYTES) {
    signal?.throwIfAborted();
    const length = Math.min(CONTENT_CHUNK_BYTES, source.size - offset);
    const bytes = await source.read(offset, length, signal);
    if (bytes.length !== length) {
      return fail(
        failure(
          'content-id.short-read',
          FailureKind.IntegrityViolation,
          'The source returned other than the bytes asked for, so it changed while it was read.',
          { details: { offset, expected: length, received: bytes.length } },
        ),
      );
    }
    await hasher.update(bytes);
    onProgress?.(offset + length, source.size);
  }
  signal?.throwIfAborted();
  return succeed(await hasher.finish());
}

/**
 * Starts hashing content handed over in pieces.
 *
 * A call that rejects leaves the hasher failed rather than ready, since the
 * chunk it was taking may be half taken.
 */
export function createContentHasher(digest: Digest): ContentHasher {
  const chunks = new Chunks(digest);
  let state: 'ready' | 'busy' | 'finished' | 'failed' = 'ready';

  const run = async <TResult>(
    operation: string,
    next: 'ready' | 'finished',
    work: () => Promise<TResult>,
  ): Promise<TResult> => {
    if (state !== 'ready') {
      throw new Error(`A content hasher cannot ${operation} while it is ${state}.`);
    }
    state = 'busy';
    let completed = false;
    try {
      const result = await work();
      completed = true;
      return result;
    } finally {
      state = completed ? next : 'failed';
    }
  };

  return {
    update: async (bytes) => {
      await run('update', 'ready', async () => {
        await chunks.take(bytes);
      });
    },
    finish: async () => await run('finish', 'finished', async () => await chunks.end()),
  };
}

/** Bytes cut into chunks of the construction's size, each digested as it fills. */
class Chunks {
  private readonly digest: Digest;
  private readonly chunkDigests: Uint8Array[] = [];
  private buffer: Uint8Array<ArrayBuffer> | undefined;
  private filled = 0;
  private byteLength = 0;

  constructor(digest: Digest) {
    this.digest = digest;
  }

  /** Takes the next bytes, digesting each chunk they complete. */
  async take(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) {
      // A whole chunk arriving at a chunk boundary is hashed where it lies,
      // so a source read in chunks is never copied.
      if (this.filled === 0 && bytes.length - offset >= CONTENT_CHUNK_BYTES) {
        await this.push(bytes.subarray(offset, offset + CONTENT_CHUNK_BYTES));
        offset += CONTENT_CHUNK_BYTES;
        continue;
      }
      this.buffer ??= new Uint8Array(CONTENT_CHUNK_BYTES);
      const taken = Math.min(CONTENT_CHUNK_BYTES - this.filled, bytes.length - offset);
      this.buffer.set(bytes.subarray(offset, offset + taken), this.filled);
      this.filled += taken;
      offset += taken;
      if (this.filled === CONTENT_CHUNK_BYTES) {
        await this.push(this.buffer);
        this.filled = 0;
      }
    }
    this.byteLength += bytes.length;
  }

  /** Digests the last, shorter chunk and gives the identity of everything taken. */
  async end(): Promise<ContentIdentity> {
    if (this.buffer !== undefined && this.filled > 0) {
      await this.push(this.buffer.subarray(0, this.filled));
    }
    const root = await rootDigest(this.digest, this.byteLength, this.chunkDigests);
    return {
      contentId: unsafeBrandId<'ContentId'>(`c1-${hexOf(root)}`),
      byteLength: this.byteLength,
    };
  }

  private async push(chunk: Uint8Array<ArrayBuffer>): Promise<void> {
    this.chunkDigests.push(await digestOf(this.digest, chunk));
  }
}

/** The digest over the length and every chunk's digest. */
async function rootDigest(
  digest: Digest,
  byteLength: number,
  chunkDigests: readonly Uint8Array[],
): Promise<Uint8Array> {
  const input = new Uint8Array(LENGTH_BYTES + DIGEST_BYTES * chunkDigests.length);
  const view = new DataView(input.buffer);
  view.setUint32(0, Math.floor(byteLength / 2 ** 32));
  view.setUint32(4, byteLength >>> 0);
  chunkDigests.forEach((chunk, index) => {
    input.set(chunk, LENGTH_BYTES + DIGEST_BYTES * index);
  });
  return await digestOf(digest, input);
}

/**
 * The fingerprint of a project state, from its compact canonical document.
 *
 * Takes {@link CanonicalJson} rather than any text, because the fingerprint of
 * a state must not depend on how its text was laid out: the pretty form of the
 * same document would give a different digest.
 */
export async function fingerprintOf(
  text: CanonicalJson,
  digest: Digest,
): Promise<StateFingerprint> {
  const bytes = await digestOf(digest, encodeUtf8(text));
  return unsafeBrandId<'StateFingerprint'>(`s1-${hexOf(bytes)}`);
}

/** Digests bytes, holding the port to the size SHA-256 produces. */
async function digestOf(digest: Digest, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const result = await digest(bytes);
  if (result.length !== DIGEST_BYTES) {
    throw new Error(
      `The digest port returned ${String(result.length)} bytes; SHA-256 produces ${String(DIGEST_BYTES)}.`,
    );
  }
  return result;
}
