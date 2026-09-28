import { describe, expect, it } from 'vitest';

import { highlightAfter, type ListPress } from './palette-navigation.js';

/** A press with no modifier unless one is given. */
function press(key: string, modifiers: Partial<ListPress> = {}): ListPress {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers };
}

describe('the palette highlight', () => {
  it('moves with the arrows and wraps at either end', () => {
    expect(highlightAfter(press('ArrowDown'), 0, 3)).toBe(1);
    expect(highlightAfter(press('ArrowDown'), 2, 3)).toBe(0);
    expect(highlightAfter(press('ArrowUp'), 0, 3)).toBe(2);
  });

  it('reaches the ends with Control or Command and Home or End', () => {
    expect(highlightAfter(press('End', { ctrlKey: true }), 0, 5)).toBe(4);
    expect(highlightAfter(press('Home', { metaKey: true }), 4, 5)).toBe(0);
  });

  it('leaves Home and End to the search field, alone and with Shift', () => {
    // Alone they move the caret, and with Shift they select to the start or
    // the end of what was typed: the list took both.
    expect(highlightAfter(press('Home'), 3, 5)).toBeUndefined();
    expect(highlightAfter(press('End'), 3, 5)).toBeUndefined();
    expect(highlightAfter(press('End', { ctrlKey: true, shiftKey: true }), 0, 5)).toBeUndefined();
    expect(highlightAfter(press('Home', { metaKey: true, shiftKey: true }), 4, 5)).toBeUndefined();
  });

  it('has no end to reach in an empty list, and leaves every other key alone', () => {
    expect(highlightAfter(press('End', { ctrlKey: true }), 0, 0)).toBeUndefined();
    expect(highlightAfter(press('ArrowDown'), 0, 0)).toBe(0);
    expect(highlightAfter(press('a'), 0, 5)).toBeUndefined();
    expect(highlightAfter(press('Enter'), 0, 5)).toBeUndefined();
  });
});
