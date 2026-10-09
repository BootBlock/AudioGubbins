/**
 * Makes a pack's files from its definition: fetches its sources, checked by
 * hash, into the cache, takes each file from them as its definition says, and
 * checks every file made against the length and SHA-256 its definition
 * records, refusing the pack, by file, where any differs.
 *
 * A file is copied from a source, extracted from a source's archive, copied
 * from a notice the repository keeps, or written by an export script run in
 * the pinned Python environment over inputs taken from the sources. Sources
 * are fetched one at a time, and each archive is read once, however many of
 * its members are taken.
 */

import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestOf } from './file-digest.mjs';
import { runScript } from './python-environment.mjs';
import { cachedSource } from './source-cache.mjs';
import { extractMembers } from './tar-members.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the notices a pack carries are kept. */
export const NOTICES_FOLDER = join(HERE, 'notices');

/** Where the export scripts and their requirements are kept. */
export const EXPORT_FOLDER = join(HERE, 'export');

/**
 * @typedef {import('./pack-definitions.mjs').PackDefinition} PackDefinition
 * @typedef {import('./pack-definitions.mjs').Extract} Extract
 * @typedef {import('./python-environment.mjs').PythonEnvironment} Environment
 * @typedef {import('./source-cache.mjs').Download} Download
 *
 * @typedef {object} MakingServices
 * @property {string} cache the cache folder
 * @property {Download} download
 * @property {() => Promise<Environment>} python the pinned environment,
 *   made the first time an export asks for it
 * @property {(line: string) => void} report
 * @property {AbortSignal} [signal]
 */

/**
 * A path under `folder` from a pack's path, whose segments the definition
 * reader has already held to staying inside it.
 *
 * @param {string} folder
 * @param {string} path
 */
function under(folder, path) {
  return join(folder, ...path.split('/'));
}

/**
 * The time since `started`, from `performance.now()`, for a report.
 *
 * @param {number} started
 */
export function seconds(started) {
  return `${((performance.now() - started) / 1000).toFixed(1)} s`;
}

/**
 * Makes every file of `definition`'s pack in `folder`, and checks each.
 *
 * @param {PackDefinition} definition
 * @param {string} folder an empty folder the pack's files are written to
 * @param {MakingServices} services
 * @returns {Promise<void>}
 */
export async function makePack(definition, folder, services) {
  const { cache, report, signal } = services;

  /** @type {Map<string, string>} */
  const sourcePaths = new Map();
  for (const source of definition.sources) {
    const started = performance.now();
    const { path, downloaded } = await cachedSource(source, cache, services.download, signal);
    sourcePaths.set(source.id, path);
    report(
      `  source ${source.id}: ${downloaded ? 'downloaded and' : 'in the cache,'} confirmed ` +
        `${String(source.bytes)} bytes, sha256 ${source.sha256} (${seconds(started)})`,
    );
  }
  const sourcePath = (/** @type {string} */ id) => {
    const path = sourcePaths.get(id);
    if (path === undefined) throw new Error(`${definition.id} names no source ${id}.`);
    return path;
  };

  await mkdir(join(cache, 'work'), { recursive: true });
  const work = await mkdtemp(join(cache, 'work', `${definition.id}-`));
  try {
    /** @type {Map<string, Map<string, string[]>>} source, member, destinations */
    const extractions = new Map();
    const extractTo = (/** @type {Extract} */ extract, /** @type {string} */ destination) => {
      const members = extractions.get(extract.source) ?? new Map();
      extractions.set(extract.source, members);
      members.set(extract.member, [...(members.get(extract.member) ?? []), destination]);
    };
    /** @type {{ path: string, script: string, parameters: string[] }[]} */
    const exports = [];
    /** @type {Set<string>} */
    const exported = new Set();

    for (const [index, file] of definition.files.entries()) {
      const destination = under(folder, file.path);
      await mkdir(dirname(destination), { recursive: true });
      const make = file.make;
      if ('copy' in make) {
        await copyFile(sourcePath(make.copy), destination);
      } else if ('extract' in make) {
        extractTo(make.extract, destination);
      } else if ('notice' in make) {
        await copyFile(join(NOTICES_FOLDER, make.notice), destination);
      } else {
        const inputs = join(work, `export-${String(index)}`);
        for (const input of make.export.inputs) {
          const placed = under(inputs, input.path);
          await mkdir(dirname(placed), { recursive: true });
          if ('copy' in input) await copyFile(sourcePath(input.copy), placed);
          else extractTo(input.extract, placed);
        }
        await mkdir(inputs, { recursive: true });
        const parameters = make.export.arguments.map((text) =>
          text.replaceAll(/\{([^{}]*)\}/gu, (_whole, /** @type {string} */ name) => {
            if (name === 'output') return destination;
            if (name === 'inputs') return inputs;
            return sourcePath(name.slice('source:'.length));
          }),
        );
        exports.push({ path: file.path, script: make.export.script, parameters });
        exported.add(file.path);
      }
    }

    for (const [id, members] of extractions) {
      const started = performance.now();
      /** @type {Map<string, string>} */
      const first = new Map();
      for (const [member, destinations] of members) first.set(member, destinations[0] ?? '');
      await extractMembers(sourcePath(id), first, signal);
      for (const destinations of members.values()) {
        for (const destination of destinations.slice(1)) {
          await copyFile(destinations[0] ?? '', destination);
        }
      }
      report(`  extracted ${[...members.keys()].join(', ')} from ${id} (${seconds(started)})`);
    }

    /** @type {Environment | undefined} */
    let environment;
    for (const made of exports) {
      if (environment === undefined) {
        const started = performance.now();
        environment = await services.python();
        report(`  python: ${environment.description} (${seconds(started)})`);
      }
      const started = performance.now();
      report(`  exporting ${made.path} with export/${made.script}`);
      await runScript(environment, join(EXPORT_FOLDER, made.script), made.parameters, signal);
      report(`  exported ${made.path} (${seconds(started)})`);
    }

    /** @type {string[]} */
    const mismatches = [];
    for (const file of definition.files) {
      const started = performance.now();
      const digest = await digestOf(under(folder, file.path), signal);
      if (digest.bytes === file.bytes && digest.sha256 === file.sha256) {
        report(
          `  made ${file.path}: ${String(file.bytes)} bytes, sha256 ${file.sha256} (checked in ${seconds(started)})`,
        );
        continue;
      }
      const madeBy =
        exported.has(file.path) && environment !== undefined
          ? `${environment.description}, Node ${process.version}`
          : `Node ${process.version} on ${process.platform}-${process.arch}`;
      mismatches.push(
        `${file.path}\n` +
          `    expected ${String(file.bytes)} bytes, sha256 ${file.sha256}\n` +
          `    made     ${String(digest.bytes)} bytes, sha256 ${digest.sha256}\n` +
          `    made by  ${madeBy}`,
      );
    }
    if (mismatches.length > 0) {
      throw new Error(
        `${definition.id} ${definition.version} made files that are not the ones its definition records:\n  ` +
          mismatches.join('\n  '),
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
