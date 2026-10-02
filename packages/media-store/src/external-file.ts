/**
 * A file the user chose, as the platform adapter hands it over, and the check
 * that what it says about itself can be recorded (REQ-STOR-104,
 * REQ-EXEC-136.12).
 *
 * Each signal is held to the rule the project document's reader holds it to,
 * asked of the format itself rather than copied, so an identity or a provenance
 * record made here is never one the reader refuses: a handle token is never a
 * path, a file name has no separator, and a relative path cannot climb out of
 * the directory it was granted in.
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
import {
  isFileName,
  isHandleKey,
  isMediaType,
  isRelativePath,
  isWholeQuantity,
  type ByteSource,
} from '@audiogubbins/project-format';

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

/** What the file says about itself, or every reason it cannot be recorded. */
export function checkedFile(file: ExternalFile): DomainResult<CheckedFile> {
  const problems = [
    isFileName(file.fileName)
      ? undefined
      : malformed('file-name', 'A file name is its own name, without a path.'),
    isWholeQuantity(file.lastModified)
      ? undefined
      : malformed('last-modified', 'A modification time is whole milliseconds since the epoch.'),
    file.handleKey === undefined || isHandleKey(file.handleKey)
      ? undefined
      : malformed(
          'handle-key',
          'A handle token is letters, digits and . _ : -, never a path or a folder’s key.',
        ),
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
  return isMediaType(type) ? type : UNKNOWN_MEDIA_TYPE;
}

function malformed(signal: string, summary: string): DomainFailure {
  return failure(`media.${signal}-malformed`, FailureKind.Rejected, summary);
}
