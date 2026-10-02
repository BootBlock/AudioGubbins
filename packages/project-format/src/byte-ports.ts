/**
 * The ports bytes reach this package through.
 *
 * The package is pure (ADR-0020): it hashes, writes and reads formats, and
 * never opens a file. A source file may be larger than memory (REQ-EXEC-216),
 * so bytes arrive as ranges read on demand and leave as chunks written in
 * order, and the storage adapters decide what stands behind each.
 */

/**
 * Bytes that can be read in ranges, such as a file the user chose.
 *
 * `read` resolves to exactly `length` bytes when the range lies within `size`;
 * anything else means the bytes changed or vanished under the reader, which a
 * caller reports rather than trusts. A read rejects when `signal` aborts, with
 * the signal's reason.
 */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * Somewhere bytes are written to in order, such as a file being saved.
 *
 * Nothing written is final until `close` resolves. `abort` abandons what was
 * written, so a torn file is never mistaken for a whole one; a sink cannot be
 * written to after either.
 */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

/**
 * SHA-256 of the given bytes, as 32 bytes.
 *
 * Injected, because the digest belongs to the platform (Web Crypto in the
 * browser, `node:crypto` in a test) and this package reaches no global. The
 * bytes are never shared memory, which Web Crypto refuses to digest.
 */
export type Digest = (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;
