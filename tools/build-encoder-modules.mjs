/**
 * Builds the MP3 and Vorbis encoder modules from the C source vendored under
 * `third_party/`, each with the interface of its own in `native/`, into a
 * WebAssembly module of its own file (ADR-0091): LAME stays a separate,
 * replaceable module, and the codec worker loads an encoder only when its
 * format is exported.
 *
 * Each is compiled by the pinned Zig (`zig-toolchain.mjs`) for `wasm32-wasi`
 * against Zig's wasi-libc, as a reactor with no `_start`, with the WebAssembly
 * features the Rust modules are held to (`WASM_FEATURES` in `build-wasm.mjs`,
 * which passes them), and without fused
 * floating-point contractions, so its arithmetic is IEEE-754 as written on
 * every machine. Our interface is compiled with every warning an error; the
 * vendored libraries are compiled unmodified, their warnings silenced.
 * Sources are named relative to the repository, so the file names their
 * checks embed say nothing of the machine that built them, and the debugging
 * sections are dropped from the module, keeping its `target_features`.
 *
 * A module is rebuilt only when what it is built from changed: a stamp beside
 * it holds the SHA-256 of the compiler's version, the flags, this file and
 * every file of the sources' directories, so a run with nothing changed costs
 * reading them.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ZIG_VERSION, pinnedZig } from './zig-toolchain.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the MP3 encoder module is written. */
export const MP3_MODULE = join(REPO_ROOT, 'target', 'wasm', 'audiogubbins-mp3.wasm');

/** Where the Vorbis encoder module is written. */
export const VORBIS_MODULE = join(REPO_ROOT, 'target', 'wasm', 'audiogubbins-vorbis.wasm');

/** Where Zig keeps what it compiled, inside the ignored build output. */
const ZIG_CACHE = join(REPO_ROOT, 'target', 'zig-cache');

/**
 * One encoder module: its interface, the vendored sources compiled into it,
 * the directories searched for headers and hashed for the stamp, and the
 * definitions it is compiled with, every path relative to the repository.
 *
 * @typedef {object} EncoderModule
 * @property {string} output
 * @property {string} wrapper
 * @property {readonly string[]} sources
 * @property {readonly string[]} includes
 * @property {readonly string[]} defines
 */

const LAME_SOURCES = [
  'VbrTag',
  'bitstream',
  'encoder',
  'fft',
  'gain_analysis',
  'id3tag',
  'lame',
  'mpglib_interface',
  'newmdct',
  'presets',
  'psymodel',
  'quantize',
  'quantize_pvt',
  'reservoir',
  'set_get',
  'tables',
  'takehiro',
  'util',
  'vbrquantize',
  'version',
].map((name) => `third_party/lame/libmp3lame/${name}.c`);

/** libvorbis's encoder and what it shares with the decoder; not `vorbisfile` or the tools with a `main`. */
const LIBVORBIS_SOURCES = [
  'analysis',
  'bitrate',
  'block',
  'codebook',
  'envelope',
  'floor0',
  'floor1',
  'info',
  'lookup',
  'lpc',
  'lsp',
  'mapping0',
  'mdct',
  'psy',
  'registry',
  'res0',
  'sharedbook',
  'smallft',
  'synthesis',
  'vorbisenc',
  'window',
].map((name) => `third_party/libvorbis/lib/${name}.c`);

/** @type {readonly EncoderModule[]} */
const ENCODER_MODULES = [
  {
    output: MP3_MODULE,
    wrapper: 'native/mp3-encoder/mp3_module.c',
    sources: LAME_SOURCES,
    includes: ['native/mp3-encoder', 'third_party/lame/include', 'third_party/lame/libmp3lame'],
    defines: ['HAVE_CONFIG_H'],
  },
  {
    output: VORBIS_MODULE,
    wrapper: 'native/vorbis-encoder/vorbis_module.c',
    // Only libogg's bit packer: the application's own writer makes the Ogg pages.
    sources: ['third_party/libogg/src/bitwise.c', ...LIBVORBIS_SOURCES],
    includes: [
      'native/vorbis-encoder/config',
      'third_party/libogg/include',
      'third_party/libvorbis/include',
      'third_party/libvorbis/lib',
    ],
    defines: [],
  },
];

/**
 * The flags every file of every module is compiled and linked with, given the
 * WebAssembly features as LLVM names them.
 *
 * @param {readonly string[]} features
 * @returns {string[]}
 */
function commonFlags(features) {
  return [
    '-target',
    'wasm32-wasi',
    '-O2',
    `-mcpu=mvp${features.map((feature) => `+${feature.replaceAll('-', '_')}`).join('')}`,
    '-ffp-contract=off',
    // Zig defines NDEBUG when it optimises; the libraries' own release builds
    // keep their checks, which stop a corrupt encoder rather than run on.
    '-UNDEBUG',
  ];
}

/** The flags our own interface is held to. */
const WRAPPER_FLAGS = ['-std=c11', '-Wall', '-Wextra', '-Wpedantic', '-Werror'];

/** The flags of the link: a reactor, whose `_initialize` the caller runs, with no `_start`. */
const LINK_FLAGS = ['-mexec-model=reactor', '-w'];

