/**
 * What another package's tests may take from the storage's test support: the
 * single-writer scenarios every `LeaseCoordinator` must pass (REQ-STOR-098,
 * REQ-STOR-102, ADR-0020), and the in-memory stand-ins for the platform's
 * leases, a directory and a sink, which the application's tests run its project
 * flows over.
 *
 * The scenarios live here, not in one test, so the in-memory coordinator and
 * every platform's coordinator are held to the same behaviour rather than to
 * copies that drift apart. They drive whole sessions through `openProject`,
 * since what the requirement promises is what a window sees: who writes
 * (`writer-scenarios.ts`), what a window reading the project is shown as the
 * writer works and changes (`reader-scenarios.ts`), the lock that keeps a
 * purge apart from media being stored (`storage-lock-scenarios.ts`), and the
 * lock that lets one window change the library at a time
 * (`library-lock-scenarios.ts`).
 *
 * Apart from the package's own entry point: an architecture rule refuses any
 * production module that reaches test support.
 */

import { describe, it } from 'vitest';

import type { LeasePlatform } from './lease-scene.js';
import { LIBRARY_LOCK_SCENARIOS } from './library-lock-scenarios.js';
import { READER_SCENARIOS } from './reader-scenarios.js';
import { STORAGE_LOCK_SCENARIOS } from './storage-lock-scenarios.js';
import { WRITER_SCENARIOS } from './writer-scenarios.js';

export { type LeasePlatform, type LeaseWindows } from './lease-scene.js';
export { MemoryLeaseCoordinator } from './memory-leases.js';
export { MemoryDirectory, type MemorySink, memorySink } from './memory-ports.js';

/** Runs the single-writer scenarios over a platform's coordination. */
export function describeWriteLeaseScenarios(name: string, platform: LeasePlatform): void {
  describe(`one writer per project over ${name} (REQ-STOR-098)`, () => {
    it.each([...WRITER_SCENARIOS, ...READER_SCENARIOS])('%s', async (_title, scenario) => {
      await scenario(platform);
    });
  });
  describe(`the storage-wide lock over ${name} (REQ-STOR-102)`, () => {
    it.each(STORAGE_LOCK_SCENARIOS)('%s', async (_title, scenario) => {
      await scenario(platform);
    });
  });
  describe(`the library's lock over ${name} (REQ-AUDIO-017)`, () => {
    it.each(LIBRARY_LOCK_SCENARIOS)('%s', async (_title, scenario) => {
      await scenario(platform);
    });
  });
}
