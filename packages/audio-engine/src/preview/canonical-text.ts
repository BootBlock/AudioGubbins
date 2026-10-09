/**
 * One text for a value, whichever way it was built: the key of a cache that
 * must find a sound again from a plan made afresh (`cached-stream-key.ts`).
 *
 * The project format writes a plan canonically, but the engine is below it
 * and reads plans as the domain holds them, with maps for parameter values
 * and typed arrays for learned state, which `JSON.stringify` writes as empty
 * objects. So the members of an object are written in name order, a map as
 * its entries in the order of their keys' text, a typed array as its numbers,
 * and a member that is absent and one that is `undefined` alike, since
 * neither changes a sound. Each kind is marked, so a map never reads as a
 * list and no two values that differ share a text.
 */

/** The text of one value (see the module comment). */
export function canonicalText(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  switch (typeof value) {
    case 'number':
      // `JSON.stringify` writes every non-finite number as `null`.
      return Number.isFinite(value) ? JSON.stringify(value) : `"#${String(value)}"`;
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'object':
      return objectText(value);
    default:
      throw new Error(`A ${typeof value} has no canonical text.`);
  }
}

/** The numbers of a typed array of numbers, the kinds learned state and samples are held in. */
function numbersOf(value: object): readonly number[] | undefined {
  return value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof Int32Array ||
    value instanceof Int16Array ||
    value instanceof Uint8Array
    ? Array.from(value)
    : undefined;
}

function objectText(value: object): string {
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(',')}]`;
  const numbers = numbersOf(value);
  if (numbers !== undefined) return `{"#numbers":[${numbers.map(canonicalText).join(',')}]}`;
  if (ArrayBuffer.isView(value)) throw new Error('This kind of typed array has no canonical text.');
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([key, entry]): readonly [string, string] => [
      canonicalText(key),
      canonicalText(entry),
    ]);
    entries.sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0));
    return `{"#map":[${entries.map(([key, entry]) => `[${key},${entry}]`).join(',')}]}`;
  }
  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0));
  return `{${members.map(([name, member]) => `${JSON.stringify(name)}:${canonicalText(member)}`).join(',')}}`;
}