/**
 * Every file under a repository directory, as repository paths in order.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function filesUnder(directory) {
  return readdirSync(join(REPO_ROOT, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(REPO_ROOT, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .toSorted();
}

/**
 * The directories whose files a module is built from: its interface's, its
 * header directories, and each source's.
 *
 * @param {EncoderModule} module
 * @returns {string[]}
 */
function inputDirectories(module) {
  const directories = new Set([
    dirname(module.wrapper),
    ...module.includes,
    ...module.sources.map((source) => dirname(source)),
  ]);
  return [...directories].toSorted();
}

/**
 * The SHA-256 of everything a module's bytes depend on.
 *
 * @param {readonly string[]} flags
 * @param {EncoderModule} module
 * @returns {string}
 */
function inputsHash(flags, module) {
  const hash = createHash('sha256');
  hash.update(`zig ${ZIG_VERSION}\0`);
  hash.update(`${JSON.stringify({ flags, WRAPPER_FLAGS, LINK_FLAGS, module })}\0`);
  hash.update(readFileSync(fileURLToPath(import.meta.url)));
  const files = new Set(inputDirectories(module).flatMap((directory) => filesUnder(directory)));
  for (const file of [...files].toSorted()) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(join(REPO_ROOT, file)));
  }
  return hash.digest('hex');
}

/**
 * Runs the compiler from the repository's root, throwing with its output if
 * it fails.
 *
 * @param {string} zig
 * @param {readonly string[]} args
 * @param {string} what
 */
function compile(zig, args, what) {
  const run = spawnSync(zig, ['cc', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: ZIG_CACHE, ZIG_LOCAL_CACHE_DIR: ZIG_CACHE },
  });
  if (run.error !== undefined || run.status !== 0) {
    throw new Error(
      `zig cc could not build ${what}:\n${run.error?.message ?? ''}${run.stdout}${run.stderr}`,
    );
  }
}

/**
 * A module's bytes without its debugging sections: every custom section whose
 * name begins `.debug`. The others, `target_features` among them, are kept.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function withoutDebugSections(bytes) {
  const kept = [bytes.subarray(0, 8)];
  let at = 8;
  const unsigned = () => {
    let value = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[at] ?? 0;
      at += 1;
      value += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);
    return value;
  };
  while (at < bytes.length) {
    const start = at;
    const id = bytes[at] ?? 0;
    at += 1;
    const size = unsigned();
    const end = at + size;
    let debug = false;
    if (id === 0) {
      const nameLength = unsigned();
      debug = new TextDecoder().decode(bytes.subarray(at, at + nameLength)).startsWith('.debug');
    }
    if (!debug) kept.push(bytes.subarray(start, end));
    at = end;
  }
  const out = new Uint8Array(kept.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Builds one module where its stamp does not hold its inputs' hash.
 *
 * @param {() => Promise<string>} zig the compiler, obtained only where needed
 * @param {readonly string[]} flags
 * @param {EncoderModule} module
 */
async function buildModule(zig, flags, module) {
  const stamp = `${module.output}.inputs`;
  const hash = inputsHash(flags, module);
  if (
    existsSync(module.output) &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8').trim() === hash
  ) {
    return;
  }
  const compiler = await zig();
  const name = module.output.split(/[\\/]/u).at(-1) ?? module.output;
  const work = join(REPO_ROOT, 'target', 'encoder-modules', name.replace(/\.wasm$/u, ''));
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const includes = module.includes.flatMap((directory) => ['-I', directory]);
  const defines = module.defines.map((define) => `-D${define}`);
  const wrapperObject = relative(REPO_ROOT, join(work, 'wrapper.o'));
  compile(
    compiler,
    [
      ...flags,
      ...WRAPPER_FLAGS,
      ...includes,
      ...defines,
      '-c',
      module.wrapper,
      '-o',
      wrapperObject,
    ],
    module.wrapper,
  );
  const linked = join(work, name);
  compile(
    compiler,
    [
      ...flags,
      ...LINK_FLAGS,
      ...includes,
      ...defines,
      ...module.sources,
      wrapperObject,
      '-o',
      relative(REPO_ROOT, linked),
    ],
    name,
  );
  mkdirSync(dirname(module.output), { recursive: true });
  // Written beside the module and renamed over it, so a run that stops here
  // never leaves a module its stamp does not describe.
  const written = `${module.output}.partial`;
  writeFileSync(written, withoutDebugSections(readFileSync(linked)));
  renameSync(written, module.output);
  writeFileSync(stamp, `${hash}\n`);
}

/**
 * Builds whichever encoder modules changed, answering their paths. The
 * compiler is obtained, and downloaded where it is not cached, only when one
 * has to be built.
 *
 * @param {readonly string[]} features the WebAssembly features the modules may use
 * @returns {Promise<{ readonly mp3: string, readonly vorbis: string }>}
 */
export async function buildEncoderModules(features) {
  const flags = commonFlags(features);
  /** @type {Promise<string> | undefined} */
  let found;
  const zig = () => {
    found ??= pinnedZig();
    return found;
  };
  for (const module of ENCODER_MODULES) await buildModule(zig, flags, module);
  return { mp3: MP3_MODULE, vorbis: VORBIS_MODULE };
}
