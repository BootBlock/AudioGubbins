/**
 * The metadata an asset's file carried, as the Inspector sums it up
 * (REQ-EDIT-072, REQ-STOR-166, ADR-0093): each text field the codecs' map
 * names, under the name a person knows it by, then what else the file holds,
 * counted or described rather than listed, each a term and its detail.
 *
 * Every value is the file's own, untrusted text, which the readers bounded and
 * which is shown only as text. Cues and loops became the asset's markers and
 * regions as it was imported, so they are counted here, not listed again.
 */

import type { MetadataTextKey } from '@audiogubbins/codecs';
import type { KeptMetadata } from '@audiogubbins/project-format';
import { counted, quoted } from '@audiogubbins/text';

import { describeBytes } from '../../wording.js';
import type { SourceFact } from './source-words.js';

/** Each text field, in the order the Inspector lists them, by the name a person knows it by. */
const TEXT_TERMS: readonly (readonly [MetadataTextKey, string])[] = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['albumArtist', 'Album artist'],
  ['trackNumber', 'Track'],
  ['trackTotal', 'Tracks'],
  ['discNumber', 'Disc'],
  ['discTotal', 'Discs'],
  ['date', 'Date'],
  ['genre', 'Genre'],
  ['comment', 'Comment'],
  ['copyright', 'Copyright'],
  ['encoder', 'Encoded with'],
  ['isrc', 'ISRC'],
];

/** The facts of the metadata `metadata` holds; none where it holds none. */
export function metadataFacts(metadata: KeptMetadata): readonly SourceFact[] {
  const facts: SourceFact[] = [];
  const text = metadata.text ?? {};
  for (const [key, term] of TEXT_TERMS) {
    const value = text[key];
    if (value !== undefined && value !== '') facts.push({ term, detail: value });
  }
  const { broadcast, cues, loops, tuning, coverArt, foreign } = metadata;
  if (broadcast !== undefined) {
    const by = broadcast.originator === '' ? '' : ` by ${quoted(broadcast.originator)}`;
    facts.push({
      term: 'Broadcast Wave',
      detail: `Originated${by} on ${broadcast.originationDate} at ${broadcast.originationTime}.`,
    });
  }
  if (cues !== undefined && cues.length > 0) {
    facts.push({ term: 'Cue points', detail: counted(cues.length, 'cue point', 'cue points') });
  }
  if (loops !== undefined && loops.length > 0) {
    facts.push({ term: 'Loops', detail: counted(loops.length, 'loop', 'loops') });
  }
  if (tuning !== undefined) {
    facts.push({
      term: 'Tuning',
      detail: `Unity note ${String(tuning.unityNote)}, ${String(tuning.fineTuneCents)} cents fine`,
    });
  }
  if (coverArt !== undefined) {
    const described = coverArt.description === '' ? '' : `, ${quoted(coverArt.description)}`;
    facts.push({
      term: 'Picture',
      detail: `${coverArt.mediaType}, ${describeBytes(coverArt.byteLength)}${described}`,
    });
  }
  if (foreign !== undefined && foreign.length > 0) {
    facts.push({
      term: 'Other fields',
      detail: counted(foreign.length, 'field', 'fields'),
    });
  }
  return facts;
}
