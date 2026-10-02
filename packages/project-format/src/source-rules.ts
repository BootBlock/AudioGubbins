/**
 * The rules for the text an external source is recorded by: a kept handle's
 * token, a file's name and a path inside a granted directory (REQ-STOR-104,
 * REQ-PRIV-165, REQ-EXEC-136.12).
 *
 * Each rule is read by the project document's reader and offered as a check to
 * whatever records an identity before any document holds it, so the two cannot
 * drift apart: a token is never a path nor a key a chosen folder is kept
 * under, a name has no separator, and a path cannot climb out of the directory
 * it was granted in.
 */

import { fitsTextRule, textConverter, type TextRule } from './scalar-reading.js';
import { NAME_RULE } from './value-reading.js';

/**
 * The prefix of every key the browser keeps a chosen folder's handle under, one
 * key for each use of a folder (`FolderUse` in browser-storage). Those keys sit
 * beside linked files' tokens in one store, so no token may begin with it: a
 * file recorded in a project could otherwise name a folder's handle, and
 * forgetting the file would forget the folder.
 */
export const FOLDER_KEY_PREFIX = 'folder:';

/**
 * A kept handle's token: never a path, so no separator of any kind, and never
 * a key reserved for a folder.
 */
const HANDLE_KEY_RULE: TextRule = {
  maximumLength: 128,
  pattern: new RegExp(`^(?!${FOLDER_KEY_PREFIX})[A-Za-z0-9._:-]+$`, 'u'),
  shape: `a token of letters, digits and . _ : -, not beginning "${FOLDER_KEY_PREFIX}"`,
};

/** A file's own name, with no separator: a name is never a path. */
const FILE_NAME_RULE: TextRule = {
  ...NAME_RULE,
  pattern: /^[^/\\\p{Cc}]+$/u,
  shape: 'a file name without a path',
};

/**
 * A path inside a directory the user granted: segments joined by `/`, none
 * empty, none `.` or `..`, and no backslash, colon or control character, so it
 * can never climb out of the directory or name a drive. The lookahead refuses
 * a dot segment wherever it stands.
 */
const RELATIVE_PATH_RULE: TextRule = {
  maximumLength: 4_096,
  pattern: /^(?!(?:[^/]*\/)*\.{1,2}(?:\/|$))(?:[^/\\:\p{Cc}]+\/)*[^/\\:\p{Cc}]+$/u,
  shape: 'a relative path inside the granted directory',
};

export const asHandleKey = textConverter(HANDLE_KEY_RULE);
export const asFileName = textConverter(FILE_NAME_RULE);
export const asRelativePath = textConverter(RELATIVE_PATH_RULE);

/** Whether text is a token a kept handle can be recorded under. */
export function isHandleKey(text: string): boolean {
  return fitsTextRule(HANDLE_KEY_RULE, text);
}

/** Whether text is a file's own name, as an identity or a provenance records it. */
export function isFileName(text: string): boolean {
  return fitsTextRule(FILE_NAME_RULE, text);
}

/** Whether text is a path inside a granted directory, as an identity records it. */
export function isRelativePath(text: string): boolean {
  return fitsTextRule(RELATIVE_PATH_RULE, text);
}
