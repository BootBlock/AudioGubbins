/**
 * Every value a stored value holds, at any depth, nested JSON text among it:
 * the one walk the searches for media (`content-references.ts`) and for model
 * packs (`pack-pins.ts`) read.
 *
 * An argument is a primitive, so a command that takes a nested value, such as
 * an asset with its source or a chain, takes it as one string of JSON, which
 * names what it refers to inside the text. So a string that reads as a JSON
 * object or list within the bounds any command reads a nested value within is
 * walked as that value too; one past them is no value any command reads, and
 * names nothing a change could restore.
 *
 * The walk keeps its own stack rather than recursing, since a stored value is
 * as deep as its record's limits allow, and moves a list's items or an
 * object's members onto it one at a time: spreading them as one call's
 * arguments throws past the engine's argument limit, and a record may hold a
 * list far longer than that.
 */

import {
  NESTED_ARGUMENT_LIMITS,
  isJsonArray,
  isJsonObject,
  parseJson,
  type JsonValue,
} from '@audiogubbins/project-format';

/** The first character of the text of a JSON object or list. */
const NESTED_START = /^[[{]/u;

/**
 * `value` and every value within it, each list and object before what it
 * holds; a string that reads as nested JSON is given, then the value it
 * reads as.
 */
export function* valuesWithin(value: JsonValue): Generator<JsonValue, void, undefined> {
  const pending: JsonValue[] = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    yield next;
    if (typeof next === 'string') {
      if (!NESTED_START.test(next)) continue;
      const nested = parseJson(next, NESTED_ARGUMENT_LIMITS);
      if (nested.ok) pending.push(nested.value);
    } else if (isJsonArray(next)) {
      for (const item of next) pending.push(item);
    } else if (isJsonObject(next)) {
      for (const member of Object.values(next)) pending.push(member);
    }
  }
}
