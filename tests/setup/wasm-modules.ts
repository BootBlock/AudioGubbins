/**
 * Builds the WebAssembly modules before the tests, and hands them to every
 * test project that asks: the canonical DSP module's bytes (ADR-0031), and
 * where the codec module and the MP3 and Vorbis encoder modules were written
 * (ADR-0091), which are large enough that a test reads one only where it needs
 * it.
 *
 * Built rather than read from a committed file, so no run starts against a
 * module older than its source. Cargo rebuilds only what changed, and an
 * encoder module is rebuilt only when the hash of its inputs changes, so a run
 * whose sources are unchanged costs a check.
 *
 * In watch mode Vitest runs this setup once per process, so it also builds
 * again before every rerun and provides the new modules. An edit to the
 * crates starts a rerun (`forceRerunTriggers` in `vitest.config.ts`), which
 * then tests the modules built from that edit.
 */

import { readFileSync } from 'node:fs';

import type { TestProject } from 'vitest/node';

// The provided values' types are declared once, beside the helpers that read them.
import type {} from '@audiogubbins/audio-engine/testing';
import type {} from '@audiogubbins/codec-runtime/testing';

import { buildWasmModules } from '../../tools/build-wasm.mjs';

export default async function setup(project: TestProject): Promise<void> {
  const provideBuilt = async (): Promise<void> => {
    const built = await buildWasmModules();
    project.provide('dspModuleBytes', [...readFileSync(built.dsp)]);
    project.provide('codecModulePath', built.codec);
    project.provide('encoderModulePaths', { mp3: built.mp3, vorbis: built.vorbis });
  };
  await provideBuilt();
  project.onTestsRerun(provideBuilt);
}
