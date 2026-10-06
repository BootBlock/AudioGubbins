/**
 * The definitions of the model packs, `packs/<id>.json`, read and refused as
 * a whole, and the manifest and catalogue each is published as (ADR-0062).
 *
 * A definition is what the repository keeps of a pack in place of its files,
 * which never enter it (REQ-REPO-191): the manifest's values, the sources the
 * files are made from, each by a pinned URL, its length and its SHA-256, how
 * each file is made from them, and each file's length and SHA-256. Every
 * problem with a definition is reported at once, each with where it is.
 *
 * The manifest written from a definition is the document
 * `packages/model-packs` reads, member for member, and a file's path is held
 * to the rules that package's reader holds a manifest's to, since the build
 * writes each file under its path; a test holds the two to agreeing. The
 * licences are held to the allow-list the third-party notices are, so a pack
 * cannot ship under a licence the repository has not decided on.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decideLicence } from '../sync-third-party-notices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the definitions are. */
export const PACKS_FOLDER = join(HERE, 'packs');

/** The format of the manifest and the catalogue the application reads. */
export const MANIFEST_FORMAT = 1;

/** The name of a pack's manifest beside its files, which no file may take. */
export const MANIFEST_FILE = 'manifest.json';

/** The name of the catalogue at the top of the output. */
export const CATALOGUE_FILE = 'catalogue.json';

/**
 * @typedef {object} LicenceEvidence
 * @property {string} url where the licence was confirmed
 * @property {string} says what it says there
 *
 * @typedef {object} DefinitionLicence
 * @property {string} code
 * @property {string} weights
 * @property {readonly LicenceEvidence[]} evidence
 *
 * @typedef {object} DefinitionRuntime
 * @property {string} name
 * @property {string} minimum
 * @property {string} below
 * @property {readonly string[]} capabilities
 *
 * @typedef {import('./source-cache.mjs').PackSourceFile} PackSourceFile
 *
 * @typedef {object} Extract
 * @property {string} source
 * @property {string} member
 *
 * @typedef {{ readonly copy: string } | { readonly extract: Extract }} Taken
 *   a copy of a source, or a member extracted from a source's archive
 *
 * @typedef {{ readonly path: string } & Taken} ExportInput
 *
 * @typedef {object} Export
 * @property {string} script a file of `export/`
 * @property {readonly ExportInput[]} inputs placed under `{inputs}`
 * @property {readonly string[]} arguments with `{output}`, `{inputs}` and
 *   `{source:<id>}` replaced by paths
 *
 * @typedef {{ readonly notice: string }} Notice a notice of `notices/`
 * @typedef {Taken | Notice | { readonly export: Export }} Make
 *
 * @typedef {object} DefinitionFile
 * @property {string} path
 * @property {number} bytes
 * @property {string} sha256
 * @property {Make} make
 *
 * @typedef {object} PackDefinition
 * @property {string} id
 * @property {string} version
 * @property {string} name
 * @property {string} purpose
 * @property {DefinitionLicence} licence
 * @property {DefinitionRuntime} runtime
 * @property {readonly string[]} tiers
 * @property {Serves} serves
 * @property {readonly PackSourceFile[]} sources
 * @property {readonly DefinitionFile[]} files
 *
 * @typedef {object} Serves
 * @property {readonly string[]} processors
 * @property {readonly string[]} detectors
 *
 * @typedef {object} Accepted
 * @property {true} ok
 * @property {PackDefinition} definition
 *
 * @typedef {object} Refused
 * @property {false} ok
 * @property {readonly string[]} problems
 * @typedef {Accepted | Refused} DefinitionReading
 */

const PACK_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const PACK_VERSION = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/u;
const NAME = /^(?!\s)[^\p{Cc}]{1,80}(?<!\s)$/u;
const PROSE = /^(?!\s)[^\p{Cc}]{1,500}(?<!\s)$/u;
const RUNTIME_NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/u;
const TYPE_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const NOTICE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.txt$/u;
const SCRIPT_NAME = /^[a-z0-9_]+\.py$/u;
const PLACEHOLDER = /\{([^{}]*)\}/gu;

const CAPABILITIES = ['webassembly-simd', 'shared-array-buffer', 'webgpu'];
const TIERS = ['draft', 'standard', 'high', 'maximum'];

