/**
 * Versions as packs and runtimes state them: `major.minor.patch`, each a whole
 * number without a leading zero, compared part by part.
 *
 * A pack's update is a higher version of the same pack, and a pack runs on the
 * runtime versions from its `minimum` up to its `below`, so both rest on one
 * ordering. Nothing else of semantic versioning (pre-releases, build metadata)
 * is admitted: a pack is published or it is not.
 *
 * JavaScript with its types in JSDoc, which the package's compiler checks, so
 * the pack build tool loads this one grammar in Node with no compiler, as the
 * build's configuration bundles it (see `pack-path.js`).
 */

/** A version: three parts of up to six digits each, with no leading zero. */
export const PACK_VERSION = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/u;

/** The longest version text, which `PACK_VERSION` already bounds. */
export const LONGEST_VERSION = 20;

/**
 * A version's three parts, or `undefined` where the text is not a version.
 *
 * @param {string} text
 * @returns {readonly [number, number, number] | undefined}
 */
function partsOf(text) {
  const match = PACK_VERSION.exec(text);
  if (match === null) return undefined;
  const [, major = '', minor = '', patch = ''] = match;
  return [Number(major), Number(minor), Number(patch)];
}

/**
 * Negative where `one` is lower than `other`, positive where higher, zero where
 * they are the same; `undefined` where either is not a version.
 *
 * @param {string} one
 * @param {string} other
 * @returns {number | undefined}
 */
export function compareVersions(one, other) {
  const left = partsOf(one);
  const right = partsOf(other);
  if (left === undefined || right === undefined) return undefined;
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Whether `version` lies from `minimum` up to but not including `below`; false
 * where any of them is not a version, since what cannot be compared cannot be
 * shown to fit.
 *
 * @param {string} version
 * @param {string} minimum
 * @param {string} below
 * @returns {boolean}
 */
export function versionWithin(version, minimum, below) {
  const fromMinimum = compareVersions(version, minimum);
  const toBelow = compareVersions(version, below);
  return fromMinimum !== undefined && toBelow !== undefined && fromMinimum >= 0 && toBelow < 0;
}
