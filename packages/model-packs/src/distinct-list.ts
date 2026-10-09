/**
 * A list in a document whose items are each different, as the readers of a
 * manifest and a catalogue hold the lists they read: a repeated item is refused
 * where it stands, rather than read twice or the second taken.
 */

import { listConverter, pathOf, type Converter, type Reading } from '@audiogubbins/project-format';

/**
 * Refuses each item of a list read whole whose key another item before it has,
 * and answers whether there were none.
 */
function refuseRepeats<TItem>(
  reading: Reading,
  items: readonly TItem[],
  at: string,
  keyOf: (item: TItem) => string,
  summary: string,
): boolean {
  const seen = new Set<string>();
  let unique = true;
  for (const [index, item] of items.entries()) {
    const itemKey = keyOf(item);
    if (seen.has(itemKey)) {
      reading.refuse('model-pack.repeated', summary, pathOf(at, index));
      unique = false;
    }
    seen.add(itemKey);
  }
  return unique;
}

/**
 * A list that must hold one item at least, every item different: `repeat` says
 * why a repeat is refused.
 */
export function distinctList<TItem>(
  most: number,
  item: Converter<TItem>,
  keyOf: (item: TItem) => string,
  repeat: string,
  least = 1,
): Converter<readonly TItem[]> {
  const list = listConverter(most, item);
  return (reading, value, parent, key) => {
    const items = list(reading, value, parent, key);
    if (items === undefined) return undefined;
    const at = pathOf(parent, key);
    if (items.length < least) {
      reading.refuse(
        'model-pack.list-empty',
        `This list holds ${String(least)} item at least.`,
        at,
      );
      return undefined;
    }
    return refuseRepeats(reading, items, at, keyOf, repeat) ? items : undefined;
  };
}
