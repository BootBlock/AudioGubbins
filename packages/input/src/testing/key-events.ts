/**
 * Key events as the input model reads them, for a test that presses a key.
 *
 * One helper rather than a copy in each test that needs one, because the shape
 * is the input model's: written out in each, a field added to `KeyEventReading`
 * would have to be added to every copy, and a copy that spelled one of them
 * differently would read as a press nothing was held on. Here rather than
 * beside the tests of any one package, because the copies that would break
 * first if a field were added are this package's own.
 */

import type { KeyEventReading } from '../keyboard.js';

/**
 * A key event on `code` typing `key`, with nothing held but what `held` says.
 *
 * The character is what the key event carries, which is what the layout is
 * learned from: on a layout that types another layout while Command is held,
 * a press carries one character and the layout types another.
 */
export function keyEventOf(
  code: string,
  key: string,
  held: Partial<KeyEventReading> = {},
): KeyEventReading {
  return {
    code,
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    altGraph: false,
    composing: false,
    capsLock: false,
    ...held,
  };
}
