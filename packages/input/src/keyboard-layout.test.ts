import { describe, expect, it, vi } from 'vitest';

import { keyPress } from './keyboard.js';
import {
  UNKNOWN_LAYOUT,
  browserPressOf,
  commandLayerKeys,
  commandLayerOf,
  couldBeTyped,
  keyNameOn,
  keyboardLayout,
  placeFor,
  typedCharacterOf,
  withLearned,
} from './keyboard-layout.js';
import { keyEventOf } from './testing/key-events.js';

/**
 * A layout is what a key types, and a browser takes its own shortcuts by that.
 * Read from a key's position alone, every keyboard would be a US one.
 */

/** Part of US Dvorak: the keys the cases below press. */
const DVORAK = keyboardLayout([
  ['KeyK', 't'],
  ['KeyV', 'k'],
  ['Comma', 'w'],
  ['KeyW', ','],
]);

/** Part of a Russian layout, which types no Latin letter. */
const RUSSIAN = keyboardLayout([
  ['KeyK', 'л'],
  ['Comma', 'б'],
]);

describe('the key a browser matches a press on', () => {
  it('is the US key that types what the pressed key types', () => {
    expect(browserPressOf(keyPress('KeyK'), DVORAK).key).toBe('KeyT');
    expect(browserPressOf(keyPress('Comma'), DVORAK).key).toBe('KeyW');
    expect(browserPressOf(keyPress('KeyV'), DVORAK).key).toBe('KeyK');
  });

  it('is the pressed key while the layout is not known, or types no US character', () => {
    expect(browserPressOf(keyPress('KeyK'), UNKNOWN_LAYOUT).key).toBe('KeyK');
    expect(browserPressOf(keyPress('KeyK'), RUSSIAN).key).toBe('KeyK');
  });
});

describe('the key a character is pressed on', () => {
  it('is the key known to type it', () => {
    expect(placeFor('k', DVORAK, 'a modifier').key).toBe('KeyV');
    expect(placeFor(',', DVORAK, 'a modifier').key).toBe('KeyW');
  });

  it('is its US key while nothing says otherwise, or where the layout types no US character', () => {
    expect(placeFor('k', UNKNOWN_LAYOUT, 'a modifier').key).toBe('KeyK');
    expect(placeFor('k', RUSSIAN, 'a modifier').key).toBe('KeyK');
    expect(placeFor(',', RUSSIAN, 'a modifier').key).toBe('Comma');
  });

  it('is unknown while its US key types another US character and its own key is not learned', () => {
    // The US key would be another shortcut, perhaps one the browser takes.
    const partly = keyboardLayout([['KeyK', 't']]);
    expect(placeFor('k', partly, 'a modifier').key).toBeUndefined();
  });
});

describe('a layout read as a whole', () => {
  it('reads every letter key at its position on a layout that types no Latin letter', () => {
    // A Hebrew letter key that types a quote mark was read as the quote mark's
    // US key, and Ctrl on it escaped the rule for Ctrl+W.
    const hebrew = keyboardLayout([
      ['KeyA', 'ש'],
      ['KeyW', "'"],
      ['KeyQ', '/'],
    ]);
    expect(hebrew.latin).toBe(false);
    expect(browserPressOf(keyPress('KeyW'), hebrew).key).toBe('KeyW');
    expect(browserPressOf(keyPress('KeyQ'), hebrew).key).toBe('KeyQ');
  });

  it('reads a digit key as its digit on every layout, and places no modified default there', () => {
    // The French digit row types punctuation, and a browser reads Ctrl on it as
    // Ctrl and the digit.
    const azerty = keyboardLayout([
      ['Digit4', "'"],
      ['Digit6', '-'],
      ['Minus', ')'],
    ]);
    expect(browserPressOf(keyPress('Digit4'), azerty).key).toBe('Digit4');
    expect(placeFor('-', azerty, 'nothing').key).toBe('Digit6');
    expect(placeFor('-', azerty, 'a modifier').key).toBeUndefined();
  });

  it('takes the key learned last for a character, and forgets the one before', () => {
    // Learned before a switch of layout, the first key still named it.
    const switched = keyboardLayout([
      ['KeyA', 'a'],
      ['KeyQ', 'a'],
    ]);
    expect(switched.keyTyping('a')).toBe('KeyQ');
    expect(switched.characterAt('KeyA')).toBeUndefined();

    // And a key learned again types what it was learned to type last.
    const relearned = keyboardLayout([
      ['KeyA', 'q'],
      ['KeyA', 'a'],
    ]);
    expect(relearned.keyTyping('a')).toBe('KeyA');
    expect(relearned.keyTyping('q')).toBeUndefined();
  });
});

