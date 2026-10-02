/**
 * The text files of a project's tree, each made only when its writer asks for
 * it (REQ-STOR-103, REQ-EXEC-216).
 *
 * A text is the pretty canonical JSON of its value, refused where it would be
 * past what the tree's reader reads, in characters or in bytes once encoded,
 * which the reader measures first, since a tree that cannot be read back is no
 * copy. A text whose value is read from elsewhere, a kept state, may turn out
 * not to be there after all, and the tree is then written without that file.
 */

import { fail, mapResult, succeed, type DomainResult } from '@audiogubbins/domain';

import { compareCodeUnits, prettyCanonicalJsonWithin, type JsonValue } from './canonical-json.js';
import { LONGEST_METADATA, TREE_JSON_LIMITS, atFile, fileTooLarge } from './project-tree-files.js';
import type { ContentId } from './content-identity.js';
import { encodeUtf8 } from './utf8.js';

/**
 * A text file's bytes, made when they are asked for: refused where the file
 * would be past what its reader reads, and `undefined` for a file the tree is
 * written without after all.
 */
export type TreeText = (
  signal?: AbortSignal,
) => Promise<DomainResult<Uint8Array<ArrayBuffer> | undefined>>;

/** What one file of a tree holds. */
export type TreeFileBody =
  | { readonly kind: 'text'; readonly text: TreeText }
  | { readonly kind: 'media'; readonly contentId: ContentId; readonly byteLength: number }
  | {
      readonly kind: 'cache';
      readonly path: string;
      readonly byteLength: number;
      readonly contentId: ContentId;
    };

/** One file of a tree. */
export interface ProjectTreeFile {
  readonly path: string;
  readonly body: TreeFileBody;
}

/** The files of a tree as they are added. */
export class TreeFiles {
  private readonly files = new Map<string, TreeFileBody>();

  add(path: string, body: TreeFileBody): void {
    if (this.files.has(path)) throw new Error(`Two parts of a project tree share ${path}.`);
    this.files.set(path, body);
  }

  /** Adds a text file of the value `value` gives when the text is asked for. */
  text(path: string, value: () => JsonValue): void {
    this.add(path, { kind: 'text', text: () => Promise.resolve(textAt(path, value())) });
  }

  /**
   * Adds a text file of the value `read` gives when the text is asked for, or
   * none where it gives `undefined`.
   */
  read(
    path: string,
    read: (signal?: AbortSignal) => Promise<DomainResult<JsonValue | undefined>>,
  ): void {
    this.add(path, {
      kind: 'text',
      text: async (signal) => {
        const value = await read(signal);
        if (!value.ok) return value;
        return value.value === undefined ? succeed(undefined) : textAt(path, value.value);
      },
    });
  }

  sorted(): readonly ProjectTreeFile[] {
    return [...this.files]
      .map(([path, body]) => ({ path, body }))
      .sort((one, other) => compareCodeUnits(one.path, other.path));
  }
}

/** The text of `value` as the file at `path`, refused where its reader would refuse it. */
function textAt(path: string, value: JsonValue): DomainResult<Uint8Array<ArrayBuffer>> {
  const text = prettyCanonicalJsonWithin(value, TREE_JSON_LIMITS);
  if (!text.ok) return fail(atFile(text.failures[0], path));
  const bytes = mapResult(text, encodeUtf8);
  return bytes.ok && bytes.value.length > LONGEST_METADATA ? fail(fileTooLarge(path)) : bytes;
}
