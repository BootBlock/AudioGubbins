/**
 * Builds the canonical DSP module once before the tests, and hands its bytes
 * to every test project that asks (ADR-0031).
 *
 * Built rather than read from a committed file, so no test runs against a
 * module older than the crates. Cargo rebuilds only what changed, so a run
 * whose crates are unchanged costs a check.
 */

import { readFileSync } from 'node:fs';

import type { TestProject } from 'vitest/node';

import { buildDspModule } from '../../tools/build-wasm.mjs';

export default function setup(project: TestProject): void {
  const path = buildDspModule();
  project.provide('dspModuleBytes', [...readFileSync(path)]);
}

declare module 'vitest' {
  export interface ProvidedContext {
    /** The canonical DSP module, as bytes, for the engine's tests to instantiate. */
    dspModuleBytes: number[];
  }
}
