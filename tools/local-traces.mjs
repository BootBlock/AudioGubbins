/**
 * Traces of the machine a tool runs on: its directories and its account name.
 *
 * REQ-PRIV-161 treats a local path as personal data, because it carries an
 * account name and often a machine name, and this repository is public, so a
 * leak is permanent. The build-output check looks for these traces in what a
 * deployment uploads, and the notices tool in the notices it writes.
 */

import { homedir, tmpdir, userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What a machine's directories and account name are found by.
 *
 * @typedef {object} Roots
 * @property {readonly RegExp[]} directories
 * @property {RegExp} [account]
 */

/**
 * A regular expression that matches its argument literally.
 *
 * @param {string} text
 * @returns {string}
 */
function literal(text) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * The directories this build ran in, in every form they could be written.
 *
 * Asking whether *this machine's* paths reached the output is the precise
 * question, and it has no false positives: a shape-matching rule over minified
 * third-party code would report `https://react.dev/` as a drive path and an
 * escaped `\\u00C0` as a share name. Every machine checks its own roots, so the
 * gate is as strong on a contributor's machine and on a build runner as it is
 * here.
 *
 * @returns {Roots}
 */
export function localRoots() {
  // The account name on its own, which is the part that identifies a person.
  /** @type {string | undefined} */
  let account;
  try {
    account = userInfo().username;
  } catch {
    // A container can have no passwd entry for the running user. The directory
    // roots still cover the paths that would carry the name.
    account = undefined;
  }
  return rootsOf([REPO_ROOT, process.cwd(), homedir(), tmpdir()], account);
}

/**
 * What a machine's directories and account name are found by, in every form
 * they could be written. The account is only counted when a separator
 * precedes it, so an account called `build` does not match the word.
 *
 * @param {readonly string[]} directories
 * @param {string | undefined} account
 * @returns {Roots}
 */
export function rootsOf(directories, account) {
  /** @type {Set<string>} */
  const forms = new Set();
  for (const root of directories) {
    if (root === '') continue;
    forms.add(root.replaceAll('\\', '/'));
    forms.add(root.replaceAll('/', '\\'));
  }

  return {
    // Matched case-insensitively: Windows paths are, and a bundler may
    // normalise a drive letter either way.
    directories: [...forms].map((form) => new RegExp(literal(form), 'gi')),
    ...(account === undefined || account.length < 3
      ? {}
      : { account: new RegExp(String.raw`[\\/]${literal(account)}(?=[\\/]|$|["'\s])`, 'gi') }),
  };
}

/**
 * Every trace of this machine in a piece of text.
 *
 * @param {string} text
 * @param {Roots} [roots]
 * @returns {string[]}
 */
export function localTracesIn(text, roots = localRoots()) {
  /** @type {string[]} */
  const found = [];
  for (const pattern of roots.directories) {
    for (const match of text.matchAll(pattern)) found.push(match[0]);
  }
  if (roots.account !== undefined) {
    for (const match of text.matchAll(roots.account)) found.push(match[0]);
  }
  return found;
}