describe('what a key is called', () => {
  it('is the character the layout types on it, while that is known', () => {
    expect(keyNameOn(keyPress('KeyV'), DVORAK)).toBe('K');
    expect(keyNameOn(keyPress('KeyQ'), DVORAK)).toBeUndefined();
    // Its capital is two letters no keycap shows.
    expect(keyNameOn(keyPress('Minus'), keyboardLayout([['Minus', 'ß']]))).toBe('ß');
  });
});

describe('what a key event teaches the layout', () => {
  it('is the character typed with no modifier at all', () => {
    expect(typedCharacterOf(keyEventOf('KeyK', 't'))).toEqual(['KeyK', 't']);
    expect(typedCharacterOf(keyEventOf('KeyK', 'T'))).toEqual(['KeyK', 't']);
  });

  it('is nothing from a press with Control or Command, which some layouts type another layout with', () => {
    // On "Dvorak – QWERTY ⌘" Command types the QWERTY character: learned from
    // it, a key was learned again at every press, and the defaults moved.
    expect(typedCharacterOf(keyEventOf('KeyK', 'k', { metaKey: true }))).toBeUndefined();
    expect(typedCharacterOf(keyEventOf('Comma', 'w', { ctrlKey: true }))).toBeUndefined();
  });

  it('is nothing when a modifier changed what the key types, or the key is not a character', () => {
    expect(typedCharacterOf(keyEventOf('Digit1', '!', { shiftKey: true }))).toBeUndefined();
    expect(typedCharacterOf(keyEventOf('KeyE', '€', { altGraph: true }))).toBeUndefined();
    expect(typedCharacterOf(keyEventOf('KeyE', '´', { altKey: true }))).toBeUndefined();
    expect(typedCharacterOf(keyEventOf('BracketLeft', 'Dead'))).toBeUndefined();
    expect(typedCharacterOf(keyEventOf('Space', ' '))).toBeUndefined();
    expect(typedCharacterOf(keyEventOf('KeyA', 'a', { composing: true }))).toBeUndefined();
  });

  it('is nothing from the numeric keypad, whose keys type the same on every layout', () => {
    // Learned, its minus would become the key the default for `-` goes on.
    expect(typedCharacterOf(keyEventOf('NumpadSubtract', '-'))).toBeUndefined();
  });
});

describe('a Latin layout that types letters outside ASCII', () => {
  /** Part of Turkish F, which moves the letters and types Latin letters ASCII has not. */
  const TURKISH_F = keyboardLayout([
    ['KeyJ', 'k'],
    ['KeyK', 'm'],
    ['KeyI', 'ı'],
    ['KeyD', 'ğ'],
    ['KeyH', 't'],
    ['Semicolon', 'ş'],
  ]);

  it('is read as Latin, so its keys are matched by what they type', () => {
    // Read as `[a-z]`, a letter key typing `ı`, `ğ` or `ş` made the whole
    // layout a non-Latin one: every chord default then waited for ever for a
    // key the user had already typed, and the reservations sat elsewhere.
    expect(TURKISH_F.latin).toBe(true);
    expect(placeFor('k', TURKISH_F, 'a modifier').key).toBe('KeyJ');
    expect(browserPressOf(keyPress('KeyH'), TURKISH_F).key).toBe('KeyT');
  });

  it('is read as non-Latin once a letter key types a letter of another script', () => {
    expect(RUSSIAN.latin).toBe(false);
  });
});

