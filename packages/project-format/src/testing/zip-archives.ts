/**
 * Byte ports in memory and archives built from them, for the ZIP tests.
 *
 * The source records every read it is asked for, so a test proves an entry
 * was streamed in chunks rather than asked for whole, and the sink records
 * whether it was closed or abandoned, so a test proves a failed archive is
 * never closed.
 */

import { expectSuccess } from '@audiogubbins/domain/testing';

import type { ByteSink, ByteSource } from '../byte-ports.js';
import { openZip, type ZipArchive, type ZipEntry, readVerified } from '../zip-reading.js';
import { writeZip, type ZipEntryInput, type ZipWritingOptions } from '../zip-writing.js';
import { immediateTurns } from './host-turns.js';
import { seededRandom } from './random-values.js';

/** One read a source was asked for. */
export interface RecordedRead {
  readonly offset: number;
  readonly length: number;
}

/** A source over bytes in memory that records the reads it is asked for. */
export interface SpySource extends ByteSource {
  readonly reads: RecordedRead[];
}

/** A source over `bytes` that records each read, and copies what it returns. */
export function spySource(bytes: Uint8Array): SpySource {
  const reads: RecordedRead[] = [];
  return {
    size: bytes.length,
    reads,
    read: (offset, length) => {
      reads.push({ offset, length });
      return Promise.resolve(bytes.slice(offset, offset + length));
    },
  };
}

/** A sink in memory that records how it ended. */
export interface MemorySink extends ByteSink {
  readonly chunks: Uint8Array[];
  readonly ending: { state: 'open' | 'closed' | 'aborted'; reason?: unknown };
  bytes(): Uint8Array<ArrayBuffer>;
}

/** A sink that keeps every chunk, and refuses a write after it has ended. */
export function memorySink(): MemorySink {
  const chunks: Uint8Array[] = [];
  const ending: MemorySink['ending'] = { state: 'open' };
  const ensureOpen = (): void => {
    if (ending.state !== 'open') throw new Error(`The sink is already ${ending.state}.`);
  };
  return {
    chunks,
    ending,
    write: (chunk) => {
      ensureOpen();
      chunks.push(chunk.slice());
      return Promise.resolve();
    },
    close: () => {
      ensureOpen();
      ending.state = 'closed';
      return Promise.resolve();
    },
    abort: (reason) => {
      ensureOpen();
      ending.state = 'aborted';
      ending.reason = reason;
      return Promise.resolve();
    },
    bytes: () => {
      const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    },
  };
}

/** Deterministic bytes of the given length. */
export function patternBytes(length: number, seed = 1): Uint8Array<ArrayBuffer> {
  const random = seededRandom(seed);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 4) {
    const word = Math.floor(random.next() * 4_294_967_296);
    bytes[index] = word & 0xff;
    if (index + 1 < length) bytes[index + 1] = (word >>> 8) & 0xff;
    if (index + 2 < length) bytes[index + 2] = (word >>> 16) & 0xff;
    if (index + 3 < length) bytes[index + 3] = word >>> 24;
  }
  return bytes;
}

/** The archive of `entries`, which must write. */
export async function zipOf(
  entries: readonly ZipEntryInput[],
  options: Partial<ZipWritingOptions> = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const sink = memorySink();
  expectSuccess(await writeZip(entries, sink, { yieldToHost: immediateTurns, ...options }));
  return sink.bytes();
}

/** The archive in `bytes`, which must open. */
export async function opened(bytes: Uint8Array): Promise<ZipArchive> {
  return expectSuccess(await openZip(spySource(bytes), { yieldToHost: immediateTurns }));
}

/** Every byte of `entry`, read and checked against its CRC-32. */
export async function contentOf(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  expectSuccess(
    await readVerified(
      entry,
      (chunk) => {
        chunks.push(chunk);
        return Promise.resolve();
      },
      { yieldToHost: immediateTurns },
    ),
  );
  const bytes = new Uint8Array(entry.size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
