/**
 * Editing a written document the way a damaged or hand-edited file differs from
 * a good one, for the tests of what a reader refuses.
 */

import { isJsonArray, isJsonObject, memberOf, type JsonValue } from '../canonical-json.js';

/** A step into a value: a member's key or an item's index. */
export type Step = string | number;

/**
 * The value with what lies at `path` replaced by `change` of it, or removed
 * where `change` returns `undefined`. Throws where the path leads nowhere,
 * since that is a mistake in the test.
 */
export function edited(
  value: JsonValue,
  path: readonly Step[],
  change: (current: JsonValue | undefined) => JsonValue | undefined,
): JsonValue {
  const [step, ...rest] = path;
  if (step === undefined) {
    const replaced = change(value);
    if (replaced === undefined) throw new Error('The whole document cannot be removed.');
    return replaced;
  }

  const inner = (current: JsonValue | undefined): JsonValue | undefined =>
    rest.length === 0 ? change(current) : edited(requireValue(current, step), rest, change);

  if (typeof step === 'number' && isJsonArray(value)) {
    const items = [...value];
    const replaced = inner(items[step]);
    if (replaced === undefined) items.splice(step, 1);
    else items[step] = replaced;
    return items;
  }
  if (typeof step === 'string' && isJsonObject(value)) {
    const replaced = inner(memberOf(value, step));
    const entries = Object.entries(value).filter(([key]) => key !== step);
    if (replaced !== undefined) entries.push([step, replaced]);
    return Object.fromEntries(entries);
  }
  throw new Error(`The step ${String(step)} does not lead into this value.`);
}

/** The value with what lies at `path` set to `replacement`. */
export function withValue(
  value: JsonValue,
  path: readonly Step[],
  replacement: JsonValue,
): JsonValue {
  return edited(value, path, () => replacement);
}

/** The value with what lies at `path` removed. */
export function without(value: JsonValue, path: readonly Step[]): JsonValue {
  return edited(value, path, () => undefined);
}

/** What lies at `path` in the value. Throws where the path leads nowhere. */
export function valueAt(value: JsonValue, path: readonly Step[]): JsonValue {
  let current = value;
  for (const step of path) {
    const next =
      typeof step === 'number' && isJsonArray(current)
        ? current[step]
        : typeof step === 'string' && isJsonObject(current)
          ? memberOf(current, step)
          : undefined;
    current = requireValue(next, step);
  }
  return current;
}

function requireValue(value: JsonValue | undefined, step: Step): JsonValue {
  if (value === undefined) throw new Error(`Nothing lies at the step ${String(step)}.`);
  return value;
}
