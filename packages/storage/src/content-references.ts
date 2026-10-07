/**
 * Every content identifier a stored value holds, wherever in it (REQ-STOR-099,
 * REQ-STOR-102).
 *
 * A history's changes name media in their invocations' arguments, whose shape
 * only the command that reads them knows, so the storage finds media there by
 * searching the whole value, nested JSON text among it (`nested-values.ts`),
 * for text of a content identifier's shape. That errs, as keeping media must,
 * on the side of finding too much: an external file's own content identity is
 * found too, though the store need not hold it.
 */

import {
  contentIdFrom,
  isContentId,
  type ContentId,
  type JsonValue,
} from '@audiogubbins/project-format';

import { valuesWithin } from './nested-values.js';

/** Every content identifier `value` holds, anywhere in it; one may be given twice. */
export function* contentIdsIn(value: JsonValue): Generator<ContentId, void, undefined> {
  for (const each of valuesWithin(value)) {
    // Tested first, so the text of a project is not a refusal built per string.
    if (typeof each !== 'string' || !isContentId(each)) continue;
    const content = contentIdFrom(each);
    if (content.ok) yield content.value;
  }
}
