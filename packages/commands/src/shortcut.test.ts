import { describe, expect, it } from 'vitest';

import { keyPress, keyboardLayout, UNKNOWN_LAYOUT } from '@audiogubbins/input';

import { commandId } from './command.js';
import {
  KeyboardConvention,
  bindingsFor,
  commandForShortcut,
  describeShortcut,
  findShortcutConflicts,
  isShortcutPrefix,
  keyboardPlatformFor,
  shortcut,
  shortcutKey,
  shortcutsMatch,
  type ShortcutProfile,
} from './shortcut.js';

const save = commandId('file.save');
const open = commandId('file.open');
const palette = commandId('view.command-palette');

function profile(bindings: ShortcutProfile['bindings'], builtIn = false): ShortcutProfile {
  return { id: 'test', displayName: 'Test profile', builtIn, bindings };
}

describe('shortcutsMatch', () => {
  it('matches identical chords', () => {
    const chord = shortcut(
      keyPress('KeyK', { control: true }),
      keyPress('KeyT', { control: true }),
    );
    expect(shortcutsMatch(chord, chord)).toBe(true);
  });

  it('does not match a chord against its own prefix', () => {
    const prefix = shortcut(keyPress('KeyK', { control: true }));
    const chord = shortcut(
      keyPress('KeyK', { control: true }),
      keyPress('KeyT', { control: true }),
    );
    expect(shortcutsMatch(prefix, chord)).toBe(false);
  });

  it('does not match the same presses in a different order', () => {
    const forwards = shortcut(keyPress('KeyK'), keyPress('KeyT'));
    const backwards = shortcut(keyPress('KeyT'), keyPress('KeyK'));
    expect(shortcutsMatch(forwards, backwards)).toBe(false);
  });
});

describe('shortcutKey', () => {
  it('gives equal shortcuts equal keys', () => {
    // However the press was built: one read from a file, or spread from
    // another, can hold its fields in another order.
    const built = shortcut(keyPress('KeyS', { control: true, shift: true }));
    const written = shortcut({ meta: false, alt: false, shift: true, control: true, key: 'KeyS' });
    expect(shortcutKey(written)).toBe(shortcutKey(built));
  });

  it('gives different shortcuts different keys', () => {
    expect(shortcutKey(shortcut(keyPress('KeyS', { control: true })))).not.toBe(
      shortcutKey(shortcut(keyPress('KeyS', { meta: true }))),
    );
  });
});

