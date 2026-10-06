#!/usr/bin/env node
/**
 * Writes `THIRD-PARTY-NOTICES.md`: the licence and attribution of every
 * third-party package the application ships, from the committed lockfiles.
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
 * Usage:
 *   node tools/sync-third-party-notices.mjs           write the notices
 *   node tools/sync-third-party-notices.mjs --check   exit non-zero if stale
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WASM_CRATE, WASM_TARGET } from './build-wasm.mjs';
import { localTracesIn } from './check-build-output.mjs';
import { lockedPackagesOf } from './read-pnpm-lockfile.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOTICES = join(REPO_ROOT, 'THIRD-PARTY-NOTICES.md');

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
 * change. A weak copyleft licence (MPL-2.0, LGPL) and a strong one (GPL, AGPL)
 * do, and a licence that restricts use (CC-BY-NC, SSPL, BUSL) or names no
 * terms at all (UNLICENSED, `SEE LICENSE IN`) is not permission, so each is
 * refused here for a person to decide on, rather than added unread. Each has
 * its standard text in `LICENCE_TEXTS`, to quote for a package that ships no
 * licence file of its own.
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
  'Unicode-3.0',
  'Unicode-DFS-2016',
  'Unlicense',
  'Zlib',
]);

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
 * a year, a copyright sign, or `(c)` and a year.
 */
const COPYRIGHT_LINE = /^(?:copyright\s|©|\(c\)\s*\d)/iu;

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
      // The copyright line of a standard text is a template, which states
      // nothing, so it is left out.
      texts:
        shipped.length > 0
          ? shipped
          : decision.licences.map((licence) =>
              normalised(standardText(licence.replace(/ WITH .*$/u, '')))
                .split('\n')
                .filter((line) => !isCopyright(line.trim()))
                .join('\n')
                .replaceAll(/\n{3,}/gu, '\n\n'),
            ),
      standard: shipped.length === 0,
    },
  };
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
 * The notices file, from every shipped package's notice. Each distinct
 * licence text is written once, after the table, with the packages that ship
 * it; texts that differ only in spacing are one.
 *
 * @param {readonly Notice[]} notices
 * @returns {string}
 */
export function renderNotices(notices) {
  const sorted = notices.toSorted(
    (one, other) => compare(one.name, other.name) || compare(one.version, other.version),
  );
  /** @type {Map<string, { readonly number: number, readonly text: string, readonly users: Set<string> }>} */
  const texts = new Map();
  const rows = sorted.map((notice) => {
    const named = `${notice.name} ${notice.version}`;
    const links = notice.texts.map((text) => {
      const key = text.replaceAll(/\s+/gu, ' ');
      const known = texts.get(key) ?? { number: texts.size + 1, text, users: new Set() };
      texts.set(key, known);
      known.users.add(named);
      return `[${String(known.number)}](#text-${String(known.number)})`;
    });
    return [
      cell(notice.name),
      cell(notice.version),
      cell(notice.licence),
      notice.copyright.length === 0 ? '—' : notice.copyright.map(cell).join('<br>'),
      `${links.join(', ')}${notice.standard ? ' (standard text: the package ships none)' : ''}`,
    ].join(' | ');
  });
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
    '<!-- Generated by tools/sync-third-party-notices.mjs from pnpm-lock.yaml and',
    'Cargo.lock. Do not edit: run `pnpm notices:update` and commit the result. -->',
    '',
    'AudioGubbins ships the third-party packages below inside the application. Each',
    'is listed with its version, the SPDX licence expression it declares, the',
    'copyright it states and the full text of its licence files, or, where it ships',
    'none, the standard text of its licence. A package is listed when the published',
    'application runs with it: the production dependencies of `apps/web`, through',
    'every workspace package it uses, and the Rust crates linked into its WebAssembly',
    'module. Tools used only to develop, test and build AudioGubbins, such as Vitest,',
    'ESLint, Playwright, TypeScript and Vite, are not shipped and are not listed.',
    '',
    '## Packages',
    '',
    '| Package | Version | Licence | Copyright | Licence text |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
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
    });
  }
  return [...sources.values()];
}

/**
 * The third-party crates the WebAssembly module links, from `cargo metadata`
 * held to `Cargo.lock` and run offline, so it neither changes the lockfile
 * nor reaches the network.
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
  return linkedCratesOf(metadata, WASM_CRATE).map((crate) => ({
    name: crate.name,
    version: crate.version,
    // Cargo's manifests once wrote `MIT/Apache-2.0` for a choice of either.
    licence: crate.license?.replaceAll('/', ' OR ') ?? undefined,
    files: licenceFilesIn(dirname(crate.manifest_path)),
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
  const desired = renderNotices(notices);
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
    console.log(`THIRD-PARTY-NOTICES.md is current: ${String(notices.length)} shipped packages.`);
    return 0;
  }
  if (checkOnly) {
    console.error(
      'THIRD-PARTY-NOTICES.md is stale: the shipped packages, or what they say of\n' +
        'their licences, have changed. Run `pnpm notices:update` and commit the result.',
    );
    return 1;
  }
  writeFileSync(NOTICES, desired, 'utf8');
  console.log(`Wrote THIRD-PARTY-NOTICES.md: ${String(notices.length)} shipped packages.`);
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
