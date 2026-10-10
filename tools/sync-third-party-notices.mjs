#!/usr/bin/env node
/**
 * Writes `THIRD-PARTY-NOTICES.md`: the licence and attribution of every
 * third-party package the application ships, from the committed lockfiles,
 * and of the source code ported into it from other projects, from the
 * committed list of ported code.
 *
 * A package ships when the published application runs with it: the closure of
 * the production dependencies of `apps/web` in `pnpm-lock.yaml`, through every
 * workspace package it links, and the crates `cargo metadata` resolves, under
 * `Cargo.lock`, as normal dependencies of the crate built into the WebAssembly
 * module for its target. Development dependencies and optional peers are never
 * followed, so the test runners, linters, bundler and compilers are left out,
 * and a package resolved more than once, against different peers, is listed
 * once. A package declared as a production dependency is listed even where the
 * bundler takes nothing of it, such as a package of type definitions, because
 * the lockfile is the authority on what is depended on and a notice for code
 * that was not shipped harms nobody.
 *
 * The licence, copyright and text are read from each installed package: its
 * manifest's SPDX expression, and its licence files. A shipped package whose
 * licence is missing, unreadable or not on the allow-list below is refused, by
 * name, before anything is written, so a dependency cannot land without the
 * notice it needs or with a licence that has not been decided on.
 *
 * Code rewritten here from another project's source ships under that
 * project's licence too, though no lockfile names it, so each port is listed
 * by hand in `tools/ported-code-notices.json`, reviewed as any change is: the
 * project, the commit ported from, its licence and copyright, what was ported
 * and where it lives. A port is held to the same allow-list, and refused
 * where a repository path it names no longer exists, so a notice cannot
 * outlive or lose the code it is for.
 *
 * The C libraries vendored under `third_party/` and built into the encoder
 * modules (`build-encoder-modules.mjs`) are named by no lockfile, so each is
 * listed by hand in `tools/vendored-library-notices.json`: the project, its
 * version, licence and copyright, its folder, the release archive its source
 * was taken from and that archive's SHA-256, which the folder's README must
 * record too, and the modules it is built into. Its licence text is quoted
 * from the files it ships. A library is refused where its folder or licence
 * file is gone or a module it names is not built, and a folder of
 * `third_party/` the list does not name is refused, so no vendored code ships
 * without its notice.
 *
 * Usage:
 *   node tools/sync-third-party-notices.mjs           write the notices
 *   node tools/sync-third-party-notices.mjs --check   exit non-zero if stale
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MP3_MODULE, SHIPPED_CRATES, VORBIS_MODULE, WASM_TARGET } from './build-wasm.mjs';
import { localTracesIn } from './local-traces.mjs';
import { ZIG_SOURCE, ZIG_VERSION } from './zig-toolchain.mjs';
import { lockedPackagesOf } from './read-pnpm-lockfile.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOTICES = join(REPO_ROOT, 'THIRD-PARTY-NOTICES.md');

/** The committed, reviewed list of the C libraries vendored and built into encoder modules. */
export const VENDORED_LIBRARIES = join(REPO_ROOT, 'tools', 'vendored-library-notices.json');

/** Where the C libraries are vendored. */
const THIRD_PARTY = 'third_party';

/** The committed, reviewed list of the source code ported from other projects. */
export const PORTED_CODE = join(REPO_ROOT, 'tools', 'ported-code-notices.json');

/**
 * The standard text of each allowed licence, as `<SPDX identifier>.txt`, from
 * the SPDX licence list's data (CC0-1.0), for a package that ships none.
 */
export const LICENCE_TEXTS = join(REPO_ROOT, 'tools', 'licence-texts');

/** The importer whose production closure is what the application ships. */
const SHIPPED_IMPORTER = 'apps/web';

/**
 * The licences a shipped package may carry, by SPDX identifier.
 *
 * Each is permissive: it lets the package be redistributed, inside a work
 * licensed under Apache-2.0 and in minified form, on the condition that its
 * notice and terms travel with it, which this file is how the application
 * meets. None asks for the work's own source to be offered or its licence to
 * change. A weak copyleft licence (LGPL) and a strong one (GPL, AGPL) do, and
 * a licence that restricts use (CC-BY-NC, SSPL, BUSL) or names no terms at all
 * (UNLICENSED, `SEE LICENSE IN`) is not permission, so each is refused here
 * for a person to decide on, rather than added unread. Each has its standard
 * text in `LICENCE_TEXTS`, to quote for a package that ships no licence file
 * of its own.
 *
 * MPL-2.0 was decided on by ADR-0091, for Symphonia: its copyleft reaches the
 * files it covers and no further, those files are used unmodified, and it asks
 * only that whoever receives them compiled be told where their source is,
 * which the notices say of each package under it ({@link SOURCE_OFFERED}).
 */
export const ALLOWED_LICENCES = Object.freeze([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSL-1.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Unicode-3.0',
  'Unicode-DFS-2016',
  'Unlicense',
  'Zlib',
]);

/**
 * The allowed licences that ask that a recipient of the compiled package be
 * told where its source is: a package taken under one is refused unless its
 * source is known, and the notices name it.
 */
export const SOURCE_OFFERED = Object.freeze(['MPL-2.0']);

