/**
 * Builds the WebAssembly modules before the tests, and hands them to every
 * test project that asks: the canonical DSP module's bytes (ADR-0031), and
 * where the codec module was written (ADR-0091), which is large enough that
 * a test reads it only where it needs it.
 *
 * The prebuilt MP3 and Vorbis encoders are not built here: they are the files
 * `wasm-media-encoders` installs (ADR-0091), and where they are is provided
 * as the codec module's is.
 *
 * Built rather than read from a committed file, so no run starts against a
 * module older than the crates. Cargo rebuilds only what changed, so a run
 * whose crates are unchanged costs a check.
 *
 * In watch mode Vitest runs this setup once per process, so it also builds
 * again before every rerun and provides the new modules. An edit to the
 * crates starts a rerun (`forceRerunTriggers` in `vitest.config.ts`), which
 * then tests the modules built from that edit.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { TestProject } from 'vitest/node';

// The provided values' types are declared once, beside the helpers that read them.
import type {} from '@audiogubbins/audio-engine/testing';
import type {} from '@audiogubbins/codec-runtime/testing';

import { buildWasmModules } from '../../tools/build-wasm.mjs';
import { inRepository } from '../repository.js';

/** Resolves a module as the codec runtime, whose dependency the prebuilt encoders are. */
const codecRuntimeRequire = createRequire(
  inRepository('packages', 'codec-runtime', 'package.json'),
);

export default function setup(project: TestProject): void {
  project.provide('prebuiltEncoderPaths', {
    mp3: codecRuntimeRequire.resolve('wasm-media-encoders/wasm/mp3'),
    vorbis: codecRuntimeRequire.resolve('wasm-media-encoders/wasm/ogg'),
  });
  const provideBuilt = (): void => {
    const built = buildWasmModules();
    project.provide('dspModuleBytes', [...readFileSync(built.dsp)]);
    project.provide('codecModulePath', built.codec);
  };
  provideBuilt();
  project.onTestsRerun(provideBuilt);
}
