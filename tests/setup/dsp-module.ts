/**
 * Builds the canonical DSP module before the tests, and hands its bytes to
 * every test project that asks (ADR-0031).
 *
 * Built rather than read from a committed file, so no run starts against a
 * module older than the crates. Cargo rebuilds only what changed, so a run
 * whose crates are unchanged costs a check.
 *
 * In watch mode Vitest runs this setup once per process, so it also builds
 * again before every rerun and provides the new bytes. An edit to the crates
 * starts a rerun (`forceRerunTriggers` in `vitest.config.ts`), which then tests
 * the module built from that edit.
 */

import { readFileSync } from 'node:fs';

import type { TestProject } from 'vitest/node';

import { buildDspModule } from '../../tools/build-wasm.mjs';

export default function setup(project: TestProject): void {
  const provideBuilt = (): void => {
    project.provide('dspModuleBytes', [...readFileSync(buildDspModule())]);
  };
  provideBuilt();
  project.onTestsRerun(provideBuilt);
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The canonical DSP module, as bytes, for the engine's tests to instantiate. */
    dspModuleBytes: number[];
  }
}
