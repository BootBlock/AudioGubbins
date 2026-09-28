/**
 * The browser's keyboard layout map, where it gives one.
 *
 * Chromium's Keyboard Map API says what each key of the writing block types on
 * the user's layout, so the layout is known before the user presses anything.
 * Firefox and Safari do not have it, and there the layout is learned from the
 * keys the user presses. Read through `Reflect`, because the API is absent from
 * the DOM type definitions, and every value it hands back is checked rather
 * than trusted. Here, beside every other question put to the browser, rather
 * than in the application: a probe outside this package would be one the rule
 * that keeps detection in one home could not see.
 */

/** Each key a layout map names, with the character it types. */
export type LayoutMapPairs = readonly (readonly [string, string])[];

/**
 * The browser's request for its layout map, bound to its keyboard, or
 * `undefined` where it has none.
 *
 * The one probe for the map. Whether the browser offers one and what it says
 * are the same question, so the capability's precondition and the reader below
 * both ask it here: written out in each, a change to one would make them
 * disagree about the same browser.
 */
export function layoutMapRequest(navigatorLike: object): (() => unknown) | undefined {
  const keyboard: unknown = Reflect.get(navigatorLike, 'keyboard');
  if (typeof keyboard !== 'object' || keyboard === null) return undefined;
  const getLayoutMap: unknown = Reflect.get(keyboard, 'getLayoutMap');
  if (typeof getLayoutMap !== 'function') return undefined;
  return (): unknown => {
    const answer: unknown = Reflect.apply(getLayoutMap, keyboard, []);
    return answer;
  };
}

/**
 * Each key the layout map names, with the character it types: none where the
 * browser has no map, refuses it, or gives an empty one.
 *
 * Read once by the application, which hands the same answer to the keyboard
 * layout and, as a late answer, to the capability registry: answering by
 * whether the request exists, the registry would report a browser that refused
 * the map as giving one, and the wait it caused would be explained without its
 * cause.
 */
export async function readLayoutMap(navigatorLike: object): Promise<LayoutMapPairs> {
  try {
    const request = layoutMapRequest(navigatorLike);
    if (request === undefined) return [];

    const map: unknown = await request();
    if (typeof map !== 'object' || map === null) return [];
    const entries: unknown = Reflect.get(map, 'entries');
    if (typeof entries !== 'function') return [];

    // Listed by `Array.from`, which lists an iterable and gives an empty list
    // for anything else. Always a list, and asked so only to give it a type.
    const listed: unknown = Reflect.apply(Array.from, Array, [Reflect.apply(entries, map, [])]);
    if (!Array.isArray(listed)) return [];
    const entryList: readonly unknown[] = listed;

    const pairs: (readonly [string, string])[] = [];
    for (const entry of entryList) {
      if (!Array.isArray(entry)) continue;
      const pair: readonly unknown[] = entry;
      const [code, character] = pair;
      if (typeof code === 'string' && typeof character === 'string') pairs.push([code, character]);
    }
    return pairs;
  } catch (error) {
    // Refused outside a top-level page, and by a browser that asks first: the
    // layout is then learned from the keys the user presses. Anything else is
    // a fault, and is not taken for a refusal.
    if (error instanceof DOMException) return [];
    throw error;
  }
}