/**
 * The licences a vendored library may carry beyond the allow-list. ADR-0091
 * decided on LGPL-2.0-or-later for LAME on the terms the LGPL sets for a
 * library: it is built into its own WebAssembly module, loaded from its own
 * file, so a person can replace it with a build of the same interface;
 * nothing of it is compiled into AudioGubbins' own code; and its
 * corresponding source is vendored in this repository, where the notices
 * say. It is allowed for a vendored library alone, never for a package or a
 * port.
 */
export const VENDORED_LIBRARY_LICENCES = Object.freeze(['LGPL-2.0-or-later']);

/**
 * The exceptions an allowed licence may be taken `WITH`, each of which only
 * grants more: the LLVM exception, common in WebAssembly toolchain crates,
 * waives Apache-2.0's notice terms for code compiled into a binary.
 */
export const ALLOWED_EXCEPTIONS = Object.freeze(['LLVM-exception']);

/**
 * What a package's licence expression permits: the licences it is taken
 * under, or why it is refused.
 *
 * @typedef {{ readonly allowed: true, readonly licences: readonly string[] }
 *   | { readonly allowed: false, readonly reason: string }} LicenceDecision
 */

/**
 * The tokens of an SPDX licence expression.
 *
 * @param {string} expression
 * @returns {string[]}
 */
function tokensOf(expression) {
  return expression.replaceAll('(', ' ( ').replaceAll(')', ' ) ').trim().split(/\s+/u);
}

/**
 * An identifier of a list, as the list writes it: SPDX identifiers match
 * without regard to case.
 *
 * @param {readonly string[]} list
 * @param {string} id
 * @returns {string | undefined}
 */
function listed(list, id) {
  return list.find((one) => one.toLowerCase() === id.toLowerCase());
}

/**
 * Whether an SPDX licence expression is permitted, and the licences it is
 * taken under: every operand of an `AND`, and of an `OR` the first allowed
 * alternative as written.
 *
 * @param {string} expression
 * @returns {LicenceDecision}
 */
export function decideLicence(expression) {
  const tokens = tokensOf(expression);
  let at = 0;
  /** @returns {LicenceDecision} */
  const either = () => {
    const first = all();
    const options = [first];
    while (tokens[at] === 'OR') {
      at += 1;
      options.push(all());
    }
    return options.find((option) => option.allowed) ?? first;
  };
  /** @returns {LicenceDecision} */
  const all = () => {
    const parts = [one()];
    while (tokens[at] === 'AND') {
      at += 1;
      parts.push(one());
    }
    const refused = parts.find((part) => !part.allowed);
    if (refused !== undefined) return refused;
    return {
      allowed: true,
      licences: parts.flatMap((part) => (part.allowed ? part.licences : [])),
    };
  };
  /** @returns {LicenceDecision} */
  const one = () => {
    const token = tokens[at];
    at += 1;
    if (token === '(') {
      const inner = either();
      if (tokens[at] !== ')') throw new SyntaxError(`an unclosed bracket in ${expression}`);
      at += 1;
      return inner;
    }
    if (token === undefined || ['AND', 'OR', 'WITH', ')'].includes(token)) {
      throw new SyntaxError(`${expression} is not an SPDX expression`);
    }
    const licence = listed(ALLOWED_LICENCES, token);
    /** @type {string | undefined} */
    let exception;
    if (tokens[at] === 'WITH') {
      exception = tokens[at + 1];
      at += 2;
      if (exception === undefined) throw new SyntaxError(`${expression} ends in WITH`);
    }
    if (licence === undefined) return { allowed: false, reason: `${token} is not allowed` };
    if (exception === undefined) return { allowed: true, licences: [licence] };
    const granted = listed(ALLOWED_EXCEPTIONS, exception);
    return granted === undefined
      ? { allowed: false, reason: `the exception ${exception} is not allowed` }
      : { allowed: true, licences: [`${licence} WITH ${granted}`] };
  };
  try {
    const decision = either();
    if (at !== tokens.length) throw new SyntaxError(`${expression} is not an SPDX expression`);
    return decision;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { allowed: false, reason: error.message };
  }
}

/**
 * The names a licence file of a package is found by, at its root: a licence,
 * a copying file, and the NOTICE file Apache-2.0 requires be passed on.
 */
const LICENCE_FILE = /^(?:licen[cs]e|copying|notice)(?:[-._][\w.-]*)?$/iu;

/**
 * A line that begins as a copyright statement does: `Copyright` and a name or
 * a year, `Copyright(c)`, a copyright sign, or `(c)` and a year.
 */
const COPYRIGHT_LINE = /^(?:copyright(?:\s|\(c\))|©|\(c\)\s*\d)/iu;

/**
 * A line that begins with the word but is the prose of a licence wrapped onto
 * a line of its own, such as `copyright notice` or `COPYRIGHT HOLDERS`, or its
 * template for a statement, which begins `Copyright [yyyy]`.
 */
const COPYRIGHT_PROSE =
  /^copyright\s+(?:(?:notices?|licen[cs]es?|holders?|owners?|statements?|law|and|or)\b|\[yyyy\])/iu;

/**
 * A third-party package and what its installed copy says of its licence.
 *
 * @typedef {object} PackageSource
 * @property {string} name
 * @property {string} version
 * @property {unknown} licence the manifest's `license` field, as written
 * @property {readonly { readonly name: string, readonly text: string }[]} files
 *   its licence files, by name
 * @property {string} [source] where its source is published
 */

