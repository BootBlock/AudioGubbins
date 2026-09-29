/**
 * Writing a value of the format as JSON, deterministically.
 *
 * Each document's writer builds its value with these, so every document of the
 * format leaves an absent member out rather than writing `null`, and writes a
 * map or a set of entities as a list sorted by key: the same value then always
 * gives the same canonical text (REQ-STOR-026, REQ-STOR-166).
 */

import {
  compareCodeUnits,
  type JsonArray,
  type JsonObject,
  type JsonValue,
} from './canonical-json.js';

/** The members of an object, with those that are `undefined` left out. */
export function presentMembers(
  members: Readonly<Record<string, JsonValue | undefined>>,
): JsonObject {
  const present: [string, JsonValue][] = [];
  for (const [key, value] of Object.entries(members)) {
    if (value !== undefined) present.push([key, value]);
  }
  return Object.fromEntries(present);
}

/** Values sorted by a key they carry, written one by one. */
export function sortedBy<TValue>(
  values: Iterable<TValue>,
  keyOf: (value: TValue) => string,
  write: (value: TValue) => JsonValue,
): JsonArray {
  return [...values].sort((left, right) => compareCodeUnits(keyOf(left), keyOf(right))).map(write);
}
