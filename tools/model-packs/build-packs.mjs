#!/usr/bin/env node
/**
 * Builds the model packs from their definitions, outside the repository
 * (ADR-0062, REQ-REPO-191).
 *
 * Model weights never enter the repository. It keeps, for each pack, a
 * definition under `packs/`: what the pack's files are made from, each source
 * by a pinned URL, its length and its SHA-256, how each file is made, and the
 * length and SHA-256 of every file made. This tool fetches the sources into a
 * cache, one at a time and streamed to disk, checks each before it is used,
 * makes the files, two of them by the export scripts under `export/` in a
 * pinned Python environment, checks every file against its definition, and
 * writes the packs and one catalogue as the application reads them. A source
 * already in the cache with its hash is not fetched again.
 *
 * The cache is the folder `AUDIOGUBBINS_PACK_CACHE` names, or else the
 * platform's per-user cache folder: `%LOCALAPPDATA%\AudioGubbins\pack-cache`
 * on Windows, `~/Library/Caches/AudioGubbins/packs` on macOS and
 * `$XDG_CACHE_HOME/audiogubbins/packs` (`~/.cache/...`) elsewhere. The exports
 * need Python 3.11, named by `AUDIOGUBBINS_PACK_PYTHON` where `python` is
 * another. Neither the cache nor the output may lie inside the repository.
 *
 * Usage:
 *   node tools/model-packs/build-packs.mjs [--out <folder>] [<pack id>...]
 *       build the packs named, or every pack, into <folder>, by default the
 *       cache's `catalogue` folder
 *   node tools/model-packs/build-packs.mjs --check [--out <folder>] [<id>...]
 *       check a built output without the network: the packs named, or every
 *       pack, present and exactly as built, and the catalogue
 */

import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPackDefinitions } from './pack-definitions.mjs';
import { EXPORT_FOLDER, makePack, seconds } from './pack-making.mjs';
import { outputProblems, packsPresent, publishPack, writeCatalogue } from './pack-output.mjs';
import { pinnedEnvironment } from './python-environment.mjs';
import { cacheFolder } from './source-cache.mjs';
import { downloadTo } from './source-download.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const USAGE =
  'Usage: node tools/model-packs/build-packs.mjs [--check] [--out <folder>] [<pack id>...]';

/**
 * What the command line asks for.
 *
 * @typedef {object} Request
 * @property {boolean} check
 * @property {string | undefined} out
 * @property {string[]} ids
 */

/**
 * @param {readonly string[]} parameters
 * @returns {Request}
 */
function requestOf(parameters) {
  /** @type {Request} */
  const request = { check: false, out: undefined, ids: [] };
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index] ?? '';
    if (parameter === '--check') {
      request.check = true;
    } else if (parameter === '--out') {
      const folder = parameters[index + 1];
      if (folder === undefined) throw new Error(`--out names no folder.\n${USAGE}`);
      request.out = folder;
      index += 1;
    } else if (parameter.startsWith('-')) {
      throw new Error(`${parameter} is not an option.\n${USAGE}`);
    } else {
      request.ids.push(parameter);
    }
  }
  return request;
}

/**
 * Refuses a folder inside the repository, where nothing the build writes may
 * go: a model's weights committed by accident cannot be taken out of history.
 *
 * @param {string} folder
 * @param {string} what
 */
function refuseInsideRepository(folder, what) {
  const path = relative(REPO_ROOT, folder);
  if (path === '' || (!path.startsWith('..') && !isAbsolute(path))) {
    throw new Error(`The ${what}, ${folder}, is inside the repository; name a folder outside it.`);
  }
}

/**
 * @param {readonly string[]} parameters
 * @returns {Promise<number>}
 */
async function main(parameters) {
  const request = requestOf(parameters);
  const definitions = loadPackDefinitions();
  const unknown = request.ids.filter((id) => !definitions.some((one) => one.id === id));
  if (unknown.length > 0) {
    throw new Error(
      `No pack is defined as ${unknown.join(', ')}; the packs are ${definitions.map((one) => one.id).join(', ')}.`,
    );
  }
  const selected =
    request.ids.length === 0
      ? definitions
      : definitions.filter((one) => request.ids.includes(one.id));

  const cache = cacheFolder(process.env, process.platform);
  const out = request.out === undefined ? join(cache, 'catalogue') : resolve(request.out);
  refuseInsideRepository(cache, 'cache');
  refuseInsideRepository(out, 'output');

  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort(new Error('Stopped.')));
  const signal = stop.signal;

  if (request.check) {
    const present = await packsPresent(out, definitions);
    const absent = selected.filter((one) => !present.includes(one));
    const problems = [
      ...absent.map((one) => `${one.id}/${one.version} is not in the output`),
      ...(await outputProblems(
        out,
        present,
        selected.filter((one) => present.includes(one)),
        signal,
      )),
    ];
    if (problems.length > 0) {
      console.error(`The output at ${out} is not the built packs:\n  ${problems.join('\n  ')}`);
      return 1;
    }
    console.log(
      `The output at ${out} holds ${selected.map((one) => one.id).join(', ')} exactly as built.`,
    );
    return 0;
  }

  console.log(`Cache: ${cache}\nOutput: ${out}`);
  /** @type {Promise<import('./python-environment.mjs').PythonEnvironment> | undefined} */
  let environment;
  const services = {
    cache,
    download: downloadTo,
    python: () =>
      (environment ??= pinnedEnvironment(
        join(EXPORT_FOLDER, 'requirements.txt'),
        cache,
        process.env,
        signal,
      )),
    report: (/** @type {string} */ line) => console.log(line),
    signal,
  };
  for (const definition of selected) {
    const started = performance.now();
    console.log(`${definition.id} ${definition.version}`);
    await publishPack(out, definition, (folder) => makePack(definition, folder, services));
    console.log(`${definition.id} ${definition.version}: built in ${seconds(started)}`);
  }

  const present = await packsPresent(out, definitions);
  await writeCatalogue(out, present);
  const started = performance.now();
  const problems = await outputProblems(out, present, present, signal);
  if (problems.length > 0) {
    console.error(`The output at ${out} is not the built packs:\n  ${problems.join('\n  ')}`);
    return 1;
  }
  console.log(
    `Wrote the catalogue of ${present.map((one) => one.id).join(', ')}; ` +
      `the output checked in ${seconds(started)}.`,
  );
  return 0;
}

// Compared as real paths, as `check-record-titles.mjs` explains: a tool run
// through a junction would otherwise do nothing and exit zero.
if (
  process.argv[1] !== undefined &&
  realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url))
) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (/** @type {unknown} */ error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