describe('the key a character is pressed on, where none is known', () => {
  /** Part of a Hebrew layout: its letter keys type punctuation a US layout has. */
  const HEBREW = keyboardLayout([
    ['KeyK', 'ל'],
    ['KeyW', "'"],
    ['KeyQ', '/'],
  ]);

  it('is the US key wherever a browser reads that key at its position', () => {
    // `KeyW` types an apostrophe here, which a US layout types elsewhere, so
    // the answer was nothing although a browser matches Ctrl+W at `KeyW`.
    expect(HEBREW.latin).toBe(false);
    expect(placeFor('w', HEBREW, 'nothing').key).toBe('KeyW');
    expect(placeFor('q', HEBREW, 'nothing').key).toBe('KeyQ');
  });

  it('is the digit key for a digit on a layout whose digit row types punctuation', () => {
    const azerty = keyboardLayout([
      ['Digit4', "'"],
      ['Digit6', '-'],
    ]);

    expect(placeFor('4', azerty, 'nothing').key).toBe('Digit4');
  });
});

describe('the learning rule', () => {
  it('has one home, which answers with the list it was given when nothing changed', () => {
    const learned = withLearned([], 'KeyV', 'K');
    expect(learned).toEqual([['KeyV', 'k']]);
    expect(withLearned(learned, 'KeyV', 'k')).toBe(learned);
  });

  it('gives a character to the key learned last for it, and takes it off the key before', () => {
    const moved = withLearned(withLearned([], 'KeyV', 'k'), 'KeyB', 'k');
    expect(keyboardLayout(moved).keyTyping('k')).toBe('KeyB');
    expect(keyboardLayout(moved).characterAt('KeyV')).toBeUndefined();
  });

  it('learns nothing from a press made with Caps Lock on', () => {
    // Caps Lock changes what a letter key types as Shift does, and the capital
    // is lower-cased again: on Turkish Q a capital `I` was learned as `i` on
    // the key that types `ı`, which moved `i` off its own key.
    expect(typedCharacterOf(keyEventOf('KeyI', 'I', { capsLock: true }))).toBeUndefined();
    expect(typedCharacterOf(keyEventOf('KeyI', 'ı'))).toEqual(['KeyI', 'ı']);
  });

  it('takes a key of the writing block typing one character, and nothing else', () => {
    expect(couldBeTyped('KeyV', 'k')).toBe(true);
    expect(couldBeTyped('NumpadSubtract', '-')).toBe(false);
    expect(couldBeTyped('KeyV', 'kk')).toBe(false);
    expect(couldBeTyped('KeyV', ' ')).toBe(false);
  });
});

