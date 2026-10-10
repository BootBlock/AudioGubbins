/**
 * The parts of a map a format cannot hold, as its writer reports them
 * (ADR-0093): nothing is dropped without the person being told.
 *
 * A writer states what its format holds as a value, and the parts it holds only
 * in part (a text value its field cannot state, a foreign key its format cannot
 * name, loops beyond the one the tags carry) it adds itself, since only it
 * knows the value's limits.
 */

import type { MetadataMap, MetadataPart, MetadataTextKey } from './metadata-map.js';
import {
  LINE_TEXT,
  LONG_TEXT,
  TEXT_KEYS,
  readsBackUnchanged,
  textRulesOf,
} from './metadata-text.js';

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

/**
 * The map without the text values and foreign fields its readers would not give
 * back unchanged (`metadata-text.ts`), and those parts, as a tag writer reports
 * them: a value with a control character or past its bound in characters is
 * dropped whole rather than written as something the person did not say.
 */
export function readableParts(map: MetadataMap): {
  readonly map: MetadataMap;
  readonly dropped: readonly MetadataPart[];
} {
  const dropped: MetadataPart[] = [];
  const text: Partial<Record<MetadataTextKey, string>> = {};
  for (const key of TEXT_KEYS) {
    const value = map.text?.[key];
    if (value === undefined) continue;
    if (readsBackUnchanged(value, textRulesOf(key))) text[key] = value;
    else dropped.push({ kind: 'text', key });
  }
  const foreign = (map.foreign ?? []).filter((field) => {
    const readable =
      readsBackUnchanged(field.key, LINE_TEXT) && readsBackUnchanged(field.value, LONG_TEXT);
    if (!readable) dropped.push({ kind: 'foreign', scheme: field.scheme, key: field.key });
    return readable;
  });
  if (dropped.length === 0) return { map, dropped };
  return {
    map: {
      ...map,
      ...(map.text === undefined ? {} : { text }),
      ...(map.foreign === undefined ? {} : { foreign }),
    },
    dropped,
  };
}

/** Every text key, as a set a format holding all of them states. */
export const ALL_TEXT_KEYS: ReadonlySet<MetadataTextKey> = new Set(TEXT_KEYS);
