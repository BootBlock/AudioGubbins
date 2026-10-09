/**
 * The bounds a pack is held to and the form of the hashes it states
 * (ADR-0062): how many files it may name, how long a file and the whole pack
 * may be, and a SHA-256 as a manifest writes it.
 *
 * JavaScript with its types in JSDoc, which the package's compiler checks, so
 * the manifest reader and the pack build tool, which loads it in Node with no
 * compiler, hold a pack to the same bounds. It imports nothing.
 */

/** The most files a pack may name. */
export const MOST_FILES = 64;

/**
 * The longest file a pack may hold: 2 GiB. A model is read whole into memory
 * for the runtime to load, and no browser gives one buffer much more.
 */
export const LONGEST_FILE_BYTES = 2 ** 31;

/** The most a pack may take installed, or a source of one be: 16 GiB, a bound on what is believed. */
export const MOST_PACK_BYTES = 2 ** 34;

/** A SHA-256: 64 lower-case hexadecimal digits. */
export const SHA256_HEX = /^[0-9a-f]{64}$/u;
