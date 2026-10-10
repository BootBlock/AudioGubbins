/**
 * Reading a value whose members depend on one of them, such as a union's
 * `kind`, and a number that is one of the literals a type allows, for the
 * readers of an export's settings (REQ-EXEC-136.12).
 */

import type { JsonObject, JsonValue } from './canonical-json.js';
import {
  anyObjectOf,
  checkMembers,
  pathOf,
  required,
  type Converter,
  type Reading,
} from './document-reading.js';
import { oneOfConverter } from './scalar-reading.js';

/** Converters of numbers to the literal values a type allows. */
export function literalConverter<TValue extends number>(
  values: readonly TValue[],
): Converter<TValue> {
  return (reading, value, parent, key) => {
    const found = values.find((candidate) => candidate === value);
    if (found === undefined) {
      reading.refuse(
        'schema.unknown-value',
        `One of ${values.join(', ')} is expected here.`,
        pathOf(parent, key),
      );
    }
    return found;
  };
}

/** An object whose members depend on its `kind`, read as `members` of that kind say. */
export function kindOf<TKind extends string>(
  reading: Reading,
  value: JsonValue,
  parent: string,
  key: string | number,
  member: string,
  kinds: Readonly<Record<TKind, ReadonlySet<string>>>,
): { readonly object: JsonObject; readonly at: string; readonly kind: TKind } | undefined {
  const object = anyObjectOf(reading, value, parent, key);
  if (object === undefined) return undefined;
  const at = pathOf(parent, key);
  const named = Object.keys(kinds).filter((kind): kind is TKind => kind in kinds);
  const kind = required(reading, object, at, member, oneOfConverter(named));
  if (kind === undefined) return undefined;
  checkMembers(reading, object, at, kinds[kind]);
  return { object, at, kind };
}

/** A set of member names. */
export const members = (...names: string[]): ReadonlySet<string> => new Set(names);
