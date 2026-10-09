/**
 * The renders the cached preview producer keeps, bounded in bytes and given
 * up least recently used first.
 *
 * A render is derived data (REQ-STOR-027): it is never the only record of a
 * sound, and giving one up costs only the time to make it again. A render a
 * reader holds is never given up under it, so the bound is met by giving up
 * renders nothing holds, the least recently used first, and a render that
 * cannot fit beside those held is declined rather than kept over the bound.
 * What a value takes may fall while it is kept, as a render's does once it
 * is made and lets go of the memory its making held, and never rise, so a
 * value admitted within the bound stays within it.
 */

import { FailureKind, fail, failure, succeed, type DomainResult } from '@audiogubbins/domain';

/** What the cache needs of what it keeps. */
export interface Kept {
  /** Bytes it takes: at most what it took when it was admitted. */
  readonly bytes: number;
  /** Lets go of it once given up: a render still being made stops. */
  discard(): void;
}

/** One kept value, the bytes it is counted at, and how many readers hold it. */
interface Entry<T extends Kept> {
  readonly value: T;
  bytes: number;
  holders: number;
}

/** Bytes as a person reads them, in mebibytes. */
function mebibytes(bytes: number): string {
  return `${String(Math.ceil(bytes / 2 ** 20))} MiB`;
}

/** Values kept by key, within a bound in bytes. */
export class RenderCache<T extends Kept> {
  readonly bound: number;
  /** In the order they were last used, the least recently used first. */
  readonly #entries = new Map<string, Entry<T>>();
  #bytes = 0;

  constructor(bound: number) {
    this.bound = bound;
  }

  /** Bytes the values kept take. */
  get bytes(): number {
    return this.#bytes;
  }

  /** Every value kept, the least recently used first. */
  values(): readonly T[] {
    return [...this.#entries.values()].map((entry) => entry.value);
  }

  /** The value under `key`, held for one more reader and made the most recently used. */
  hold(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    entry.holders += 1;
    return entry.value;
  }

  /**
   * Keeps `value` under `key`, held by one reader, giving up values nothing
   * holds until it fits, or declines it with the reason, discarding nothing.
   */
  admit(key: string, value: T): DomainResult<void> {
    if (value.bytes > this.bound) {
      return fail(
        failure(
          'preview.render-too-long',
          FailureKind.Rejected,
          `Its render would take ${mebibytes(value.bytes)} while it is made, more than the ${mebibytes(this.bound)} kept for previews.`,
        ),
      );
    }
    const free = [...this.#entries].filter(([, entry]) => entry.holders === 0);
    const freeable = free.reduce((total, [, entry]) => total + entry.bytes, 0);
    if (this.#bytes - freeable + value.bytes > this.bound) {
      return fail(
        failure(
          'preview.cache-full',
          FailureKind.Retryable,
          `The renders being listened to already take ${mebibytes(this.#bytes - freeable)} of the ${mebibytes(this.bound)} kept for previews.`,
        ),
      );
    }
    for (const [unheld, entry] of free) {
      if (this.#bytes + value.bytes <= this.bound) break;
      this.#forget(unheld, entry);
    }
    this.#entries.set(key, { value, bytes: value.bytes, holders: 1 });
    this.#bytes += value.bytes;
    return succeed(undefined);
  }

  /**
   * Counts the value under `key` at what it takes now, which has fallen. A
   * value that says it takes more is a fault in it: it was admitted for less.
   */
  recount(key: string, value: T): void {
    const entry = this.#entries.get(key);
    if (entry?.value !== value) return;
    if (value.bytes > entry.bytes)
      throw new Error('A kept value never grows past what it was admitted at.');
    this.#bytes -= entry.bytes - value.bytes;
    entry.bytes = value.bytes;
  }

  /** Lets one reader of the value under `key` go; with none left, it stays until the bound needs it. */
  release(key: string, value: T): void {
    const entry = this.#entries.get(key);
    if (entry?.value === value) entry.holders -= 1;
  }

  /** Gives up the value under `key`, held or not, as a render that failed is. */
  evict(key: string, value: T): void {
    const entry = this.#entries.get(key);
    if (entry?.value === value) this.#forget(key, entry);
  }

  #forget(key: string, entry: Entry<T>): void {
    this.#entries.delete(key);
    this.#bytes -= entry.bytes;
    entry.value.discard();
  }
}
