/**
 * The bounds every metadata reader holds a file to (ADR-0093, REQ-EXEC-136).
 *
 * Each is far past what a real file carries and small enough that a hostile
 * one cannot make a reader hold much memory or loop long: a reader refuses a
 * file past a bound rather than reading on.
 */

/** The most bytes of metadata one reader reads from a file, pictures included. */
export const MAXIMUM_METADATA_BYTES = 64 * 1024 * 1024;

/** The most fields, frames, comments or atoms one reader reads. */
export const MAXIMUM_METADATA_FIELDS = 4_096;

/** The most bytes of one text value. */
export const MAXIMUM_TEXT_BYTES = 1024 * 1024;

/** The most bytes of an embedded picture. */
export const MAXIMUM_PICTURE_BYTES = 32 * 1024 * 1024;

/** The deepest a reader descends into nested boxes or blocks. */
export const MAXIMUM_NESTING = 16;
