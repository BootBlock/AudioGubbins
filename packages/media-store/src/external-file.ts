/**
 * A file the user chose, as the platform adapter hands it over, and the check
 * that what it says about itself can be recorded (REQ-STOR-104,
 * REQ-EXEC-136.12).
 *
 * The names and the path are held to the rules the project document's reader
 * holds them to (`source-reading.ts` in the format package), so an identity or
 * a provenance record made here is never one the reader refuses: a handle token
 * is never a path, a file name has no separator, and a relative path cannot
 * climb out of the directory it was granted in.
 *
 * The media type is normalised rather than refused. The browser guesses it from
 * the name and gives the empty string where it cannot, so it is a hint and not
 * an identity: parameters are dropped, it is lower-cased, and a type that is
 * not `type/subtype` becomes `application/octet-stream`.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { ByteSource } from '@audiogubbins/project-format';

/** A file the user chose, through the platform adapter. */
export interface ExternalFile {
  readonly source: ByteSource;

  /** The file's own name, without a path. */
  readonly fileName: string;

  /** The media type the platform reports, which may be empty. */
  readonly mediaType: string;

  /** When the file was last modified, in whole milliseconds since the epoch. */
  readonly lastModified: number;

  /** The token the platform's handle to the file is kept under, where one is. */
  readonly handleKey?: string | undefined;

  /** Where the file lies inside a directory the user granted, where it came from one. */
  readonly relativePath?: string | undefined;
}

/** What a file says about itself, checked and normalised. */
export interface CheckedFile {
  readonly fileName: string;
  readonly mediaType: string;
  readonly lastModified: number;
  readonly handleKey?: string;
  readonly relativePath?: string;
}

/** The media type of bytes of unknown kind. */
const UNKNOWN_MEDIA_TYPE = 'application/octet-stream';

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const MEDIA_TYPE_LENGTH = 255;
const FILE_NAME = /^[^/\\\p{Cc}]+$/u;
const FILE_NAME_LENGTH = 1_024;
const HANDLE_KEY = /^[A-Za-z0-9._:-]{1,128}$/u;
const RELATIVE_PATH = /^(?:[^/\\:\p{Cc}]+\/)*[^/\\:\p{Cc}]+$/u;
const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/u;
const RELATIVE_PATH_LENGTH = 4_096;

/** What the file says about itself, or every reason it cannot be recorded. */
export function checkedFile(file: ExternalFile): DomainResult<CheckedFile> {
  const problems = [
    file.fileName.length <= FILE_NAME_LENGTH && FILE_NAME.test(file.fileName)
      ? undefined
      : malformed('file-name', 'A file name is its own name, without a path.'),
    Number.isSafeInteger(file.lastModified) && file.lastModified >= 0
      ? undefined
      : malformed('last-modified', 'A modification time is whole milliseconds since the epoch.'),
    file.handleKey === undefined || HANDLE_KEY.test(file.handleKey)
      ? undefined
      : malformed('handle-key', 'A handle token is letters, digits and . _ : -, never a path.'),
    file.relativePath === undefined || isRelativePath(file.relativePath)
      ? undefined
      : malformed('relative-path', 'A relative path stays inside the directory it was granted in.'),
  ].filter((problem) => problem !== undefined);

  const [first, ...rest] = problems;
  if (first !== undefined) return fail(first, ...rest);
  return succeed({
    fileName: file.fileName,
    mediaType: normalisedMediaType(file.mediaType),
    lastModified: file.lastModified,
    ...(file.handleKey === undefined ? {} : { handleKey: file.handleKey }),
    ...(file.relativePath === undefined ? {} : { relativePath: file.relativePath }),
  });
}

/** The media type as a record keeps it (see the module comment). */
function normalisedMediaType(reported: string): string {
  const [essence = ''] = reported.split(';');
  const type = essence.trim().toLowerCase();
  return type.length <= MEDIA_TYPE_LENGTH && MEDIA_TYPE.test(type) ? type : UNKNOWN_MEDIA_TYPE;
}

function isRelativePath(path: string): boolean {
  return path.length <= RELATIVE_PATH_LENGTH && RELATIVE_PATH.test(path) && !DOT_SEGMENT.test(path);
}

function malformed(signal: string, summary: string): DomainFailure {
  return failure(`media.${signal}-malformed`, FailureKind.Rejected, summary);
}
