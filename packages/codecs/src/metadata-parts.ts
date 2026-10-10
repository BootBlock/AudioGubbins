/**
 * The parts of a map a format cannot hold, as its writer reports them
 * (ADR-0093): nothing is dropped without the person being told.
 *
 * A writer states what its format holds as a value, and the parts it holds
 * only in part (a text value its field cannot state, a foreign key its format
 * cannot name, loops beyond the one the tags carry) it adds itself, since only
 * it knows the value's limits.
 */

import type { MetadataMap, MetadataPart, MetadataTextKey } from './metadata-map.js';

/** The parts beyond text, foreign fields and loops that a format holds. */
export interface FormatHolds {
  readonly text: ReadonlySet<MetadataTextKey>;
  readonly broadcast: boolean;
  readonly cues: boolean;
  readonly tuning: boolean;
  readonly coverArt: boolean;
}

/** The parts of `map` the format holds no field for at all, in the map's order of parts. */
export function partsNotHeld(map: MetadataMap, holds: FormatHolds): MetadataPart[] {
  const dropped: MetadataPart[] = [];
  for (const [key] of textEntries(map)) {
    if (!holds.text.has(key)) dropped.push({ kind: 'text', key });
  }
  if (map.broadcast !== undefined && !holds.broadcast) dropped.push({ kind: 'broadcast' });
  if ((map.cues?.length ?? 0) > 0 && !holds.cues) dropped.push({ kind: 'cues' });
  if (map.tuning !== undefined && !holds.tuning) dropped.push({ kind: 'tuning' });
  if (map.coverArt !== undefined && !holds.coverArt) dropped.push({ kind: 'coverArt' });
  return dropped;
}

/** The map's text fields with a value that is not empty, in the writers' order; an empty value is no field. */
export function textEntries(map: MetadataMap): readonly (readonly [MetadataTextKey, string])[] {
  const entries: (readonly [MetadataTextKey, string])[] = [];
  for (const key of TEXT_KEYS) {
    const value = map.text?.[key];
    if (value !== undefined && value !== '') entries.push([key, value]);
  }
  return entries;
}

/** Every text key, in the order writers write them, so output never depends on an object's key order. */
const TEXT_KEYS: readonly MetadataTextKey[] = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'trackNumber',
  'trackTotal',
  'discNumber',
  'discTotal',
  'date',
  'genre',
  'comment',
  'copyright',
  'encoder',
  'isrc',
];

/** Every text key, as a set a format holding all of them states. */
export const ALL_TEXT_KEYS: ReadonlySet<MetadataTextKey> = new Set(TEXT_KEYS);
