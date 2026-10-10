/**
 * The `labl` entries of a WAV's `LIST`/`adtl` lists: the names of cue points,
 * and of loops, by their cue ids.
 *
 * A list may lie before or after the chunks whose ids it names, so labels are
 * gathered over the whole walk and matched once it ends. The first label of an
 * id is kept. Notes and labelled texts name nothing the map holds, so they are
 * counted against the bound and passed over.
 */

import { fail, succeed, type DomainResult } from '@audiogubbins/domain';

import { viewOf } from './byte-reading.js';
import { malformed } from './codec-failures.js';
import { LINE_TEXT, decodeText } from './metadata-text.js';
import { listEntries } from './riff-list-entries.js';

/** The most `adtl` entries read from one file: a label and a note for every cue point and loop. */
const MAXIMUM_LIST_ENTRIES = 10_240;

/** The cue id a `labl` entry starts with, before its text. */
export const LABEL_CUE_ID_BYTES = 4;

/** The labels of every `adtl` list a file holds, by cue id. */
export class CueLabels {
  readonly names = new Map<number, string>();
  private entries = 0;

  /** Reads one `adtl` list's entries, the type already taken off. */
  read(list: Uint8Array): DomainResult<undefined> {
    const room = MAXIMUM_LIST_ENTRIES - this.entries;
    const entries = listEntries(list, 'adtl', room, MAXIMUM_LIST_ENTRIES);
    if (!entries.ok) return entries;
    this.entries += entries.value.length;
    for (const { id, body } of entries.value) {
      if (id !== 'labl') continue;
      if (body.length < LABEL_CUE_ID_BYTES) {
        return fail(malformed("A 'labl' entry is too short to name the cue point it labels."));
      }
      const cueId = viewOf(body).getUint32(0, true);
      if (!this.names.has(cueId)) {
        this.names.set(cueId, decodeText(body.subarray(LABEL_CUE_ID_BYTES), LINE_TEXT));
      }
    }
    return succeed(undefined);
  }
}
