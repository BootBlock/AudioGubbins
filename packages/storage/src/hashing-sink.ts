/**
 * A sink that takes the identity of every byte written through it to another,
 * so an export's provenance can say what it wrote (REQ-STOR-197).
 *
 * The bytes are hashed as they pass, in the content construction's chunks, so a
 * bundle larger than memory is identified without being held or read back
 * (REQ-EXEC-216). The identity is known once the sink closes, and never for a
 * sink abandoned, whose bytes were never kept.
 */

import {
  createContentHasher,
  type ByteSink,
  type ContentHasher,
  type ContentIdentity,
  type Digest,
} from '@audiogubbins/project-format';

/** The bytes as the hasher takes them: in memory of their own, copied where they are shared. */
function owned(chunk: Uint8Array): Uint8Array<ArrayBuffer> {
  return chunk.buffer instanceof ArrayBuffer
    ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    : chunk.slice();
}

/** Writes through to `inner`, taking the identity of what it writes (see the module comment). */
export class HashingSink implements ByteSink {
  private readonly inner: ByteSink;
  private readonly hasher: ContentHasher;
  private finished: ContentIdentity | undefined;

  constructor(inner: ByteSink, digest: Digest) {
    this.inner = inner;
    this.hasher = createContentHasher(digest);
  }

  /** The identity of every byte written. Asking before the sink has closed is a defect. */
  get identity(): ContentIdentity {
    if (this.finished === undefined) {
      throw new Error('A hashing sink knows what it wrote only once it has closed.');
    }
    return this.finished;
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.hasher.update(owned(chunk));
    await this.inner.write(chunk);
  }

  async close(): Promise<void> {
    const identity = await this.hasher.finish();
    await this.inner.close();
    this.finished = identity;
  }

  async abort(reason?: unknown): Promise<void> {
    await this.inner.abort(reason);
  }
}
