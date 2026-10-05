/**
 * Whether two records of the project hold the same values, where the project
 * crosses from the storage worker whole with each change and so every record of
 * a new state arrives a copy of the one before.
 *
 * A record is compared by identity first, which settles every one of a state
 * told of again, and by the text it writes where that fails. A record is a value
 * that never changes, so its text is written once for as long as it is held,
 * and a record kept from one state to compare the next with is never written
 * again.
 */

/** Each record's text, for as long as the record is held. */
const TEXTS = new WeakMap<object, string>();

/** The text of `record`, which two records holding the same values share. */
function textOf(record: object): string {
  const known = TEXTS.get(record);
  if (known !== undefined) return known;
  const text = JSON.stringify(record);
  TEXTS.set(record, text);
  return text;
}

/** Whether two records hold the same values: one record, or two that write alike. */
export function sameRecord(one: object | undefined, other: object | undefined): boolean {
  if (one === other) return true;
  return one !== undefined && other !== undefined && textOf(one) === textOf(other);
}

/** Whether two lists hold records of the same values, in the same order. */
export function sameRecords(
  one: readonly (object | undefined)[],
  other: readonly (object | undefined)[],
): boolean {
  return (
    one.length === other.length && one.every((record, index) => sameRecord(record, other[index]))
  );
}
