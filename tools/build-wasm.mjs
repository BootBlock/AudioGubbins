#!/usr/bin/env node
/**
 * Builds the canonical DSP module the audio engine instantiates (ADR-0031).
 *
 * The module is a build artefact, so it is built rather than committed: the
 * crates are its source, and a committed binary could differ from them with
 * nothing to say so. Cargo rebuilds only what changed, so running this before
 * every test run costs little and means no test ever reads a stale module.
 *
 * The module is written to `target/wasm/audiogubbins-dsp.wasm`, which the
 * ignore rules keep out of the tree. The application's build and the engine's
 * tests read it from there.
 *
 * Usage:
 *   node tools/build-wasm.mjs
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = 'wasm32-unknown-unknown';
const CRATE = 'audiogubbins-wasm-bindings';

/** Where the module is written, for the build and the tests to read. */
export const DSP_MODULE = join(REPO_ROOT, 'target', 'wasm', 'audiogubbins-dsp.wasm');

/** Builds the module, and throws with cargo's own output if it fails. */
export function buildDspModule() {
  const build = spawnSync(
    'cargo',
    ['build', '--release', '--locked', '--target', TARGET, '-p', CRATE],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'inherit', 'pipe'] },
  );
  if (build.error !== undefined) {
    throw new Error(
      `cargo could not be started (${build.error.message}). The Rust toolchain in rust-toolchain.toml, with its wasm32-unknown-unknown target, builds the audio engine's DSP module.`,
    );
  }
  if (build.status !== 0) {
    throw new Error(`cargo could not build the DSP module:\n${build.stderr}`);
  }
  mkdirSync(dirname(DSP_MODULE), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, 'target', TARGET, 'release', `${CRATE.replaceAll('-', '_')}.wasm`),
    DSP_MODULE,
  );
  return DSP_MODULE;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Built ${buildDspModule()}`);
}