/** The most a pack may take installed, and a file be, as the reader bounds them. */
const MOST_PACK_BYTES = 2 ** 34;
const LONGEST_FILE_BYTES = 2 ** 31;
const MOST_FILES = 64;

/** A file path's bounds and its segments, as the package's reader holds them. */
const LONGEST_PATH = 255;
const MOST_SEGMENTS = 8;
const PATH_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/u;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:)/u;

/**
 * Why a path is not one a file of a pack may have, or `undefined` where it
 * may: the rules of `packages/model-packs/src/pack-files.ts`.
 *
 * @param {string} path
 * @returns {string | undefined}
 */
export function pathProblem(path) {
  if (path.includes('\\')) return 'uses a backslash, where segments are joined by /';
  if (ABSOLUTE_PATH.test(path)) return 'is absolute, where it is relative to its pack';
  if (path.length > LONGEST_PATH) return `is longer than ${String(LONGEST_PATH)} characters`;
  const segments = path.split('/');
  if (segments.length > MOST_SEGMENTS) {
    return `has more than ${String(MOST_SEGMENTS)} segments`;
  }
  if (segments.some((segment) => segment === '..')) return 'climbs out of its pack with ..';
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return 'has an empty or . segment';
  }
  return segments.every((segment) => PATH_SEGMENT.test(segment))
    ? undefined
    : 'has a segment of other than letters, digits, ., _ and -, or one starting with a dot';
}

/** The problems found so far, each with where it is. */
class Problems {
  /** @type {string[]} */
  list = [];

