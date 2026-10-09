/**
 * The pinned Python environment the export scripts run in.
 *
 * An export's bytes depend on the exact versions of the libraries that write
 * them, so the scripts run in a virtual environment of their own, made in the
 * cache from `export/requirements.txt`: every package at one version, each
 * file checked by its hash as pip installs it, nothing from the machine's own
 * site packages, and the CPU builds of torch, which export the same bytes as
 * the CUDA builds and are a fraction of their size. The environment is kept
 * under the hash of the requirements and the interpreter's version, so a
 * change to either makes a new one rather than altering one in place.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The variable that names the Python interpreter, where `python` will not do. */
export const PYTHON_VARIABLE = 'AUDIOGUBBINS_PACK_PYTHON';

/**
 * The Python release the requirements are pinned for: torch 2.9.1 and
 * tensorflow-cpu 2.21.0 publish wheels for it, and the recorded exports were
 * made with it.
 */
export const PYTHON_RELEASE = '3.10';

/** Written last, so an environment whose install stopped is made again. */
const READY = 'ready';

/**
 * A pinned environment: its interpreter, and what identifies it in a report.
 *
 * @typedef {object} PythonEnvironment
 * @property {string} python the environment's interpreter
 * @property {string} description the interpreter's version, the platform and
 *   the requirements' hash
 */

/**
 * The environment for `requirements`, made in `cache` with the interpreter
 * `AUDIOGUBBINS_PACK_PYTHON` names, or `python`, where it is not there yet.
 *
 * @param {string} requirements the path of `requirements.txt`
 * @param {string} cache
 * @param {NodeJS.ProcessEnv} environment
 * @param {AbortSignal} [signal]
 * @returns {Promise<PythonEnvironment>}
 */
export async function pinnedEnvironment(requirements, cache, environment, signal) {
  const named = environment[PYTHON_VARIABLE];
  const base = named !== undefined && named !== '' ? named : 'python';
  const version = (await output(base, ['-I', '-c', VERSION_QUERY], signal)).trim();
  if (!version.startsWith(`${PYTHON_RELEASE}.`)) {
    throw new Error(
      `The exports run on Python ${PYTHON_RELEASE}, and ${base} is Python ${version}. ` +
        `Name a Python ${PYTHON_RELEASE} interpreter in ${PYTHON_VARIABLE}.`,
    );
  }

  const pinned = await readFile(requirements);
  const identity = createHash('sha256').update(pinned).update(`\0${version}`).digest('hex');
  const folder = join(cache, 'python', identity.slice(0, 16));
  const python =
    process.platform === 'win32'
      ? join(folder, 'Scripts', 'python.exe')
      : join(folder, 'bin', 'python');
  const description =
    `Python ${version} on ${process.platform}-${process.arch}, ` +
    `requirements sha256 ${createHash('sha256').update(pinned).digest('hex')}`;

  if (!(await exists(join(folder, READY)))) {
    await rm(folder, { recursive: true, force: true });
    await run(base, ['-I', '-m', 'venv', folder], signal);
    await run(
      python,
      [
        '-I',
        '-m',
        'pip',
        'install',
        '--no-input',
        '--disable-pip-version-check',
        '--no-deps',
        '--require-hashes',
        '--only-binary',
        ':all:',
        '--requirement',
        requirements,
      ],
      signal,
    );
    await writeFile(join(folder, READY), `${description}\n`);
  }
  return { python, description };
}

const VERSION_QUERY = 'import platform; print(platform.python_version())';

/**
 * Runs `script` in the environment, isolated from the user's site packages
 * and from every `PYTHON*` variable, with its output shown.
 *
 * @param {PythonEnvironment} environment
 * @param {string} script
 * @param {readonly string[]} parameters
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function runScript(environment, script, parameters, signal) {
  return run(environment.python, ['-I', script, ...parameters], signal);
}

/**
 * Runs a program with its output shown, failing where it fails.
 *
 * @param {string} program
 * @param {readonly string[]} parameters
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function run(program, parameters, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(program, parameters, {
      stdio: 'inherit',
      ...(signal === undefined ? {} : { signal }),
    });
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else
        rejectPromise(new Error(`${program} ${parameters.join(' ')} exited with ${String(code)}.`));
    });
  });
}

/**
 * What a program writes to its standard output.
 *
 * @param {string} program
 * @param {readonly string[]} parameters
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
function output(program, parameters, signal) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(program, parameters, {
      stdio: ['ignore', 'pipe', 'inherit'],
      ...(signal === undefined ? {} : { signal }),
    });
    /** @type {Buffer[]} */
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(/** @type {Buffer} */ (chunk)));
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(chunks).toString('utf8'));
      else
        rejectPromise(new Error(`${program} ${parameters.join(' ')} exited with ${String(code)}.`));
    });
  });
}

/** @param {string} path */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
