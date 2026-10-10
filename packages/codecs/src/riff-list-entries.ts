/**
 * The entries of a RIFF `LIST` chunk's list: each an id, a little-endian size
 * and a body padded to an even length, as `INFO` and `adtl` both lay them out.
 *
 * The form forbids a list inside these lists, so one is refused rather than
 * walked, which also bounds nesting at one level. A trailing fragment too short
 * for an entry's header is the list's padding, not an entry.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { fourCharacterCode, viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { quotedCode } from './recognised-format.js';

/** One entry of a list: its id and its body. */
export interface ListEntry {
  readonly id: string;
  readonly body: Uint8Array;
}

/** A list's type, before its entries, and an entry's id and size, before its body. */
export const LIST_TYPE_BYTES = 4;
export const ENTRY_HEADER_BYTES = 8;

/**
 * The entries of a list of `type`, refusing one that runs past the list, a
 * list inside it, or more entries than `room` leaves of the file's `bound`.
 */
export function listEntries(
  list: Uint8Array,
  type: string,
  room: number,
  bound: number,
): DomainResult<readonly ListEntry[]> {
  const view = viewOf(list);
  const entries: ListEntry[] = [];
  for (let at = 0; at + ENTRY_HEADER_BYTES <= list.length;) {
    const id = fourCharacterCode(list, at);
    const size = view.getUint32(at + 4, true);
    if (id === 'LIST') {
      return fail(
        malformed(`The ${quotedCode(type)} list holds a list inside it, which the form forbids.`),
      );
    }
    if (size > list.length - at - ENTRY_HEADER_BYTES) {
      return fail(
        malformed(`An entry of the ${quotedCode(type)} list runs past the end of the list.`),
      );
    }
    if (entries.length === room) {
      return fail(
        malformed(
          `The file's ${quotedCode(type)} lists hold more than the ${String(bound)} entries any file needs.`,
        ),
      );
    }
    const start = at + ENTRY_HEADER_BYTES;
    entries.push({ id, body: list.subarray(start, start + size) });
    at = start + size + (size % 2);
  }
  return succeed(entries);
}