describe('describeShortcut', () => {
  it('sets a key apart from the separator where they are the same character', () => {
    // German, Spanish, Italian and the Nordic layouts type `+` on a key of its
    // own, and Windows and Linux join presses with `+`: the binding read
    // `Ctrl++`, which is correct and reads as a typo.
    const plusKey = keyboardLayout([['BracketRight', '+']]);
    const pressed = shortcut(keyPress('BracketRight', { control: true }));

    expect(describeShortcut(pressed, KeyboardConvention.Windows, plusKey)).toBe('Ctrl+[+]');
    expect(describeShortcut(pressed, KeyboardConvention.Linux, plusKey)).toBe('Ctrl+[+]');
    // Apple joins nothing, so there is nothing to tell apart.
    expect(
      describeShortcut(
        shortcut(keyPress('BracketRight', { meta: true })),
        KeyboardConvention.Apple,
        plusKey,
      ),
    ).toBe('\u2318+');
    // Every other key is written as it was.
    expect(
      describeShortcut(
        shortcut(keyPress('KeyS', { control: true })),
        KeyboardConvention.Windows,
        plusKey,
      ),
    ).toBe('Ctrl+S');
  });

  it('spells the modifiers out on Windows', () => {
    expect(
      describeShortcut(
        shortcut(keyPress('KeyS', { control: true, shift: true })),
        KeyboardConvention.Windows,
        UNKNOWN_LAYOUT,
      ),
    ).toBe('Ctrl+Shift+S');
  });

  it('uses the Apple symbols in Apple order, with no separator', () => {
    expect(
      describeShortcut(
        shortcut(keyPress('KeyS', { meta: true, shift: true })),
        KeyboardConvention.Apple,
        UNKNOWN_LAYOUT,
      ),
    ).toBe('⇧⌘S');
    expect(
      describeShortcut(
        shortcut(keyPress('KeyS', { control: true, alt: true, shift: true, meta: true })),
        KeyboardConvention.Apple,
        UNKNOWN_LAYOUT,
      ),
    ).toBe('⌃⌥⇧⌘S');
  });

  it('writes the Windows key as Super on Linux', () => {
    expect(
      describeShortcut(
        shortcut(keyPress('KeyS', { meta: true })),
        KeyboardConvention.Linux,
        UNKNOWN_LAYOUT,
      ),
    ).toBe('Super+S');
  });

  it('separates the presses of a chord with a comma', () => {
    const chord = shortcut(
      keyPress('KeyK', { control: true }),
      keyPress('KeyT', { control: true }),
    );
    expect(describeShortcut(chord, KeyboardConvention.Windows, UNKNOWN_LAYOUT)).toBe(
      'Ctrl+K, Ctrl+T',
    );
  });

  it('gives an arrow key its direction in words, not a glyph', () => {
    // A written shortcut is drawn as plain text inside a menu entry, so it is
    // part of the entry's accessible name. Whether a screen reader speaks an
    // arrow glyph depends on its symbol verbosity and its locale dictionary,
    // and several say nothing at the default: the entry stopped at "Ctrl+K,
    // Ctrl+". Every other non-letter key here is already a word.
    expect(
      describeShortcut(shortcut(keyPress('ArrowLeft')), KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    ).toBe('Left');
    expect(
      describeShortcut(shortcut(keyPress('ArrowUp')), KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    ).toBe('Up');
  });

  it('gives a digit key its digit', () => {
    expect(
      describeShortcut(shortcut(keyPress('Digit1')), KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    ).toBe('1');
  });

  it('names a punctuation key by its character', () => {
    expect(
      describeShortcut(
        shortcut(keyPress('Comma', { control: true })),
        KeyboardConvention.Windows,
        UNKNOWN_LAYOUT,
      ),
    ).toBe('Ctrl+,');
  });

  it('shortens Escape and Delete the way keyboards label them', () => {
    expect(
      describeShortcut(shortcut(keyPress('Escape')), KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    ).toBe('Esc');
    expect(
      describeShortcut(shortcut(keyPress('Delete')), KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    ).toBe('Del');
  });
});

describe('keyboardPlatformFor', () => {
  it('reads AltGr as typing everywhere but on Apple hardware, where Option makes shortcuts', () => {
    expect(keyboardPlatformFor(KeyboardConvention.Windows).altGraphIsTyping).toBe(true);
    expect(keyboardPlatformFor(KeyboardConvention.Linux).altGraphIsTyping).toBe(true);
    expect(keyboardPlatformFor(KeyboardConvention.Apple).altGraphIsTyping).toBe(false);
  });
});

describe('findShortcutConflicts', () => {
  it('finds none in a profile where every shortcut is distinct', () => {
    const clean = profile([
      { commandId: save, shortcut: shortcut(keyPress('KeyS', { control: true })) },
      { commandId: open, shortcut: shortcut(keyPress('KeyO', { control: true })) },
    ]);
    expect(findShortcutConflicts(clean)).toEqual([]);
  });

  it('finds two commands bound to the same shortcut', () => {
    const clashing = profile([
      { commandId: save, shortcut: shortcut(keyPress('KeyS', { control: true })) },
      { commandId: open, shortcut: shortcut(keyPress('KeyS', { control: true })) },
    ]);

    const conflicts = findShortcutConflicts(clashing);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.commandIds).toEqual([save, open]);
  });

  it('finds a shorter binding that makes a chord unreachable', () => {
    const shadowed = profile([
      { commandId: palette, shortcut: shortcut(keyPress('KeyK', { control: true })) },
      {
        commandId: save,
        shortcut: shortcut(
          keyPress('KeyK', { control: true }),
          keyPress('KeyS', { control: true }),
        ),
      },
    ]);

    const conflicts = findShortcutConflicts(shadowed);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.commandIds).toEqual([palette, save]);
  });

  it('allows one command to have several shortcuts', () => {
    const alternatives = profile([
      { commandId: save, shortcut: shortcut(keyPress('KeyS', { control: true })) },
      { commandId: save, shortcut: shortcut(keyPress('F2')) },
    ]);
    expect(findShortcutConflicts(alternatives)).toEqual([]);
  });

  it('allows two chords that share a prefix', () => {
    const chords = profile([
      {
        commandId: save,
        shortcut: shortcut(
          keyPress('KeyK', { control: true }),
          keyPress('KeyS', { control: true }),
        ),
      },
      {
        commandId: open,
        shortcut: shortcut(
          keyPress('KeyK', { control: true }),
          keyPress('KeyO', { control: true }),
        ),
      },
    ]);
    expect(findShortcutConflicts(chords)).toEqual([]);
  });
});

describe('binding lookup', () => {
  const bound = profile([
    { commandId: save, shortcut: shortcut(keyPress('KeyS', { control: true })) },
    { commandId: save, shortcut: shortcut(keyPress('F2')) },
  ]);

  it('lists every shortcut a command responds to', () => {
    expect(bindingsFor(bound, save)).toHaveLength(2);
  });

  it('lists nothing for an unbound command', () => {
    expect(bindingsFor(bound, open)).toEqual([]);
  });

  it('finds the command a completed shortcut runs', () => {
    expect(commandForShortcut(bound, shortcut(keyPress('KeyS', { control: true })))).toBe(save);
  });

  it('finds nothing for a shortcut nobody bound', () => {
    expect(
      commandForShortcut(bound, shortcut(keyPress('KeyZ', { control: true }))),
    ).toBeUndefined();
  });
});

describe('isShortcutPrefix', () => {
  const withChord = profile([
    {
      commandId: save,
      shortcut: shortcut(keyPress('KeyK', { control: true }), keyPress('KeyS', { control: true })),
    },
    { commandId: open, shortcut: shortcut(keyPress('KeyO', { control: true })) },
  ]);

  it('waits for another press when a chord could still complete', () => {
    expect(isShortcutPrefix(withChord, [keyPress('KeyK', { control: true })])).toBe(true);
  });

  it('does not wait when no chord starts that way', () => {
    expect(isShortcutPrefix(withChord, [keyPress('KeyJ', { control: true })])).toBe(false);
  });

  it('does not wait once the chord is complete', () => {
    expect(
      isShortcutPrefix(withChord, [
        keyPress('KeyK', { control: true }),
        keyPress('KeyS', { control: true }),
      ]),
    ).toBe(false);
  });
});
