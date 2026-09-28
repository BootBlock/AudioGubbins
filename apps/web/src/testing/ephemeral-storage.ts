/**
 * Test support for the browser storage the application reads and writes, which
 * is `../state/state-storage.ts`.
 */

import type { KeyValueStorage } from '../state/state-storage.js';

/** Storage that keeps values in memory only, for a test. */
export function ephemeralStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    read: (key) => values.get(key) ?? null,
    write: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
}
