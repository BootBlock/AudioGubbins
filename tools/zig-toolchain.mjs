/**
 * The C compiler the encoder modules are built with: Zig's `zig cc`, which
 * compiles C to `wasm32-wasi` with its own clang and wasi-libc and needs
 * nothing else installed (ADR-0091).
 *
 * One release is pinned, by version and by the SHA-256 of each host's archive
 * as https://ziglang.org/download/index.json states them, so every machine
 * compiles the modules with the same compiler and the same C library. The
 * archive is downloaded once into `target/toolchains/`, which the ignore rules
 * keep out of the tree, by the download the pack build uses (the tools' one way
 * to the network), checked against its length and hash before anything is
 * extracted from it, and extracted by the host's own `tar`: Windows 10 and
 * later ship bsdtar, which reads the `.zip` Zig publishes for Windows, and
 * every other host's `tar` reads `.tar.xz`. Nothing is fetched when the cache
 * holds it.
 *
 * `ZIG` may name a compiler already installed instead, which is used only if
 * it is the pinned version.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestOf } from './model-packs/file-digest.mjs';
import { downloadTo } from './model-packs/source-download.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The pinned release. */
export const ZIG_VERSION = '0.17.0';

/**
 * Each host's archive of the pinned release, its length and its SHA-256, by
 * Zig's name for the host, as the release's index states them.
 */
const ZIG_ARCHIVES = new Map([
  [
    'x86_64-windows',
    {
      file: 'zig-x86_64-windows-0.17.0.zip',
      bytes: 100268137,
      sha256: 'b5663f69581dcf391293fbf16c06cb80d81d806545ce618b4d0bab7f0eb8c428',
    },
  ],
  [
    'aarch64-windows',
    {
      file: 'zig-aarch64-windows-0.17.0.zip',
      bytes: 95992853,
      sha256: '0a59d91fa1cb40cf068e9b0954434ce973500c7a2ea749f1e01af62cdab52d26',
    },
  ],
  [
    'x86_64-linux',
    {
      file: 'zig-x86_64-linux-0.17.0.tar.xz',
      bytes: 57332648,
      sha256: '1cbe9df9f27e6b78d14ccbca43b6703a404ef79ef1c463de901d7f088d4e2026',
    },
  ],
  [
    'aarch64-linux',
    {
      file: 'zig-aarch64-linux-0.17.0.tar.xz',
      bytes: 52877280,
      sha256: '9e8d11661d4ae3bd57702a3832781e23ad151dde5798e16a5ccd503f65234ff8',
    },
  ],
  [
    'x86_64-macos',
    {
      file: 'zig-x86_64-macos-0.17.0.tar.xz',
      bytes: 59317572,
      sha256: '4f9a1c5269aa17ebda5e6d3c2b89d6cbf36f7d2b22a0306e9ab98f25f95529c6',
    },
  ],
  [
    'aarch64-macos',
    {
      file: 'zig-aarch64-macos-0.17.0.tar.xz',
      bytes: 53985220,
      sha256: 'b607e9b9234790a008116ae5bdb71c6243b84b9fb42a53a9e70fde41c06c536a',
    },
  ],
]);

/** Where the pinned releases are published. */
const ZIG_DOWNLOADS = `https://ziglang.org/download/${ZIG_VERSION}/`;

/**
 * The pinned release's source archive and its SHA-256, as the index states
 * them: the source of the runtime libraries Zig links into what it builds,
 * which the third-party notices name.
 */
export const ZIG_SOURCE = Object.freeze({
  url: `${ZIG_DOWNLOADS}zig-${ZIG_VERSION}.tar.xz`,
  sha256: 'b6c7f1728f043700d6529bac980800792f824256a9d2f1839b3d62beed0b8abd',
});

/** Where the pinned release is kept once extracted. */
const ZIG_CACHE = join(REPO_ROOT, 'target', 'toolchains', `zig-${ZIG_VERSION}`);

/** Node's names for the host's processor and system, as Zig names them. */
const ARCHITECTURES = new Map([
  ['x64', 'x86_64'],
  ['arm64', 'aarch64'],
]);
const SYSTEMS = new Map([
  ['win32', 'windows'],
  ['linux', 'linux'],
  ['darwin', 'macos'],
]);

