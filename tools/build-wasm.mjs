#!/usr/bin/env node
/**
 * Builds the WebAssembly modules the application instantiates: the canonical
 * DSP module the audio engine runs (ADR-0031), and the codec module the codec
 * worker runs (ADR-0091). Each is a separate file, so the engine never loads
 * a codec it does not use.
 *
 * The modules are build artefacts, so they are built rather than committed:
 * the crates are their source, and a committed binary could differ from them
 * with nothing to say so. Cargo rebuilds only what changed, so the tests'
 * global setup runs this before every run and every rerun in watch mode at
 * little cost (`tests/setup/wasm-modules.ts`).
 *
 * The modules are written to `target/wasm/audiogubbins-dsp.wasm` and
 * `target/wasm/audiogubbins-codecs.wasm`, which the ignore rules keep out of
 * the tree. The application's build and the tests read them from there.
 *
 * The WebAssembly features the modules may use are named here rather than
 * left to the toolchain, whose defaults for the target change between
 * releases: `rust-toolchain.toml` follows the stable channel, so a new release
 * could otherwise start emitting instructions a browser at the floor
 * (`BROWSER_TARGETS` in `apps/web/vite.config.ts`) cannot compile.
 * `tests/architecture/wasm-module-features.test.ts` holds each built module's
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

/** The target the modules are built for. */
export const WASM_TARGET = 'wasm32-unknown-unknown';

/** The crate the canonical DSP module is built from. */
export const DSP_CRATE = 'audiogubbins-wasm-bindings';

/** The crate the codec module is built from. */
export const CODEC_CRATE = 'audiogubbins-codec-bindings';

/**
 * Every crate built into a module the application ships: what the
 * third-party notices read the shipped crates from, as well as the build.
 */
export const SHIPPED_CRATES = Object.freeze([DSP_CRATE, CODEC_CRATE]);

/**
 * The features the modules are built with: the MVP, and each addition every
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

/** Where the DSP module is written, for the build and the tests to read. */
export const DSP_MODULE = join(REPO_ROOT, 'target', 'wasm', 'audiogubbins-dsp.wasm');

/** Where the codec module is written. */
export const CODEC_MODULE = join(REPO_ROOT, 'target', 'wasm', 'audiogubbins-codecs.wasm');

/** Each crate, and the module file it is built into. */
const MODULES = new Map([
  [DSP_CRATE, DSP_MODULE],
  [CODEC_CRATE, CODEC_MODULE],
]);

/**
 * Builds the modules of `crates` in one cargo run, which shares what they
 * share, and copies each to its file; throws with cargo's own output if the
 * build fails.
 *
 * @param {readonly string[]} crates
 */
function build(crates) {
  const build = spawnSync(
    'cargo',
    [
      'build',
      '--release',
      '--locked',
      '--target',
      WASM_TARGET,
      ...crates.flatMap((crate) => ['-p', crate]),
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'pipe'],
      env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: RUSTFLAGS },
    },
  );
  if (build.error !== undefined) {
    throw new Error(
      `cargo could not be started (${build.error.message}). The Rust toolchain in rust-toolchain.toml, with its wasm32-unknown-unknown target, builds the WebAssembly modules.`,
    );
  }
  if (build.status !== 0) {
    throw new Error(`cargo could not build the WebAssembly modules:\n${build.stderr}`);
  }
  for (const crate of crates) {
    const module = MODULES.get(crate);
    if (module === undefined) throw new Error(`${crate} is built into no module.`);
    mkdirSync(dirname(module), { recursive: true });
    copyFileSync(
      join(REPO_ROOT, 'target', WASM_TARGET, 'release', `${crate.replaceAll('-', '_')}.wasm`),
      module,
    );
  }
}

/** Builds the DSP module, answering its path. */
export function buildDspModule() {
  build([DSP_CRATE]);
  return DSP_MODULE;
}

/** Builds the codec module, answering its path. */
export function buildCodecModule() {
  build([CODEC_CRATE]);
  return CODEC_MODULE;
}

/** Builds both modules, answering their paths. */
export function buildWasmModules() {
  build(SHIPPED_CRATES);
  return { dsp: DSP_MODULE, codec: CODEC_MODULE };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildWasmModules();
  console.log(`Built ${built.dsp}\nBuilt ${built.codec}`);
}
