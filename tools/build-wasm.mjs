#!/usr/bin/env node
/**
 * Builds the canonical DSP module the audio engine instantiates (ADR-0031).
 *
 * The module is a build artefact, so it is built rather than committed: the
 * crates are its source, and a committed binary could differ from them with
 * nothing to say so. Cargo rebuilds only what changed, so the tests' global
 * setup runs this before every run and every rerun in watch mode at little
 * cost (`tests/setup/dsp-module.ts`).
 *
 * The module is written to `target/wasm/audiogubbins-dsp.wasm`, which the
 * ignore rules keep out of the tree. The application's build and the engine's
 * tests read it from there.
 *
 * The WebAssembly features the module may use are named here rather than left
 * to the toolchain, whose defaults for the target change between releases:
 * `rust-toolchain.toml` follows the stable channel, so a new release could
 * otherwise start emitting instructions a browser at the floor
 * (`BROWSER_TARGETS` in `apps/web/vite.config.ts`) cannot compile.
 * `tests/architecture/dsp-module-features.test.ts` holds the built module's
 * `target_features` section to the floor.
 *
 * Usage:
 *   node tools/build-wasm.mjs
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The target the module is built for, and the crate it is built from: what
 * the third-party notices read the shipped crates from, as well as the build.
 */
export const WASM_TARGET = 'wasm32-unknown-unknown';
export const WASM_CRATE = 'audiogubbins-wasm-bindings';

/**
 * The features the module is built with: the MVP, and each addition every
 * browser at the floor compiles. Each was in Chrome and Edge by 96, Firefox by
 * 79 and Safari by 15; LLVM adds `bulk-memory-opt` and
 * `call-indirect-overlong` with the first and the fifth.
 */
const WASM_FEATURES = [
  'bulk-memory',
  'multivalue',
  'mutable-globals',
  'nontrapping-fptoint',
  'reference-types',
  'sign-ext',
];

/**
 * The compiler flags of the build, as cargo reads them from
 * `CARGO_ENCODED_RUSTFLAGS`, separated by the unit separator. They replace any
 * flags a contributor's environment sets, so every machine builds one module.
 */
const RUSTFLAGS = [
  '-C',
  'target-cpu=mvp',
  '-C',
  `target-feature=${WASM_FEATURES.map((feature) => `+${feature}`).join(',')}`,
].join('\x1f');

/** Where the module is written, for the build and the tests to read. */
export const DSP_MODULE = join(REPO_ROOT, 'target', 'wasm', 'audiogubbins-dsp.wasm');

/** Builds the module, and throws with cargo's own output if it fails. */
export function buildDspModule() {
  const build = spawnSync(
    'cargo',
    ['build', '--release', '--locked', '--target', WASM_TARGET, '-p', WASM_CRATE],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'pipe'],
      env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: RUSTFLAGS },
    },
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
    join(REPO_ROOT, 'target', WASM_TARGET, 'release', `${WASM_CRATE.replaceAll('-', '_')}.wasm`),
    DSP_MODULE,
  );
  return DSP_MODULE;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Built ${buildDspModule()}`);
}