  /**
   * @param {string} at
   * @param {string} problem
   */
  add(at, problem) {
    this.list.push(`${at}: ${problem}`);
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The members of `value` where it is an object of exactly `members`.
 *
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @param {readonly string[]} members
 * @param {readonly string[]} [optional]
 * @returns {Record<string, unknown> | undefined}
 */
function objectOf(problems, value, at, members, optional = []) {
  if (!isRecord(value)) {
    problems.add(at, 'is not an object');
    return undefined;
  }
  let clear = true;
  for (const key of Object.keys(value)) {
    if (!members.includes(key) && !optional.includes(key)) {
      problems.add(at, `has a member ${key} no definition has`);
      clear = false;
    }
  }
  for (const key of members) {
    if (!(key in value)) {
      problems.add(at, `has no ${key}`);
      clear = false;
    }
  }
  return clear ? value : undefined;
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @param {RegExp} pattern
 * @param {string} shape
 * @returns {string | undefined}
 */
function textOf(problems, value, at, pattern, shape) {
  if (typeof value === 'string' && pattern.test(value)) return value;
  problems.add(at, `is not ${shape}`);
  return undefined;
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @param {number} least
 * @param {number} most
 * @returns {number | undefined}
 */
function integerOf(problems, value, at, least, most) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= least && value <= most) {
    return value;
  }
  problems.add(at, `is not a whole number from ${String(least)} to ${String(most)}`);
  return undefined;
}

/**
 * A list of distinct texts, each one of `allowed` or matching `pattern`.
 *
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @param {(item: string) => boolean} admits
 * @param {string} shape
 * @param {number} least
 * @returns {string[] | undefined}
 */
function distinctTexts(problems, value, at, admits, shape, least) {
  if (!Array.isArray(value)) {
    problems.add(at, 'is not a list');
    return undefined;
  }
  /** @type {string[]} */
  const items = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || !admits(item)) {
      problems.add(`${at}[${String(index)}]`, `is not ${shape}`);
    } else if (items.includes(item)) {
      problems.add(`${at}[${String(index)}]`, 'is named twice');
    } else {
      items.push(item);
    }
  }
  if (items.length < least) problems.add(at, `names fewer than ${String(least)}`);
  return items.length === value.length && items.length >= least ? items : undefined;
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @returns {string | undefined}
 */
function licenceExpression(problems, value, at) {
  if (typeof value !== 'string' || value.length === 0) {
    problems.add(at, 'is not an SPDX licence expression');
    return undefined;
  }
  const decision = decideLicence(value);
  if (!decision.allowed) {
    problems.add(at, `${value} is not allowed: ${decision.reason}`);
    return undefined;
  }
  return value;
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @returns {string | undefined}
 */
function httpsUrl(problems, value, at) {
  if (typeof value === 'string' && URL.canParse(value)) {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.username === '' && url.password === '') return value;
  }
  problems.add(at, 'is not an https URL without credentials');
  return undefined;
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @returns {DefinitionLicence | undefined}
 */
function readLicence(problems, value, at) {
  const object = objectOf(problems, value, at, ['code', 'weights', 'evidence']);
  if (object === undefined) return undefined;
  const code = licenceExpression(problems, object['code'], `${at}.code`);
  const weights = licenceExpression(problems, object['weights'], `${at}.weights`);
  const evidence = object['evidence'];
  /** @type {LicenceEvidence[]} */
  const confirmed = [];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    problems.add(`${at}.evidence`, 'names no place the licences were confirmed');
  } else {
    for (const [index, item] of evidence.entries()) {
      const where = `${at}.evidence[${String(index)}]`;
      const one = objectOf(problems, item, where, ['url', 'says']);
      if (one === undefined) continue;
      const url = httpsUrl(problems, one['url'], `${where}.url`);
      const says = textOf(problems, one['says'], `${where}.says`, PROSE, 'prose');
      if (url !== undefined && says !== undefined) confirmed.push({ url, says });
    }
  }
  return code === undefined ||
    weights === undefined ||
    !Array.isArray(evidence) ||
    confirmed.length !== evidence.length ||
    confirmed.length === 0
    ? undefined
    : { code, weights, evidence: confirmed };
}

/**
 * Compares two versions part by part, as `pack-version.ts` does.
 *
 * @param {string} one
 * @param {string} other
 */
function compareVersions(one, other) {
  const left = one.split('.').map(Number);
  const right = other.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @returns {DefinitionRuntime | undefined}
 */
function readRuntime(problems, value, at) {
  const object = objectOf(problems, value, at, ['name', 'minimum', 'below', 'capabilities']);
  if (object === undefined) return undefined;
  const version = 'a version major.minor.patch';
  const name = textOf(problems, object['name'], `${at}.name`, RUNTIME_NAME, 'a runtime name');
  const minimum = textOf(problems, object['minimum'], `${at}.minimum`, PACK_VERSION, version);
  const below = textOf(problems, object['below'], `${at}.below`, PACK_VERSION, version);
  const capabilities = distinctTexts(
    problems,
    object['capabilities'],
    `${at}.capabilities`,
    (item) => CAPABILITIES.includes(item),
    `one of ${CAPABILITIES.join(', ')}`,
    0,
  );
  if (minimum !== undefined && below !== undefined && compareVersions(minimum, below) >= 0) {
    problems.add(`${at}.below`, 'is not above the minimum');
    return undefined;
  }
  return name === undefined ||
    minimum === undefined ||
    below === undefined ||
    capabilities === undefined
    ? undefined
    : { name, minimum, below, capabilities };
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @returns {Serves | undefined}
 */
function readServes(problems, value, at) {
  const object = objectOf(problems, value, at, ['processors', 'detectors']);
  if (object === undefined) return undefined;
  const isKey = (/** @type {string} */ item) => TYPE_KEY.test(item) && item.length <= 64;
  const shape = 'a type key of lower-case words joined by hyphens';
  const processors = distinctTexts(
    problems,
    object['processors'],
    `${at}.processors`,
    isKey,
    shape,
    0,
  );
  const detectors = distinctTexts(
    problems,
    object['detectors'],
    `${at}.detectors`,
    isKey,
    shape,
    0,
  );
  if (processors === undefined || detectors === undefined) return undefined;
  if (processors.length + detectors.length === 0) {
    problems.add(at, 'serves no processor or detector');
    return undefined;
  }
  return { processors, detectors };
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @returns {PackSourceFile[] | undefined}
 */
function readSources(problems, value, at) {
  if (!Array.isArray(value) || value.length === 0) {
    problems.add(at, 'is not a list of one source at least');
    return undefined;
  }
  /** @type {PackSourceFile[]} */
  const sources = [];
  for (const [index, item] of value.entries()) {
    const where = `${at}[${String(index)}]`;
    const object = objectOf(problems, item, where, ['id', 'url', 'bytes', 'sha256'], ['archive']);
    if (object === undefined) continue;
    const id = textOf(problems, object['id'], `${where}.id`, SOURCE_ID, 'a source name');
    const url = httpsUrl(problems, object['url'], `${where}.url`);
    const bytes = integerOf(problems, object['bytes'], `${where}.bytes`, 0, MOST_PACK_BYTES);
    const sha256 = textOf(problems, object['sha256'], `${where}.sha256`, SHA256_HEX, 'a SHA-256');
    const archive = object['archive'];
    if (archive !== undefined && archive !== 'tar.gz') {
      problems.add(`${where}.archive`, 'is not tar.gz, the one archive the build reads');
      continue;
    }
    if (id !== undefined && sources.some((source) => source.id === id)) {
      problems.add(`${where}.id`, `names ${id}, which another source has`);
      continue;
    }
    if (id === undefined || url === undefined || bytes === undefined || sha256 === undefined) {
      continue;
    }
    sources.push(
      archive === undefined ? { id, url, bytes, sha256 } : { id, url, bytes, sha256, archive },
    );
  }
  return sources.length === value.length ? sources : undefined;
}

/**
 * A copy or an extraction from the sources.
 *
 * @param {Problems} problems
 * @param {Record<string, unknown>} object
 * @param {string} at
 * @param {readonly PackSourceFile[]} sources
 * @returns {Taken | undefined}
 */
function readTaken(problems, object, at, sources) {
  if ('copy' in object) {
    const id = object['copy'];
    if (typeof id === 'string' && sources.some((source) => source.id === id)) return { copy: id };
    problems.add(`${at}.copy`, 'names no source of the pack');
    return undefined;
  }
  const extract = objectOf(problems, object['extract'], `${at}.extract`, ['source', 'member']);
  if (extract === undefined) return undefined;
  const id = extract['source'];
  const member = extract['member'];
  const source = sources.find((one) => one.id === id);
  if (typeof id !== 'string' || source === undefined) {
    problems.add(`${at}.extract.source`, 'names no source of the pack');
    return undefined;
  }
  if (source.archive === undefined) {
    problems.add(`${at}.extract.source`, `names ${id}, which is not an archive`);
    return undefined;
  }
  if (typeof member !== 'string' || member.length === 0 || member.includes('\0')) {
    problems.add(`${at}.extract.member`, 'is not a member name');
    return undefined;
  }
  return { extract: { source: id, member } };
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @param {readonly PackSourceFile[]} sources
 * @returns {Export | undefined}
 */
function readExport(problems, value, at, sources) {
  const object = objectOf(problems, value, at, ['script', 'inputs', 'arguments']);
  if (object === undefined) return undefined;
  const script = textOf(
    problems,
    object['script'],
    `${at}.script`,
    SCRIPT_NAME,
    'a script of export/',
  );

  const inputs = object['inputs'];
  /** @type {ExportInput[]} */
  const placed = [];
  if (!Array.isArray(inputs)) {
    problems.add(`${at}.inputs`, 'is not a list');
  } else {
    for (const [index, item] of inputs.entries()) {
      const where = `${at}.inputs[${String(index)}]`;
      const kind = isRecord(item) && 'copy' in item ? 'copy' : 'extract';
      const input = objectOf(problems, item, where, ['path', kind]);
      if (input === undefined) continue;
      const path = input['path'];
      const problem = typeof path === 'string' ? pathProblem(path) : 'is not text';
      if (problem !== undefined || typeof path !== 'string') {
        problems.add(`${where}.path`, problem ?? 'is not text');
        continue;
      }
      if (placed.some((other) => other.path.toLowerCase() === path.toLowerCase())) {
        problems.add(`${where}.path`, 'is another input path');
        continue;
      }
      const taken = readTaken(problems, input, where, sources);
      if (taken !== undefined) placed.push({ path, ...taken });
    }
  }

  const parameters = object['arguments'];
  if (!Array.isArray(parameters) || parameters.some((item) => typeof item !== 'string')) {
    problems.add(`${at}.arguments`, 'is not a list of text');
    return undefined;
  }
  const texts = /** @type {string[]} */ (parameters);
  let outputs = 0;
  let clear = true;
  for (const [index, text] of texts.entries()) {
    for (const [, name = ''] of text.matchAll(PLACEHOLDER)) {
      if (name === 'output') outputs += 1;
      else if (name === 'inputs') continue;
      else if (!(
        name.startsWith('source:') && sources.some((one) => `source:${one.id}` === name)
      )) {
        problems.add(`${at}.arguments[${String(index)}]`, `names {${name}}, which is no path`);
        clear = false;
      }
    }
  }
  if (outputs !== 1) {
    problems.add(`${at}.arguments`, 'names {output}, where the file is written, other than once');
    clear = false;
  }
  return script === undefined || !Array.isArray(inputs) || placed.length !== inputs.length || !clear
    ? undefined
    : { script, inputs: placed, arguments: texts };
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @param {readonly PackSourceFile[]} sources
 * @returns {Make | undefined}
 */
function readMake(problems, value, at, sources) {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    problems.add(at, 'is not one of copy, extract, notice and export');
    return undefined;
  }
  if ('copy' in value || 'extract' in value) return readTaken(problems, value, at, sources);
  if ('notice' in value) {
    const name = textOf(
      problems,
      value['notice'],
      `${at}.notice`,
      NOTICE_NAME,
      'a file of notices/',
    );
    return name === undefined ? undefined : { notice: name };
  }
  if ('export' in value) {
    const made = readExport(problems, value['export'], `${at}.export`, sources);
    return made === undefined ? undefined : { export: made };
  }
  problems.add(at, 'is not one of copy, extract, notice and export');
  return undefined;
}

/**
 * @param {Problems} problems
 * @param {unknown} value
 * @param {string} at
 * @param {readonly PackSourceFile[]} sources
 * @returns {DefinitionFile[] | undefined}
 */
function readFiles(problems, value, at, sources) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MOST_FILES) {
    problems.add(at, `is not a list of 1 to ${String(MOST_FILES)} files`);
    return undefined;
  }
  /** @type {DefinitionFile[]} */
  const files = [];
  for (const [index, item] of value.entries()) {
    const where = `${at}[${String(index)}]`;
    const object = objectOf(problems, item, where, ['path', 'bytes', 'sha256', 'make']);
    if (object === undefined) continue;
    const path = object['path'];
    let clearPath = typeof path === 'string';
    if (typeof path !== 'string') {
      problems.add(`${where}.path`, 'is not text');
    } else {
      const problem = pathProblem(path);
      const folded = path.toLowerCase();
      if (problem !== undefined) {
        problems.add(`${where}.path`, problem);
        clearPath = false;
      } else if (folded === MANIFEST_FILE) {
        problems.add(`${where}.path`, `is ${MANIFEST_FILE}, which the pack's manifest takes`);
        clearPath = false;
      } else if (
        files.some((other) => {
          const otherFolded = other.path.toLowerCase();
          return (
            otherFolded === folded ||
            otherFolded.startsWith(`${folded}/`) ||
            folded.startsWith(`${otherFolded}/`)
          );
        })
      ) {
        problems.add(
          `${where}.path`,
          'is, or holds, or lies in another file of the pack, in any case',
        );
        clearPath = false;
      }
    }
    const bytes = integerOf(problems, object['bytes'], `${where}.bytes`, 1, LONGEST_FILE_BYTES);
    const sha256 = textOf(problems, object['sha256'], `${where}.sha256`, SHA256_HEX, 'a SHA-256');
    const make = readMake(problems, object['make'], `${where}.make`, sources);
    if (
      clearPath &&
      typeof path === 'string' &&
      bytes !== undefined &&
      sha256 !== undefined &&
      make !== undefined
    ) {
      files.push({ path, bytes, sha256, make });
    }
  }
  if (files.length !== value.length) return undefined;
  if (files.reduce((total, file) => total + file.bytes, 0) > MOST_PACK_BYTES) {
    problems.add(at, `add up to more than ${String(MOST_PACK_BYTES)} bytes`);
    return undefined;
  }
  return files;
}

const DEFINITION_MEMBERS = [
  'id',
  'version',
  'name',
  'purpose',
  'licence',
  'runtime',
  'tiers',
  'serves',
  'sources',
  'files',
];

/**
 * Reads a pack's definition from its parsed document, refusing it with every
 * problem it has.
 *
 * @param {unknown} value
 * @returns {DefinitionReading}
 */
export function readPackDefinition(value) {
  const problems = new Problems();
  const object = objectOf(problems, value, 'definition', DEFINITION_MEMBERS);
  if (object === undefined) return { ok: false, problems: problems.list };
  const id = textOf(
    problems,
    object['id'],
    'id',
    PACK_ID,
    'a name of lower-case letters, digits and inner hyphens',
  );
  const version = textOf(
    problems,
    object['version'],
    'version',
    PACK_VERSION,
    'a version major.minor.patch',
  );
  const name = textOf(problems, object['name'], 'name', NAME, 'a name of at most 80 characters');
  const purpose = textOf(
    problems,
    object['purpose'],
    'purpose',
    PROSE,
    'prose of at most 500 characters',
  );
  const licence = readLicence(problems, object['licence'], 'licence');
  const runtime = readRuntime(problems, object['runtime'], 'runtime');
  const tiers = distinctTexts(
    problems,
    object['tiers'],
    'tiers',
    (item) => TIERS.includes(item),
    `one of ${TIERS.join(', ')}`,
    1,
  );
  const serves = readServes(problems, object['serves'], 'serves');
  const sources = readSources(problems, object['sources'], 'sources');
  const files =
    sources === undefined ? undefined : readFiles(problems, object['files'], 'files', sources);
  if (
    id === undefined ||
    version === undefined ||
    name === undefined ||
    purpose === undefined ||
    licence === undefined ||
    runtime === undefined ||
    tiers === undefined ||
    serves === undefined ||
    sources === undefined ||
    files === undefined ||
    problems.list.length > 0
  ) {
    return { ok: false, problems: problems.list };
  }
  return {
    ok: true,
    definition: { id, version, name, purpose, licence, runtime, tiers, serves, sources, files },
  };
}

/**
 * Every definition in `folder`, each `<id>.json`, in order of id, or an error
 * listing every problem of every one.
 *
 * @param {string} [folder]
 * @returns {PackDefinition[]}
 */
export function loadPackDefinitions(folder = PACKS_FOLDER) {
  /** @type {PackDefinition[]} */
  const definitions = [];
  /** @type {string[]} */
  const problems = [];
  const names = readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .toSorted();
  for (const name of names) {
    /** @type {unknown} */
    let value;
    try {
      value = JSON.parse(readFileSync(join(folder, name), 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      problems.push(`${name}: is not JSON: ${error.message}`);
      continue;
    }
    const reading = readPackDefinition(value);
    if (!reading.ok) {
      problems.push(...reading.problems.map((problem) => `${name}: ${problem}`));
    } else if (`${reading.definition.id}.json` !== name) {
      problems.push(
        `${name}: defines ${reading.definition.id}, whose file is ${reading.definition.id}.json`,
      );
    } else {
      definitions.push(reading.definition);
    }
  }
  if (names.length === 0) problems.push(`${folder} holds no definition`);
  if (problems.length > 0) {
    throw new Error(`The pack definitions are refused:\n  ${problems.join('\n  ')}`);
  }
  return definitions;
}

/**
 * The manifest of a definition's pack, as the document `manifestJson` of
 * `packages/model-packs` writes and its reader reads, member for member.
 *
 * @param {PackDefinition} definition
 */
export function manifestOf(definition) {
  const downloadBytes = definition.files.reduce((total, file) => total + file.bytes, 0);
  return {
    format: MANIFEST_FORMAT,
    id: definition.id,
    name: definition.name,
    purpose: definition.purpose,
    version: definition.version,
    downloadBytes,
    // The store keeps a pack's files as they arrive, and nothing beside them.
    installedBytes: downloadBytes,
    files: definition.files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      sha256: file.sha256,
    })),
    licence: { code: definition.licence.code, weights: definition.licence.weights },
    runtime: {
      name: definition.runtime.name,
      minimum: definition.runtime.minimum,
      below: definition.runtime.below,
      capabilities: [...definition.runtime.capabilities],
    },
    tiers: [...definition.tiers],
    serves: {
      processors: [...definition.serves.processors],
      detectors: [...definition.serves.detectors],
    },
  };
}

/**
 * A pack's `manifest.json`.
 *
 * @param {PackDefinition} definition
 */
export function manifestText(definition) {
  return `${JSON.stringify(manifestOf(definition), null, 2)}\n`;
}

/**
 * The `catalogue.json` listing `definitions`' packs.
 *
 * @param {readonly PackDefinition[]} definitions
 */
export function catalogueText(definitions) {
  return `${JSON.stringify({ format: MANIFEST_FORMAT, packs: definitions.map(manifestOf) }, null, 2)}\n`;
}