/**
 * What the notices say of one package.
 *
 * @typedef {object} Notice
 * @property {string} name
 * @property {string} version
 * @property {string} licence the expression the package declares
 * @property {readonly string[]} copyright each line stating a copyright
 * @property {readonly string[]} texts its licence files' texts, as it ships
 *   them, or the standard texts of the licences it is taken under
 * @property {boolean} standard whether the texts are the licences' standard
 *   ones, because the package ships none
 * @property {string} [source] where its source is published, for a package
 *   whose licence asks that a recipient be told
 */

/**
 * A licence file's text, with line endings, trailing spaces and the blank
 * lines around it made the same for every package.
 *
 * @param {string} text
 * @returns {string}
 */
function normalised(text) {
  return text
    .replace(/^\uFEFF/u, '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/gu, '');
}

/**
 * A package's notice, or why it is refused.
 *
 * A package that ships no licence file of its own, as some publish only their
 * code, is given the standard text of each licence it is taken under, with no
 * copyright, since it states none, and is marked as given it.
 *
 * @param {PackageSource} source
 * @param {(licence: string) => string} standardText the SPDX text of an
 *   allowed licence
 * @returns {{ readonly notice: Notice } | { readonly refused: string }}
 */
export function noticeOf(source, standardText) {
  const named = `${source.name} ${source.version}`;
  if (typeof source.licence !== 'string' || source.licence.trim() === '') {
    return { refused: `${named} declares no SPDX licence expression` };
  }
  const decision = decideLicence(source.licence);
  if (!decision.allowed) {
    return { refused: `${named} is licensed ${source.licence}: ${decision.reason}` };
  }
  const offered = decision.licences.some((licence) => listed(SOURCE_OFFERED, licence));
  if (offered && source.source === undefined) {
    return {
      refused: `${named} is licensed ${source.licence}, which asks that its source be offered, and states none`,
    };
  }
  const shipped = source.files
    .filter((file) => LICENCE_FILE.test(file.name))
    .toSorted((one, other) => compare(one.name, other.name))
    .map((file) => normalised(file.text));
  const lines = shipped.flatMap((text) => text.split('\n')).map((line) => line.trim());
  return {
    notice: {
      name: source.name,
      version: source.version,
      licence: source.licence,
      copyright: [...new Set(lines.filter(isCopyright))],
      texts: shipped.length > 0 ? shipped : standardTexts(decision.licences, standardText),
      standard: shipped.length === 0,
      ...(offered ? { source: source.source } : {}),
    },
  };
}

/**
 * The standard text of each of `licences`, an exception's name aside. The
 * copyright line of a standard text is a template, which states nothing, so
 * it is left out.
 *
 * @param {readonly string[]} licences
 * @param {(licence: string) => string} standardText the SPDX text of an
 *   allowed licence
 * @returns {string[]}
 */
function standardTexts(licences, standardText) {
  return licences.map((licence) =>
    normalised(standardText(licence.replace(/ WITH .*$/u, '')))
      .split('\n')
      .filter((line) => !isCopyright(line.trim()))
      .join('\n')
      .replaceAll(/\n{3,}/gu, '\n\n'),
  );
}

/**
 * What the notices say of code ported from one project.
 *
 * @typedef {object} PortedNotice
 * @property {string} project
 * @property {string} url the project's repository
 * @property {string} commit the commit the code was ported from
 * @property {string} licence the project's SPDX licence expression
 * @property {readonly string[]} copyright each line of the project's
 *   copyright, as its source states it
 * @property {string} ported what was ported, from which of its files
 * @property {readonly string[]} into the repository paths it was ported into
 * @property {readonly string[]} texts the standard texts of the licences it
 *   is taken under
 */

/** A full commit hash, so a port names one tree and never a moving branch. */
const COMMIT = /^[0-9a-f]{40}$/u;

/**
 * A repository path as the list writes one: relative, with forward slashes,
 * and never climbing out of the repository.
 */
const REPOSITORY_PATH = /^(?!\/)(?![a-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/iu;

/**
 * Whether `value` is a string with text in it.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The notices of the ported code `list` names, read from
 * `tools/ported-code-notices.json`, or every reason one of its entries is
 * refused: a field missing or malformed, a licence off the allow-list, a
 * project listed twice, or a repository path that does not exist.
 *
 * @param {unknown} list the list's parsed JSON
 * @param {(path: string) => boolean} exists whether a repository path exists
 * @param {(licence: string) => string} standardText the SPDX text of an
 *   allowed licence
 * @returns {{ readonly notices: readonly PortedNotice[] }
 *   | { readonly refused: readonly string[] }}
 */
export function portedNoticesOf(list, exists, standardText) {
  const entries =
    typeof list === 'object' && list !== null && 'ported' in list ? list.ported : undefined;
  if (!Array.isArray(entries)) return { refused: ['the list holds no `ported` array'] };
  /** @type {string[]} */
  const refused = [];
  /** @type {PortedNotice[]} */
  const notices = [];
  const projects = new Set();
  for (const [index, entry] of entries.entries()) {
    /** @type {Record<string, unknown>} */
    const fields = typeof entry === 'object' && entry !== null ? entry : {};
    const { project, url, commit, licence, copyright, ported, into } = fields;
    const named = isText(project) ? project : `entry ${String(index + 1)}`;
    const reasons = [];
    if (!isText(project)) reasons.push('names no project');
    else if (projects.has(project)) reasons.push('is listed twice');
    projects.add(project);
    if (!isText(url) || !url.startsWith('https://')) reasons.push('names no https repository');
    if (typeof commit !== 'string' || !COMMIT.test(commit)) {
      reasons.push('names no full commit hash');
    }
    const decision = isText(licence) ? decideLicence(licence) : undefined;
    if (decision === undefined) reasons.push('declares no SPDX licence expression');
    else if (!decision.allowed) reasons.push(`is licensed ${String(licence)}: ${decision.reason}`);
    const lines = Array.isArray(copyright) ? copyright : undefined;
    if (lines === undefined || !lines.every((line) => isText(line) && isCopyright(line))) {
      reasons.push('lists its copyright as anything but lines stating one');
    }
    if (!isText(ported)) reasons.push('says nothing of what was ported');
    const paths = Array.isArray(into) ? into : [];
    if (paths.length === 0) reasons.push('names no path it was ported into');
    for (const path of paths) {
      if (typeof path !== 'string' || !REPOSITORY_PATH.test(path)) {
        reasons.push(`names ${String(path)}, which is not a path in the repository`);
      } else if (!exists(path)) {
        reasons.push(`names ${path}, which does not exist`);
      }
    }
    if (reasons.length > 0) {
      refused.push(...reasons.map((reason) => `ported code from ${named} ${reason}`));
      continue;
    }
    notices.push({
      project: String(project),
      url: String(url),
      commit: String(commit),
      licence: String(licence),
      copyright: (lines ?? []).map(String),
      ported: String(ported),
      into: paths.map(String),
      texts: decision?.allowed === true ? standardTexts(decision.licences, standardText) : [],
    });
  }
  return refused.length > 0 ? { refused } : { notices };
}

/**
 * What the notices say of one library built into an encoder module: a C
 * library vendored under `third_party/`, or a runtime library the C compiler
 * links into every module it builds.
 *
 * @typedef {object} VendoredNotice
 * @property {string} project
 * @property {string} version
 * @property {string} licence
 * @property {readonly string[]} copyright
 * @property {{ readonly directory: string } | { readonly bundledBy: string }} source
 *   the repository folder its source is vendored in, or the toolchain whose
 *   release holds it
 * @property {readonly string[]} modules the module files it is built into
 * @property {string} origin the release archive its source was taken from
 * @property {string} sha256 that archive's SHA-256
 * @property {readonly string[]} texts its licence's text: as a vendored
 *   library ships it, or the standard text for a toolchain's
 */

/** A SHA-256, written in lower-case hexadecimal. */
const SHA256 = /^[0-9a-f]{64}$/u;

/**
 * What the vendored notices are checked against: whether a repository path
 * exists, a file's text, the folders `third_party/` holds, the module files
 * the build writes, the pinned compiler's name and its source archive, and
 * the standard text of a licence.
 *
 * @typedef {object} VendoredTree
 * @property {(path: string) => boolean} exists
 * @property {(path: string) => string} read
 * @property {readonly string[]} directories
 * @property {readonly string[]} modules
 * @property {{ readonly name: string, readonly url: string, readonly sha256: string }} toolchain
 * @property {(licence: string) => string} standardText
 */

/**
 * Why a vendored library's source is refused, or its folder and licence text.
 *
 * @param {Record<string, unknown>} fields
 * @param {VendoredTree} tree
 * @returns {{ readonly directory: string, readonly texts: readonly string[], readonly reasons: readonly string[] }}
 */
function vendoredSourceOf(fields, tree) {
  const { directory, licenceFiles, version, origin, sha256 } = fields;
  const folder =
    typeof directory === 'string' &&
    REPOSITORY_PATH.test(directory) &&
    directory.startsWith(`${THIRD_PARTY}/`) &&
    tree.exists(directory)
      ? directory
      : undefined;
  if (folder === undefined) {
    return { directory: '', texts: [], reasons: ['names no folder of third_party/ that exists'] };
  }
  const reasons = [];
  const files = Array.isArray(licenceFiles) ? licenceFiles : [];
  if (files.length === 0) reasons.push('names no licence file');
  /** @type {string[]} */
  const texts = [];
  for (const file of files) {
    const path = `${folder}/${String(file)}`;
    if (typeof file === 'string' && REPOSITORY_PATH.test(path) && tree.exists(path)) {
      texts.push(normalised(tree.read(path)));
    } else {
      reasons.push(`names ${path}, which does not exist`);
    }
  }
  const readme = `${folder}/README.md`;
  const record = tree.exists(readme) ? tree.read(readme) : '';
  if (![version, origin, sha256].every((stated) => isText(stated) && record.includes(stated))) {
    reasons.push(`is not recorded in ${readme} with its version, release archive and SHA-256`);
  }
  return { directory: folder, texts, reasons };
}

/**
 * Why one library is refused, or its notice.
 *
 * @param {unknown} entry the library as the list writes it
 * @param {number} index
 * @param {VendoredTree} tree
 * @returns {{ readonly notice: VendoredNotice }
 *   | { readonly refused: readonly string[] }}
 */
function vendoredLibraryOf(entry, index, tree) {
  /** @type {Record<string, unknown>} */
  const fields =
    typeof entry === 'object' && entry !== null ? Object.fromEntries(Object.entries(entry)) : {};
  const { project, version, licence, copyright, bundledBy, origin, sha256, modules } = fields;
  const named = `the library ${isText(project) ? project : String(index + 1)}`;
  const reasons = [];
  if (!isText(project) || !isText(version)) reasons.push('names no project and version');
  const decided = isText(licence) ? listed(VENDORED_LIBRARY_LICENCES, licence) : undefined;
  const decision = isText(licence) ? decideLicence(licence) : undefined;
  if (decision === undefined) reasons.push('declares no SPDX licence expression');
  else if (!decision.allowed && decided === undefined) {
    reasons.push(`is licensed ${String(licence)}: ${decision.reason}`);
  }
  const lines = Array.isArray(copyright) ? copyright : [];
  if (lines.length === 0 || !lines.every((line) => isText(line) && isCopyright(line))) {
    reasons.push('lists its copyright as anything but lines stating one');
  }
  if (!isText(origin) || !origin.startsWith('https://')) {
    reasons.push('names no https address of the release archive its source was taken from');
  }
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
    reasons.push('states no SHA-256 of its release archive');
  }
  const into = Array.isArray(modules) ? modules : [];
  if (into.length === 0) reasons.push('names no module it is built into');
  for (const module of into) {
    if (typeof module !== 'string' || !tree.modules.includes(module)) {
      reasons.push(`names ${String(module)}, which the build does not write`);
    }
  }
  /** @type {VendoredNotice['source']} */
  let source;
  /** @type {readonly string[]} */
  let texts;
  if (bundledBy === undefined) {
    const vendored = vendoredSourceOf(fields, tree);
    reasons.push(...vendored.reasons);
    source = { directory: vendored.directory };
    texts = vendored.texts;
  } else {
    const { name, url } = tree.toolchain;
    if (bundledBy !== name || origin !== url || sha256 !== tree.toolchain.sha256) {
      reasons.push(`is bundled by no compiler but ${name}, from ${url} with its SHA-256`);
    }
    source = { bundledBy: name };
    texts = standardTexts(decision?.allowed === true ? decision.licences : [], tree.standardText);
  }
  if (reasons.length > 0) return { refused: reasons.map((reason) => `${named} ${reason}`) };
  return {
    notice: {
      project: String(project),
      version: String(version),
      licence: String(licence),
      copyright: lines.map(String),
      source,
      modules: into.map(String),
      origin: String(origin),
      sha256: String(sha256),
      texts,
    },
  };
}

/**
 * The notices of the libraries built into the encoder modules that `list`
 * names, read from `tools/vendored-library-notices.json`, or every reason one
 * is refused: a field missing or malformed, a licence neither allowed nor
 * decided on for a vendored library, a module the build does not write; for
 * a vendored library a folder or licence file that does not exist, or a
 * folder whose README does not record the release archive and its hash; for a
 * toolchain's, a toolchain or archive other than the pinned compiler's; and a
 * folder of `third_party/` the list does not name.
 *
 * @param {unknown} list the list's parsed JSON
 * @param {VendoredTree} tree
 * @returns {{ readonly notices: readonly VendoredNotice[] }
 *   | { readonly refused: readonly string[] }}
 */
export function vendoredNoticesOf(list, tree) {
  const entries =
    typeof list === 'object' && list !== null && 'libraries' in list ? list.libraries : undefined;
  if (!Array.isArray(entries)) return { refused: ['the list holds no `libraries` array'] };
  /** @type {string[]} */
  const refused = [];
  /** @type {VendoredNotice[]} */
  const notices = [];
  for (const [index, entry] of entries.entries()) {
    const decided = vendoredLibraryOf(entry, index, tree);
    if ('refused' in decided) refused.push(...decided.refused);
    else notices.push(decided.notice);
  }
  // A folder a refused entry names is named, so it is not refused a second time.
  const named = new Set(
    entries.flatMap((entry) =>
      typeof entry === 'object' && entry !== null && 'directory' in entry ? [entry.directory] : [],
    ),
  );
  for (const directory of tree.directories) {
    if (!named.has(directory)) {
      refused.push(`${directory} is vendored but the list does not name it`);
    }
  }
  return refused.length > 0 ? { refused } : { notices };
}

/**
 * Whether a line of a licence file states a copyright.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isCopyright(line) {
  return COPYRIGHT_LINE.test(line) && !COPYRIGHT_PROSE.test(line);
}

/**
 * Two strings compared by code unit, which every machine sorts alike, unlike
 * a comparison by the locale the process runs in.
 *
 * @param {string} one
 * @param {string} other
 * @returns {number}
 */
function compare(one, other) {
  return one < other ? -1 : one > other ? 1 : 0;
}

/**
 * A table cell's text, with what would end the cell or the row escaped.
 *
 * @param {string} text
 * @returns {string}
 */
function cell(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('<', '&lt;');
}

/**
 * A code fence longer than any run of backticks in the text it fences.
 *
 * @param {string} text
 * @returns {string}
 */
function fenceFor(text) {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/gu), (run) => run[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The notices file, from every shipped package's notice, every vendored
 * library's and every port's. Each distinct licence text is written once,
 * after the tables, with what ships it; texts that differ only in spacing are
 * one.
 *
 * @param {readonly Notice[]} notices
 * @param {readonly PortedNotice[]} ported
 * @param {readonly VendoredNotice[]} vendored
 * @returns {string}
 */
export function renderNotices(notices, ported = [], vendored = []) {
  const sorted = notices.toSorted(
    (one, other) => compare(one.name, other.name) || compare(one.version, other.version),
  );
  /** @type {Map<string, { readonly number: number, readonly text: string, readonly users: Set<string> }>} */
  const texts = new Map();
  /**
   * The links to `user`'s texts, each numbered by where it first appears.
   *
   * @param {readonly string[]} given
   * @param {string} user
   * @returns {string[]}
   */
  const linksOf = (given, user) =>
    given.map((text) => {
      const key = text.replaceAll(/\s+/gu, ' ');
      const known = texts.get(key) ?? { number: texts.size + 1, text, users: new Set() };
      texts.set(key, known);
      known.users.add(user);
      return `[${String(known.number)}](#text-${String(known.number)})`;
    });
  const rows = sorted.map((notice) => {
    const links = linksOf(notice.texts, `${notice.name} ${notice.version}`);
    return [
      cell(notice.name),
      cell(notice.version),
      cell(notice.licence),
      notice.copyright.length === 0 ? '—' : notice.copyright.map(cell).join('<br>'),
      `${links.join(', ')}${notice.standard ? ' (standard text: the package ships none)' : ''}`,
    ].join(' | ');
  });
  const ports = ported
    .toSorted((one, other) => compare(one.project, other.project))
    .map((port) =>
      [
        `[${cell(port.project)}](${port.url})`,
        `\`${port.commit}\``,
        cell(port.licence),
        port.copyright.length === 0 ? '—' : port.copyright.map(cell).join('<br>'),
        cell(port.ported),
        port.into.map((path) => `\`${cell(path)}\``).join('<br>'),
        linksOf(port.texts, `the code ported from ${port.project}`).join(', '),
      ].join(' | '),
    );
  const libraries = vendored
    .toSorted((one, other) => compare(one.project, other.project))
    .map((library) =>
      [
        cell(library.project),
        cell(library.version),
        cell(library.licence),
        library.copyright.map(cell).join('<br>'),
        library.modules.map((module) => `\`${cell(module)}\``).join('<br>'),
        'directory' in library.source
          ? `\`${cell(library.source.directory)}\``
          : `bundled by ${cell(library.source.bundledBy)}`,
        `<${library.origin}><br>SHA-256 \`${library.sha256}\``,
        linksOf(library.texts, `${library.project} ${library.version}`).join(', '),
      ].join(' | '),
    );
  const offered = sorted.flatMap((notice) =>
    notice.source === undefined
      ? []
      : [`- ${cell(notice.name)} ${cell(notice.version)}: <${notice.source}>`],
  );
  const sections = [...texts.values()].map(({ number, text, users }) => {
    const fence = fenceFor(text);
    return [
      `### Text ${String(number)}`,
      '',
      `Shipped by ${[...users].join(', ')}.`,
      '',
      `${fence}text`,
      text,
      fence,
    ].join('\n');
  });

  return [
    '# Third-party notices',
    '',
    '<!-- Generated by tools/sync-third-party-notices.mjs from pnpm-lock.yaml,',
    'Cargo.lock, tools/ported-code-notices.json and tools/vendored-library-notices.json.',
    'Do not edit: run `pnpm notices:update` and commit the result. -->',
    '',
    'AudioGubbins ships the third-party packages below inside the application. Each',
    'is listed with its version, the SPDX licence expression it declares, the',
    'copyright it states and the full text of its licence files, or, where it ships',
    'none, the standard text of its licence. A package is listed when the published',
    'application runs with it: the production dependencies of `apps/web`, through',
    'every workspace package it uses, and the Rust crates linked into its WebAssembly',
    'modules. Tools used only to develop, test and build AudioGubbins, such as Vitest,',
    'ESLint, Playwright, TypeScript and Vite, are not shipped and are not listed.',
    '',
    '## Packages',
    '',
    '| Package | Version | Licence | Copyright | Licence text |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
    ...(offered.length === 0
      ? []
      : [
          '## Source of the packages under the Mozilla Public License',
          '',
          'The packages below are licensed under the Mozilla Public License 2.0, which asks',
          'that whoever receives them compiled be told where their source is. Each is',
          'shipped unmodified, and its source is published at:',
          '',
          ...offered,
          '',
        ]),
    ...(libraries.length === 0
      ? []
      : [
          '## Libraries built from vendored source',
          '',
          'The encoder modules are built from the C libraries below, whose source is',
          'vendored, unmodified, in the folder of this repository each names: that folder',
          'is where the corresponding source of each is. Each module is a separate',
          'WebAssembly file, loaded only when its format is exported, which can be replaced',
          'by a build of the same interface (`native/`); nothing of the libraries is',
          "compiled into AudioGubbins' own code. The compiler links its own runtime",
          'libraries into each module, from the source of its pinned release. Each library',
          'is listed with its version, licence and copyright, the modules built from it,',
          "where its source is, the release archive it was taken from and that archive's",
          'SHA-256, and the text of its licence: as a vendored library ships it, or the',
          "standard text for the compiler's.",
          '',
          '| Library | Version | Licence | Copyright | Modules | Source | Release archive | Licence text |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          ...libraries.map((row) => `| ${row} |`),
          '',
        ]),
    '## Ported source code',
    '',
    'AudioGubbins also ships source code rewritten in TypeScript from the projects',
    'below, each under its own licence. Each is listed with the commit it was ported',
    'from, its licence, the copyright its source states, what was ported and where',
    'in this repository it lives, and the standard text of its licence.',
    '',
    '| Project | Commit | Licence | Copyright | Ported | Into | Licence text |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...ports.map((row) => `| ${row} |`),
    '',
    '## Licence texts',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
}

/**
 * A crate, as `cargo metadata` describes it, so far as the notices read it.
 * One with no source is a crate of the workspace.
 *
 * @typedef {object} CargoCrate
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {string | null} source
 * @property {string | null} license
 * @property {string} manifest_path
 */

/**
 * A crate one depends on, and each kind of dependency it is, which is `null`
 * for a normal one.
 *
 * @typedef {object} CargoDependency
 * @property {string} pkg
 * @property {readonly { readonly kind: string | null }[]} dep_kinds
 */

/**
 * A crate's place in the graph `cargo metadata` resolves.
 *
 * @typedef {object} CargoNode
 * @property {string} id
 * @property {readonly CargoDependency[]} deps
 */

/**
 * What `cargo metadata` prints, so far as the notices read it.
 *
 * @typedef {object} CargoMetadata
 * @property {readonly CargoCrate[]} packages
 * @property {{ readonly nodes: readonly CargoNode[] }} resolve
 */

/**
 * Every third-party crate a crate links, transitively: those it takes as
 * normal dependencies, not as development or build dependencies, which run
 * on the machine that builds it and are not in the module. A crate with no
 * source is one of the workspace's own.
 *
 * @param {CargoMetadata} metadata
 * @param {string} root the crate's name
 * @returns {readonly CargoCrate[]}
 */
export function linkedCratesOf(metadata, root) {
  const byId = new Map(metadata.packages.map((crate) => [crate.id, crate]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const start = metadata.packages.find((crate) => crate.name === root && crate.source === null);
  if (start === undefined) throw new Error(`cargo metadata has no workspace crate ${root}`);
  const reached = new Set([start.id]);
  const queue = [start.id];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (reached.has(dep.pkg) || !dep.dep_kinds.some(({ kind }) => kind === null)) continue;
      reached.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }
  return [...reached]
    .map((id) => byId.get(id))
    .filter((crate) => crate !== undefined && crate.source !== null)
    .map((crate) => /** @type {CargoCrate} */ (crate));
}

/**
 * A package's licence files, read from its folder.
 *
 * @param {string} folder
 * @returns {PackageSource['files']}
 */
function licenceFilesIn(folder) {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
    .map((entry) => ({ name: entry.name, text: readFileSync(join(folder, entry.name), 'utf8') }));
}

/**
 * The installed copy of every package the lockfile says ships, each checked
 * to be the version the lockfile names. pnpm installs a package's
 * dependencies beside it in its store folder, so each is found where its
 * dependent finds it.
 *
 * @returns {PackageSource[]}
 */
function shippedNodeSources() {
  const lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
  const locked = lockedPackagesOf(lockfile, SHIPPED_IMPORTER);
  // The folder each package's own dependencies are installed in, by its key.
  /** @type {Map<string, string>} */
  const besideOf = new Map();
  /** @type {Map<string, PackageSource>} */
  const sources = new Map();
  for (const one of locked) {
    const base =
      'importer' in one.parent
        ? join(REPO_ROOT, one.parent.importer, 'node_modules')
        : besideOf.get(one.parent.key);
    if (base === undefined) throw new Error(`${one.key} was reached before what depends on it`);
    const folder = realpathSync.native(join(base, one.folder));
    besideOf.set(one.key, folder.slice(0, folder.length - one.name.length - 1));
    if (sources.has(`${one.name}@${one.version}`)) continue;
    const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    if (manifest.name !== one.name || manifest.version !== one.version) {
      throw new Error(
        `${one.name} ${one.version} is installed as ${String(manifest.name)} ${String(manifest.version)}. Run \`pnpm install\` first.`,
      );
    }
    sources.set(`${one.name}@${one.version}`, {
      name: one.name,
      version: one.version,
      licence: manifest.license,
      files: licenceFilesIn(folder),
      source: `https://www.npmjs.com/package/${one.name}/v/${one.version}`,
    });
  }
  return [...sources.values()];
}

/**
 * The third-party crates the WebAssembly modules link, each listed once. They
 * are read from `cargo metadata` held to `Cargo.lock` and run offline, so it
 * neither changes the lockfile nor reaches the network.
 *
 * @returns {PackageSource[]}
 */
function shippedCrateSources() {
  const run = spawnSync(
    'cargo',
    [
      'metadata',
      '--format-version',
      '1',
      '--locked',
      '--offline',
      '--filter-platform',
      WASM_TARGET,
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (run.error !== undefined) throw new Error(`cargo could not be started: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`cargo metadata failed:\n${run.stderr}`);
  const metadata = /** @type {CargoMetadata} */ (JSON.parse(run.stdout));
  const linked = new Map(
    SHIPPED_CRATES.flatMap((root) => linkedCratesOf(metadata, root)).map((crate) => [
      crate.id,
      crate,
    ]),
  );
  return [...linked.values()].map((crate) => ({
    name: crate.name,
    version: crate.version,
    // Cargo's manifests once wrote `MIT/Apache-2.0` for a choice of either.
    licence: crate.license?.replaceAll('/', ' OR ') ?? undefined,
    files: licenceFilesIn(dirname(crate.manifest_path)),
    source: `https://crates.io/crates/${crate.name}/${crate.version}`,
  }));
}

/**
 * Writes or checks the notices, and the status the process exits with.
 *
 * @param {readonly string[]} argv
 * @returns {number}
 */
function main(argv) {
  const checkOnly = argv.includes('--check');
  const decided = [...shippedNodeSources(), ...shippedCrateSources()].map((source) =>
    noticeOf(source, (licence) => readFileSync(join(LICENCE_TEXTS, `${licence}.txt`), 'utf8')),
  );
  const refused = decided.flatMap((one) => ('refused' in one ? [one.refused] : []));
  if (refused.length > 0) {
    console.error(
      `${String(refused.length)} shipped package(s) cannot be given a notice:\n` +
        refused.map((reason) => `  - ${reason}`).join('\n') +
        '\n\nA shipped package needs an SPDX licence expression the allow-list in\n' +
        'tools/sync-third-party-notices.mjs permits. Replace the package, or decide on\n' +
        'its licence and add it there with its standard text.',
    );
    return 1;
  }
  const notices = decided.flatMap((one) => ('notice' in one ? [one.notice] : []));
  const ported = portedNoticesOf(
    JSON.parse(readFileSync(PORTED_CODE, 'utf8')),
    (path) => existsSync(join(REPO_ROOT, path)),
    (licence) => readFileSync(join(LICENCE_TEXTS, `${licence}.txt`), 'utf8'),
  );
  if ('refused' in ported) {
    console.error(
      `tools/ported-code-notices.json cannot give ${String(ported.refused.length)} notice(s):\n` +
        ported.refused.map((reason) => `  - ${reason}`).join('\n') +
        '\n\nEach port names its project, an https repository, the full commit it was\n' +
        'ported from, a licence the allow-list permits, the copyright lines its source\n' +
        'states, what was ported, and the repository paths it lives in.',
    );
    return 1;
  }
  const vendored = vendoredNoticesOf(JSON.parse(readFileSync(VENDORED_LIBRARIES, 'utf8')), {
    exists: (path) => existsSync(join(REPO_ROOT, path)),
    read: (path) => readFileSync(join(REPO_ROOT, path), 'utf8'),
    directories: readdirSync(join(REPO_ROOT, THIRD_PARTY), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${THIRD_PARTY}/${entry.name}`),
    modules: [MP3_MODULE, VORBIS_MODULE].map((module) => basename(module)),
    toolchain: { name: `Zig ${ZIG_VERSION}`, ...ZIG_SOURCE },
    standardText: (licence) => readFileSync(join(LICENCE_TEXTS, `${licence}.txt`), 'utf8'),
  });
  if ('refused' in vendored) {
    console.error(
      `tools/vendored-library-notices.json cannot give ${String(vendored.refused.length)} notice(s):\n` +
        vendored.refused.map((reason) => `  - ${reason}`).join('\n') +
        '\n\nEach library names its project and version, a licence the allow-list permits\n' +
        'or one decided on for a vendored library, the copyright lines its source states,\n' +
        'its folder of third_party/ and the licence files in it, the https address of the\n' +
        "release archive it was taken from and that archive's SHA-256, both recorded in\n" +
        "the folder's README.md, and the module files it is built into.",
    );
    return 1;
  }
  const desired = renderNotices(notices, ported.notices, vendored.notices);
  const traces = localTracesIn(desired);
  if (traces.length > 0) {
    console.error(`The notices would name this machine: ${[...new Set(traces)].join(', ')}`);
    return 1;
  }

  /** @type {string | null} */
  let current = null;
  try {
    current = readFileSync(NOTICES, 'utf8');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (current === desired) {
    console.log(
      `THIRD-PARTY-NOTICES.md is current: ${String(notices.length)} shipped packages, ${String(ported.notices.length)} ports.`,
    );
    return 0;
  }
  if (checkOnly) {
    console.error(
      'THIRD-PARTY-NOTICES.md is stale: the shipped packages, the ported code, or\n' +
        'what they say of their licences, have changed. Run `pnpm notices:update` and\n' +
        'commit the result.',
    );
    return 1;
  }
  writeFileSync(NOTICES, desired, 'utf8');
  console.log(
    `Wrote THIRD-PARTY-NOTICES.md: ${String(notices.length)} shipped packages, ${String(ported.notices.length)} ports.`,
  );
  return 0;
}

// Compared as real paths, as `check-record-titles.mjs` explains: a tool run
// through a junction would otherwise read nothing and exit zero.
if (
  process.argv[1] !== undefined &&
  realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url))
) {
  process.exitCode = main(process.argv.slice(2));
}
