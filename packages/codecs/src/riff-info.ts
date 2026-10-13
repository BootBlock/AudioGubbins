/**
 * A WAV's `LIST`/`INFO` text: the ids with a typed key, and every other id kept
 * by its own four characters under the `riff-info` scheme.
 *
 * Each typed key keeps the first value the file gives it; a repeated typed id
 * is kept by its own id, so a second title is not lost. An entry whose id is
 * not printable is left out rather than refused, because some writers pad a
 * list with zeroed entries and that breaks nothing the map needs.
 */

import { succeed, type DomainResult } from '@audiogubbins/domain';

import type { ForeignMetadataField, MetadataTextKey } from './metadata-map.js';
import { LONG_TEXT, readText, textRulesOf } from './metadata-text.js';
import { listEntries } from './riff-list-entries.js';
import { MAXIMUM_INFO_FIELDS } from './metadata-limits.js';

/** The `INFO` ids with a typed key. Any other id is kept by its own key. */
export const INFO_FIELDS: ReadonlyMap<string, MetadataTextKey> = new Map([
  ['INAM', 'title'],
  ['IART', 'artist'],
  ['IPRD', 'album'],
  ['ICMT', 'comment'],
  ['ICOP', 'copyright'],
  ['ICRD', 'date'],
  ['IGNR', 'genre'],
  ['ISFT', 'encoder'],
  ['ITRK', 'trackNumber'],
]);

/** The scheme of an `INFO` field kept by its own id. */
export const INFO_SCHEME = 'riff-info';

/** An `INFO` id as the form writes one: four printable ASCII characters, the first not a space. */
export const PRINTABLE_ID = /^[\x21-\x7e][\x20-\x7e]{3}$/;

/** The text of every `INFO` list a file holds, gathered as the walk meets them. */
export class InfoText {
  readonly text: Partial<Record<MetadataTextKey, string>> = {};
  readonly foreign: ForeignMetadataField[] = [];
  private entries = 0;

  /** Reads one `INFO` list's entries, the type already taken off. */
  read(list: Uint8Array): DomainResult<undefined> {
    const room = MAXIMUM_INFO_FIELDS - this.entries;
    const entries = listEntries(list, 'INFO', room, MAXIMUM_INFO_FIELDS);
    if (!entries.ok) return entries;
    this.entries += entries.value.length;
    for (const { id, body } of entries.value) {
      if (!PRINTABLE_ID.test(id)) continue;
      const key = INFO_FIELDS.get(id);
      if (key !== undefined && this.text[key] === undefined) {
        this.text[key] = readText(body, 'unstated', textRulesOf(key));
      } else {
        this.foreign.push({
          scheme: INFO_SCHEME,
          key: id,
          value: readText(body, 'unstated', LONG_TEXT),
        });
      }
    }
    return succeed(undefined);
  }
}
