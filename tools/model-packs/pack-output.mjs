/**
 * The built output, laid out as the application's catalogue serves it: a
 * folder per pack version, `<out>/<id>/<version>/`, holding the pack's files
 * at their paths and its `manifest.json`, and one `<out>/catalogue.json`
 * listing every pack the output holds. `HttpPackSource` asks for
 * `<catalogue>catalogue.json` and `<catalogue><id>/<version>/<path>`, so the
 * output folder is the catalogue's URL; a person imports a pack by choosing
 * its `manifest.json` and the files beside it.
 *
 * A pack is made in a hidden folder beside its place and renamed into it once
 * every file has been checked, so the output never holds a pack part made. The
 * check reads an output back: every file of every pack it holds by length and
 * hash, nothing else in a pack's folder, and the manifests and the catalogue
 * byte for byte.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { digestOf } from './file-digest.mjs';
import { CATALOGUE_FILE, MANIFEST_FILE, catalogueText, manifestText } from './pack-definitions.mjs';

/**
 * @typedef {import('./pack-definitions.mjs').PackDefinition} PackDefinition
 */

/**
 * The folder of a pack version in the output.
 *
 * @param {string} out
 * @param {PackDefinition} definition
 */
export function packFolder(out, definition) {
  return join(out, definition.id, definition.version);
}

/**
 * Makes a pack in a staging folder with `make`, then writes its manifest and
 * puts it in its place, replacing what was there.
 *
 * @param {string} out
 * @param {PackDefinition} definition
 * @param {(folder: string) => Promise<void>} make writes and checks the files
 * @returns {Promise<void>}
 */
export async function publishPack(out, definition, make) {
  const target = packFolder(out, definition);
  const staging = join(out, definition.id, `.${definition.version}.partial`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await make(staging);
    await writeFile(join(staging, MANIFEST_FILE), manifestText(definition));
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * The definitions whose pack versions the output holds a folder for.
 *
 * @param {string} out
 * @param {readonly PackDefinition[]} definitions
 */
export async function packsPresent(out, definitions) {
  /** @type {PackDefinition[]} */
  const present = [];
  for (const definition of definitions) {
    if (await isFolder(packFolder(out, definition))) present.push(definition);
  }
  return present;
}

/**
 * Writes the catalogue of `present`.
 *
 * @param {string} out
 * @param {readonly PackDefinition[]} present
 */
export async function writeCatalogue(out, present) {
  await mkdir(out, { recursive: true });
  await writeFile(join(out, CATALOGUE_FILE), catalogueText(present));
}

/**
 * Every way the output differs from the built output: in each pack of
 * `checked`, and in the catalogue, which lists `present`, the packs it holds.
 * Empty where it is exactly what the build writes.
 *
 * @param {string} out
 * @param {readonly PackDefinition[]} present
 * @param {readonly PackDefinition[]} checked
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
export async function outputProblems(out, present, checked, signal) {
  /** @type {string[]} */
  const problems = [];
  for (const definition of checked) {
    const folder = packFolder(out, definition);
    const at = `${definition.id}/${definition.version}`;
    const expected = new Set([MANIFEST_FILE, ...definition.files.map((file) => file.path)]);
    for (const path of await filesUnder(folder)) {
      if (!expected.has(path)) problems.push(`${at}/${path} is no file of the pack`);
    }
    for (const file of definition.files) {
      const path = join(folder, ...file.path.split('/'));
      if (!(await isFile(path))) {
        problems.push(`${at}/${file.path} is missing`);
        continue;
      }
      const digest = await digestOf(path, signal);
      if (digest.bytes !== file.bytes || digest.sha256 !== file.sha256) {
        problems.push(
          `${at}/${file.path} is ${String(digest.bytes)} bytes, sha256 ${digest.sha256}, ` +
            `where its definition records ${String(file.bytes)} bytes, sha256 ${file.sha256}`,
        );
      }
    }
    if ((await textOrUndefined(join(folder, MANIFEST_FILE))) !== manifestText(definition)) {
      problems.push(`${at}/${MANIFEST_FILE} is not the manifest of its definition`);
    }
  }
  if ((await textOrUndefined(join(out, CATALOGUE_FILE))) !== catalogueText(present)) {
    problems.push(`${CATALOGUE_FILE} is not the catalogue of the packs the output holds`);
  }
  return problems;
}

/**
 * Every file under `folder`, as a path relative to it joined by `/`.
 *
 * @param {string} folder
 * @returns {Promise<string[]>}
 */
async function filesUnder(folder) {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/** @param {string} path */
async function isFolder(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {string} path */
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {string} path */
async function textOrUndefined(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
