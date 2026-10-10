/**
 * The files the codec module reads, and its one import, which reads them
 * (ADR-0090).
 *
 * A decode session names its file by a number; the import copies the bytes
 * the module asks for from that file's `SyncAudioBytes` into the module's
 * memory. The import must never throw, which would unwind through the module
 * and leave its state half-changed, so a read that throws is answered as a
 * failure, and what it threw is kept for the session to report.
 */

import type { SyncAudioBytes } from '@audiogubbins/codecs';

import { thrownName } from './thrown-name.js';

/** A registered file, and what its last failed read threw. */
interface HostFile {
  readonly bytes: SyncAudioBytes;
  failure: string | undefined;
}

/** What the import answers for a read that failed. */
const READ_FAILED = -1;

/** The files one module instance reads, by the number each is named by. */
export class HostFiles {
  readonly #files = new Map<number, HostFile>();
  #next = 1;
  /** The module's memory's buffer as it is now, given once the module exists. */
  #memory: () => ArrayBuffer = () => new ArrayBuffer(0);

  /** Gives the reads the module's memory to copy into. */
  attach(memory: () => ArrayBuffer): void {
    this.#memory = memory;
  }

  /** Registers `bytes`, answering the number that names it. */
  register(bytes: SyncAudioBytes): number {
    const source = this.#next;
    this.#next += 1;
    this.#files.set(source, { bytes, failure: undefined });
    return source;
  }

  /** Forgets a file, which the module will not read again. */
  forget(source: number): void {
    this.#files.delete(source);
  }

  /** What the last failed read of `source` threw, if it threw. */
  failureOf(source: number): string | undefined {
    return this.#files.get(source)?.failure;
  }

  /**
   * The import: copies the bytes of `source` from `offset` into the module's
   * memory at `destination`, at most `length`, answering how many, or -1.
   */
  readonly read = (source: number, offset: number, destination: number, length: number): number => {
    const file = this.#files.get(source);
    if (file === undefined) return READ_FAILED;
    try {
      // The ABI's addresses and lengths are unsigned; JavaScript reads them
      // signed.
      const into = new Uint8Array(this.#memory(), destination >>> 0, length >>> 0);
      const copied = file.bytes.readInto(offset, into);
      return Number.isSafeInteger(copied) && copied >= 0 && copied <= into.length
        ? copied
        : READ_FAILED;
    } catch (error) {
      // A file the person removed, or whose permission was withdrawn, throws;
      // the module answers the read as unreadable and the session says why.
      file.failure = thrownName(error);
      return READ_FAILED;
    }
  };
}
