/**
 * Quoting back a value that came from storage or from a file, in a sentence a
 * reader is shown.
 *
 * Saying which region, panel, format or version was refused is what lets a
 * reader work out why something could not be used, so the value is quoted
 * rather than left out. The value is not the application's, though: every page
 * on one address shares that storage, and a shortcut profile is something users
 * share (REQ-UX-066), so the text in one is not always the reader's own. Quoted
 * whole, a stored layout of four megabytes would go into the log, into a
 * diagnostic bundle with it, into the status bar, and into an assertive live
 * region read at the reader as it arrives, and so would an imported profile's
 * version field of a quarter of a megabyte.
 */

import { cutToBound } from './cutting.js';

/** The longest a refusal quotes of a value it was given. */
const LONGEST_QUOTED = 40;

/**
 * A value as a refusal quotes it: its text on one line and cut to
 * {@link LONGEST_QUOTED}, or what kind of thing it was where it is not text.
 */
export function asQuoted(value: unknown): string {
  if (typeof value === 'object' && value !== null) return 'a value of another kind';
  const plain = String(value).replaceAll(/\s+/gu, ' ').trim();
  return cutToBound(plain, LONGEST_QUOTED);
}
