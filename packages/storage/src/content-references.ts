/**
 * Every content identifier a stored value holds, wherever in it (REQ-STOR-099,
 * REQ-STOR-102).
 *
 * A history's changes name media in their invocations' arguments, whose shape
 * only the command that reads them knows, so the storage finds media there by
 * searching the whole value for text of a content identifier's shape. That
 * errs, as keeping media must, on the side of finding too much: an external
 * file's own content identity is found too, though the store need not hold it.
 */

import {
  contentIdFrom,
  isContentId,
  isJsonArray,
  isJsonObject,
  type ContentId,
  type JsonValue,
} from '@audiogubbins/project-format';

/** Every content identifier `value` holds, anywhere in it; one may be given twice. */
export function* contentIdsIn(value: JsonValue): Generator<ContentId, void, undefined> {
  const pending: JsonValue[] = [value];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === 'string') {
      // Tested first, so the text of a project is not a refusal built per string.
      const content = isContentId(next) ? contentIdFrom(next) : undefined;
      if (content?.ok === true) yield content.value;
    } else if (isJsonArray(next)) {
      pending.push(...next);
    } else if (isJsonObject(next)) {
      pending.push(...Object.values(next));
    }
  }
}
