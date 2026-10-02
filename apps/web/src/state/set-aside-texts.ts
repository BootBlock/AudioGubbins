/**
 * The lists of text set aside because it could not be read: how one is
 * stored, how a text is added to it, and the bound that keeps it from taking
 * the room every other write needs.
 *
 * Apart from `state-storage.ts`, which reads and writes the lists for every
 * store, because a list is a format of its own with a rule of its own: a text
 * is added, never written over another, and the oldest go once the list would
 * pass its bound. Without the bound, each distinct damaged text would add to
 * the list at every start, until the room the lists took withheld every write.
 */

/**
 * The most a list may take, in the UTF-16 code units a browser counts its
 * storage in, the brackets and commas of the list included: a tenth of the
 * smallest quota a browser gives a site, about five million, so the three
 * stores' lists together leave over two thirds of it to what the user saves.
 *
 * A text larger than this alone is still set aside, with every older text
 * dropped: kept out, it would be left where it was found, and the store's
 * writes withheld until the user discarded it.
 */
const LONGEST_LIST = 500_000;

/**
 * The texts set aside under a key, as `StateStorage.keepAside` stores them.
 *
 * A list of strings. Anything else found there is kept as one text, so a key
 * damaged in its turn loses nothing to the next text added.
 */
export function textsSetAside(stored: string | null): readonly string[] {
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((one) => typeof one === 'string')) return parsed;
  } catch {
    // Not a list this code wrote, so it is kept whole as one text.
  }
  return [stored];
}

/**
 * How many of the oldest texts to drop so that the list, with `text` added,
 * is within {@link LONGEST_LIST}: none where it is already, and every one
 * where `text` alone passes it.
 *
 * Measured as the list is written, each text as JSON with a comma between, so
 * no list is written to be measured.
 */
function oldestToDrop(texts: readonly string[], text: string): number {
  const sizes = [...texts, text].map((one) => JSON.stringify(one).length);
  let size = sizes.reduce((sum, one) => sum + one + 1, 1);
  let dropped = 0;
  for (const oldest of sizes.slice(0, -1)) {
    if (size <= LONGEST_LIST) break;
    size -= oldest + 1;
    dropped += 1;
  }
  return dropped;
}

/**
 * The list to write under a key holding `before` so that `text` is added to
 * it, and how many of the oldest texts it drops to stay within its bound, or
 * `undefined` where `text` is among them already: text still damaged at the
 * next start is set aside once.
 */
export function withTextAdded(
  before: readonly string[],
  text: string,
): { readonly list: string; readonly dropped: number } | undefined {
  if (before.includes(text)) return undefined;
  const dropped = oldestToDrop(before, text);
  return { list: JSON.stringify([...before.slice(dropped), text]), dropped };
}