describe('naming a character where the browser cannot split graphemes', () => {
  it('names it by its code points, so the module loads without a segmenter', async () => {
    // Built at module scope, the segmenter threw while the module loaded on a
    // browser without it and the shell never started. Firefox shipped it in
    // 125, inside the floor the build declares. The module is loaded afresh
    // after the segmenter is gone: loaded before, it would have built one
    // already.
    const segmenter = Intl.Segmenter;
    try {
      Reflect.deleteProperty(Intl, 'Segmenter');
      vi.resetModules();
      const loaded = await import('./keyboard-layout.js');
      expect(loaded.characterName('a')).toBe('A');
      expect(loaded.characterName('ß')).toBe('ß');
    } finally {
      Object.defineProperty(Intl, 'Segmenter', {
        value: segmenter,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe('a layout that types another layout while Command is held', () => {
  // "Dvorak – QWERTY ⌘" types Dvorak, and QWERTY while Command is held.
  const KEYS: readonly (readonly [string, string])[] = [
    ['KeyK', 't'],
    ['KeyV', 'k'],
    ['Comma', 'w'],
    ['KeyW', ','],
    // Dvorak keeps `a` where a US layout has it, so this key types `a` under
    // either reading and can tell them apart in neither.
    ['KeyA', 'a'],
  ];
  const SWITCHING = keyboardLayout(KEYS, { commandByPosition: true });
  const DOES_NOT_SWITCH = keyboardLayout(KEYS, { commandByPosition: false });
  const UNREAD = keyboardLayout(KEYS);

  it('is told by a Command press that types another letter than the layout does', () => {
    expect(commandLayerOf(keyEventOf('KeyV', 'v', { metaKey: true }), DVORAK)).toBe(
      'another layout',
    );
    expect(commandLayerOf(keyEventOf('KeyV', 'k', { metaKey: true }), DVORAK)).toBe('the same');
    // Nothing to compare it with, or not Command alone.
    expect(commandLayerOf(keyEventOf('KeyQ', 'q', { metaKey: true }), DVORAK)).toBeUndefined();
    expect(
      commandLayerOf(keyEventOf('KeyV', 'V', { metaKey: true, shiftKey: true }), DVORAK),
    ).toBeUndefined();
    expect(commandLayerOf(keyEventOf('KeyV', 'v', { ctrlKey: true }), DVORAK)).toBeUndefined();
    expect(commandLayerOf(keyEventOf('KeyV', 'v'), DVORAK)).toBeUndefined();
    // Nor with Caps Lock on, which changes the character as Shift does.
    expect(
      commandLayerOf(keyEventOf('KeyV', 'V', { metaKey: true, capsLock: true }), DVORAK),
    ).toBeUndefined();
  });

  it('places a character pressed with Command on its US key', () => {
    // Read by the Dvorak characters, the chord prefix sat on the key the
    // system reads as Command+V, and swallowed every paste.
    expect(placeFor('k', SWITCHING, 'command').key).toBe('KeyK');
    expect(placeFor(',', SWITCHING, 'command').key).toBe('Comma');
    expect(placeFor('k', SWITCHING, 'a modifier').key).toBe('KeyV');
    expect(placeFor('k', SWITCHING, 'nothing').key).toBe('KeyV');
    expect(placeFor('k', DOES_NOT_SWITCH, 'command').key).toBe('KeyV');
  });

  it('gives a character pressed with Command no place while neither reading is settled', () => {
    // Placed where the layout types the character, a switching layout took the
    // paste; placed at the US key, a layout that does not switch put the
    // settings on the key macOS reads as Command+Shift+W and closes the window
    // with. Neither is right until a press says which.
    expect(placeFor('k', UNREAD, 'command').waitsFor).toBe('the Command layer');
    expect(placeFor('k', UNREAD, 'command').key).toBeUndefined();
    expect(placeFor(',', UNREAD, 'command').key).toBeUndefined();
    expect(keyNameOn(keyPress('KeyV', { meta: true }), UNREAD)).toBeUndefined();

    // A key both layers type alike, a character no key is known for, and a
    // character no US layout types without Shift, each have one answer under
    // both readings.
    expect(placeFor('a', UNREAD, 'command').waitsFor).toBeUndefined();
    expect(
      placeFor('+', keyboardLayout([['BracketRight', '+']]), 'command').waitsFor,
    ).toBeUndefined();
    expect(placeFor('a', UNREAD, 'command').key).toBe('KeyA');
    expect(placeFor('p', UNREAD, 'command').key).toBe('KeyP');
    expect(placeFor('k', UNREAD, 'a modifier').key).toBe('KeyV');
  });

  it('is told nothing by a Command press on a key both layers type alike', () => {
    // Command+A types `a` whichever layer the system reads, so it shows
    // nothing. Read as proof that the layout does not switch, it undid the
    // reading at the commonest Mac shortcut there is.
    expect(commandLayerOf(keyEventOf('KeyA', 'a', { metaKey: true }), SWITCHING)).toBeUndefined();
    expect(
      commandLayerOf(keyEventOf('KeyA', 'a', { metaKey: true }), DOES_NOT_SWITCH),
    ).toBeUndefined();
    expect(commandLayerOf(keyEventOf('KeyV', 'v', { metaKey: true }), SWITCHING)).toBe(
      'another layout',
    );
  });

  it('reads a Command press at its position, and names its key by that', () => {
    const command = keyPress('KeyV', { meta: true });
    expect(browserPressOf(command, SWITCHING)).toEqual(command);
    expect(browserPressOf(keyPress('KeyV', { control: true }), SWITCHING).key).toBe('KeyK');
    expect(keyNameOn(command, SWITCHING)).toBeUndefined();
    expect(keyNameOn(keyPress('KeyV'), SWITCHING)).toBe('K');
  });
});

describe('the keys a Command press shows the layer by', () => {
  /**
   * One key of four a press can be read from, and one of each kind that
   * cannot, each typing a character that sorts before the answer: whichever
   * condition were dropped, the wrong key would be answered.
   */
  const LAYOUT = keyboardLayout([
    // A letter on a key that is not a letter key. Dvorak types `s` on the
    // semicolon key, and no reading is taken from a press of it.
    ['Semicolon', 'a'],
    // A key that types no letter. The settings default is written as a comma,
    // and a reader asked for the key that types one pressed it and learned
    // nothing.
    ['KeyW', ','],
    // A letter where a US layout types it. Both layers type it alike, so it
    // tells them apart in neither.
    ['KeyB', 'b'],
    ['KeyN', 'z'],
  ]);

  it('is each letter key typing a letter that a US layout types somewhere else', () => {
    // Asked of the layout rather than of the shortcuts that wait: one press
    // settles the reading for every one of them at once, and a shortcut's own
    // character need not sit on a key that can make one.
    expect(commandLayerKeys(LAYOUT)).toEqual([['KeyN', 'z']]);

    // The press the answer asks for, read both ways: what the key event
    // carries is the layout's own character where the system reads no other
    // layer, and the US letter where it reads one.
    expect(commandLayerOf(keyEventOf('KeyN', 'z', { metaKey: true }), LAYOUT)).toBe('the same');
    expect(commandLayerOf(keyEventOf('KeyN', 'n', { metaKey: true }), LAYOUT)).toBe(
      'another layout',
    );
  });

  it('is none while the layout has shown no such key', () => {
    // A browser that offers no layout map knows nothing of a key until the
    // user has typed it plainly, and a layout that moves its punctuation alone
    // never shows one. No press settles the reading, and the settings say so
    // rather than name a key.
    expect(commandLayerKeys(UNKNOWN_LAYOUT)).toEqual([]);
    expect(
      commandLayerKeys(
        keyboardLayout([
          ['KeyW', ','],
          ['Comma', 'w'],
        ]),
      ),
    ).toEqual([]);
  });

  it('answers all of them, in the characters they type, so a caller can pass one over', () => {
    // Whether a press arrives at the page at all is the platform's answer, not
    // the layout's: the first key a layout offers may be one the browser or
    // the system takes before the page sees it, and a caller that knows the
    // conventions in force needs the rest to choose from. Answered as one key,
    // the settings asked an AZERTY reader for Command and the key that types
    // "a", which is where a US keyboard has Q, and macOS quits the browser
    // with that press.
    const moved = keyboardLayout([
      ['KeyA', 'q'],
      ['KeyQ', 'a'],
      ['KeyW', 'z'],
      ['KeyZ', 'w'],
    ]);

    expect(commandLayerKeys(moved)).toEqual([
      ['KeyQ', 'a'],
      ['KeyA', 'q'],
      ['KeyZ', 'w'],
      ['KeyW', 'z'],
    ]);
  });
});

describe('a key that types a character a US layout types with Shift', () => {
  it('is read as the US key that types it, with Shift', () => {
    // German, Spanish and Italian type `+` on a key of its own, and Control on
    // it zooms the page.
    const german = keyboardLayout([['BracketRight', '+']]);
    expect(browserPressOf(keyPress('BracketRight', { control: true }), german)).toEqual(
      keyPress('Equal', { control: true, shift: true }),
    );
  });
});
