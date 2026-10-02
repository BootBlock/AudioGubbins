/**
 * Every content identifier a stored value holds, wherever in it (REQ-STOR-099,
 * REQ-STOR-102).
 *
 * A history's changes name media in their invocations' arguments, whose shape
 * only the command that reads them knows, so the storage finds media there by
 * searching the whole value for text of a content identifier's shape. That
 * errs, as keeping media must, on the side of finding too much: an external
 * file's own content identity is found too, though the store need not hold it.
 *
 * An argument is a primitive, so a command that takes a nested value, such as
 * an asset with its source or where an asset's bytes are kept, takes it as one
 * string of JSON, which names its media inside the text. So a string that
 * reads as a JSON object or list within the bounds any command reads a nested
 * value within is searched as that value too; one past them is no value any
 * command reads, and names nothing a change could restore.
 */

import {
  NESTED_ARGUMENT_LIMITS,
  contentIdFrom,
  isContentId,
  isJsonArray,
  isJsonObject,
  parseJson,
  type ContentId,
  type JsonValue,
} from '@audiogubbins/project-format';

/** The first character of the text of a JSON object or list. */
const NESTED_START = /^[[{]/u;

/** Every content identifier `value` holds, anywhere in it; one may be given twice. */
export function* contentIdsIn(value: JsonValue): Generator<ContentId, void, undefined> {
  const pending: JsonValue[] = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === 'string') {
      // Tested first, so the text of a project is not a refusal built per string.
      const content = isContentId(next) ? contentIdFrom(next) : undefined;
      if (content?.ok === true) yield content.value;
      else if (NESTED_START.test(next)) {
        const nested = parseJson(next, NESTED_ARGUMENT_LIMITS);
        if (nested.ok) pending.push(nested.value);
      }
    } else if (isJsonArray(next)) {
      pending.push(...next);
    } else if (isJsonObject(next)) {
      pending.push(...Object.values(next));
    }
  }
}