/** The pinned release's name for this host, or `undefined` where none is published for it. */
function hostName() {
  const architecture = ARCHITECTURES.get(process.arch);
  const system = SYSTEMS.get(process.platform);
  return architecture === undefined || system === undefined
    ? undefined
    : `${architecture}-${system}`;
}

/** The compiler's file name on this host. */
const EXECUTABLE = process.platform === 'win32' ? 'zig.exe' : 'zig';

/**
 * The version a compiler states, or `undefined` where it cannot be run.
 *
 * @param {string} zig
 * @returns {string | undefined}
 */
function versionOf(zig) {
  const run = spawnSync(zig, ['version'], { encoding: 'utf8' });
  return run.status === 0 ? run.stdout.trim() : undefined;
}

/**
 * The `tar` that reads the archive: on Windows the system's own bsdtar, by its
 * full path, since a `tar` earlier on the path, such as Git's, reads no `.zip`.
 */
function tarCommand() {
  return process.platform === 'win32'
    ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
}

/**
 * Downloads, checks and extracts the pinned release for `host` into the cache.
 *
 * @param {string} host
 * @param {{ readonly file: string, readonly bytes: number,
 *   readonly sha256: string }} archive
 */
async function install(host, archive) {
  const parent = dirname(ZIG_CACHE);
  mkdirSync(parent, { recursive: true });
  // Downloaded and extracted beside the cache and renamed into it, so an
  // interrupted download or extraction never leaves a cache that looks whole.
  const staging = mkdtempSync(join(parent, `zig-${ZIG_VERSION}-`));
  try {
    const archivePath = join(staging, archive.file);
    await downloadTo(`${ZIG_DOWNLOADS}${archive.file}`, archivePath, archive.bytes);
    const { bytes, sha256 } = await digestOf(archivePath);
    if (bytes !== archive.bytes || sha256 !== archive.sha256) {
      throw new Error(
        `The Zig ${ZIG_VERSION} archive for ${host} has SHA-256 ${sha256}, not the pinned ${archive.sha256}; it is not extracted. Download it again, or set ZIG to a Zig ${ZIG_VERSION}.`,
      );
    }
    const extracted = spawnSync(tarCommand(), ['-xf', archivePath, '-C', staging], {
      encoding: 'utf8',
    });
    if (extracted.error !== undefined || extracted.status !== 0) {
      throw new Error(
        `The Zig ${ZIG_VERSION} archive could not be extracted by ${tarCommand()}: ${extracted.error?.message ?? extracted.stderr}`,
      );
    }
    renameSync(join(staging, archive.file.replace(/\.(zip|tar\.xz)$/u, '')), ZIG_CACHE);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * The pinned Zig's path: `ZIG` where it names one, else the cached release,
 * downloaded first where the cache does not hold it. Throws where `ZIG` names
 * another version, the host has no published release, or the archive's hash
 * is not the pinned one.
 *
 * @returns {Promise<string>}
 */
export async function pinnedZig() {
  const given = process.env['ZIG'];
  if (given !== undefined && given !== '') {
    const version = versionOf(given);
    if (version !== ZIG_VERSION) {
      throw new Error(
        `ZIG names ${given}, which is ${version === undefined ? 'not a Zig that runs' : `Zig ${version}`}; the encoder modules are built with Zig ${ZIG_VERSION}.`,
      );
    }
    return given;
  }
  const zig = join(ZIG_CACHE, EXECUTABLE);
  if (existsSync(zig)) return zig;
  const host = hostName();
  const archive = host === undefined ? undefined : ZIG_ARCHIVES.get(host);
  if (host === undefined || archive === undefined) {
    throw new Error(
      `Zig ${ZIG_VERSION} is pinned for ${[...ZIG_ARCHIVES.keys()].join(', ')}, not for ${process.arch} ${process.platform}. Set ZIG to a Zig ${ZIG_VERSION} built for this host.`,
    );
  }
  await install(host, archive);
  return zig;
}
