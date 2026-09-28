import { describe, expect, it } from 'vitest';

import {
  isShortcutKey,
  isShortcutPress,
  keyPress,
  keyPressFromEvent,
  keyPressesMatch,
  isTypingPress,
  readingOf,
  type KeyEventReading,
  type KeyEventSource,
} from './keyboard.js';
import { keyEventOf } from './testing/key-events.js';

/** A key event reading on the US `a` key, with everything nobody is asking about switched off. */
function reading(overrides: Partial<KeyEventReading> = {}): KeyEventReading {
  return keyEventOf('KeyA', 'a', overrides);
}

describe('keyPress', () => {
  it('releases every modifier by default', () => {
    expect(keyPress('KeyS')).toEqual({
      key: 'KeyS',
      control: false,
      shift: false,
      alt: false,
      meta: false,
    });
  });

  it('treats the same key with different modifiers as different presses', () => {
    const plain = keyPress('KeyS');
    for (const modifier of ['control', 'shift', 'alt', 'meta'] as const) {
      expect(keyPressesMatch(plain, keyPress('KeyS', { [modifier]: true })), modifier).toBe(false);
    }
  });

  it('treats different keys with the same modifiers as different presses', () => {
    expect(
      keyPressesMatch(keyPress('KeyS', { control: true }), keyPress('KeyD', { control: true })),
    ).toBe(false);
  });

  it('treats identical presses as matching', () => {
    expect(
      keyPressesMatch(keyPress('KeyS', { control: true }), keyPress('KeyS', { control: true })),
    ).toBe(true);
  });
});

/** A key event as a browser reports it, with AltGr held or not. */
function event(
  overrides: Partial<Omit<KeyEventSource, 'getModifierState'>>,
  altGraph: boolean,
  capsLock = false,
) {
  return {
    code: 'KeyA',
    key: 'a',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    ...overrides,
    getModifierState: (name: string) =>
      (name === 'AltGraph' && altGraph) || (name === 'CapsLock' && capsLock),
  };
}

const WINDOWS_OR_LINUX = { altGraphIsTyping: true, optionTypesInAField: false };
const APPLE = { altGraphIsTyping: false, optionTypesInAField: true };

describe('readingOf', () => {
  it('reads AltGr through the modifier state, where Control and Alt alone cannot tell it apart', () => {
    // A German user types a backslash with AltGr and Minus, which arrives as
    // Control, Alt and Minus. Reading AltGr as not held turned it back into a
    // shortcut, and every test stayed green.
    const backslash = readingOf(
      event({ code: 'Minus', key: '\\', ctrlKey: true, altKey: true }, true),
      WINDOWS_OR_LINUX,
    );

    expect(backslash.altGraph).toBe(true);
    expect(isShortcutPress(backslash)).toBe(false);
  });

  it('reads Option on Apple hardware as a modifier a shortcut is made with', () => {
    // Some engines report Option as AltGr, and reading that as typing meant
    // an Option shortcut could be neither recorded nor run on a Mac.
    const option = readingOf(event({ code: 'KeyB', key: '∫', altKey: true }, true), APPLE);

    expect(option.altGraph).toBe(false);
    expect(isShortcutPress(option)).toBe(true);
    expect(keyPressFromEvent(option)).toEqual(keyPress('KeyB', { alt: true }));
  });

  it('carries the fields a press is built from, and whether an input method is composing', () => {
    const composing = readingOf(
      event({ code: 'KeyN', key: 'n', shiftKey: true, isComposing: true }, false),
      WINDOWS_OR_LINUX,
    );

    expect(composing).toEqual({
      code: 'KeyN',
      key: 'n',
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      altGraph: false,
      composing: true,
      capsLock: false,
    });
  });

  it('reads Caps Lock through the modifier state, which no flag of the event carries', () => {
    // Guessed from the case of the key and Shift instead, the reading would be
    // wrong where Shift turns a letter back to lower case with Caps Lock on,
    // where a capital arrives with neither held, as an on-screen keyboard or
    // an input method can send one, and on a key that has no case at all.
    const capsLockOf = (
      overrides: Partial<Omit<KeyEventSource, 'getModifierState'>>,
      capsLock: boolean,
    ): boolean => readingOf(event(overrides, false, capsLock), WINDOWS_OR_LINUX).capsLock;

    expect(capsLockOf({ key: 'A' }, true)).toBe(true);
    expect(capsLockOf({ key: 'a', shiftKey: true }, true)).toBe(true);
    expect(capsLockOf({ key: 'A' }, false)).toBe(false);
    expect(capsLockOf({ code: 'Digit1', key: '1' }, true)).toBe(true);
  });
});

describe('isTypingPress', () => {
  it('lets a bare or shifted key through to a field, and keeps a modified one a shortcut', () => {
    expect(isTypingPress(reading({ key: 'a' }), WINDOWS_OR_LINUX)).toBe(true);
    expect(isTypingPress(reading({ key: 'A', shiftKey: true }), WINDOWS_OR_LINUX)).toBe(true);
    expect(isTypingPress(reading({ key: 'k', ctrlKey: true }), WINDOWS_OR_LINUX)).toBe(false);
    expect(isTypingPress(reading({ key: 'k', metaKey: true }), APPLE)).toBe(false);
  });

  it('lets Option type in a field on Apple hardware, and keeps Alt a shortcut elsewhere', () => {
    expect(isTypingPress(reading({ key: '∫', altKey: true }), APPLE)).toBe(true);
    expect(isTypingPress(reading({ key: 'b', altKey: true }), WINDOWS_OR_LINUX)).toBe(false);
  });
});

describe('keyPressFromEvent', () => {
  it('reads the physical key, so a shortcut stays put when the layout changes', () => {
    // On a French layout the key labelled A is where Q is on an English one,
    // and its code is still KeyQ.
    const press = keyPressFromEvent(reading({ code: 'KeyQ', key: 'a', ctrlKey: true }));

    expect(press).toEqual(keyPress('KeyQ', { control: true }));
  });

  it('carries every modifier the event reports', () => {
    const press = keyPressFromEvent(
      reading({ code: 'KeyP', key: 'P', shiftKey: true, altKey: true, metaKey: true }),
    );

    expect(press).toEqual(keyPress('KeyP', { shift: true, alt: true, meta: true }));
  });
});

describe('isShortcutKey', () => {
  it('accepts a key that carries a character or a function', () => {
    for (const key of ['s', 'S', '1', 'Escape', 'F12', 'ArrowLeft']) {
      expect(isShortcutKey(key)).toBe(true);
    }
  });

  it('refuses a modifier, which arrives before the key it modifies', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'OS']) {
      expect(isShortcutKey(key)).toBe(false);
    }
  });

  it('refuses AltGraph and a dead key, which a European layout needs to type at all', () => {
    // Both were missing, so on a French or German layout the key that reaches a
    // bracket, and the first half of an accented character, each abandoned a
    // chord in progress.
    expect(isShortcutKey('AltGraph')).toBe(false);
    expect(isShortcutKey('Dead')).toBe(false);
  });

  it('refuses a key an input method is composing with', () => {
    expect(isShortcutKey('Process')).toBe(false);
    expect(isShortcutKey('Unidentified')).toBe(false);
  });
});

describe('isShortcutPress', () => {
  it('accepts a press a shortcut can be made of', () => {
    expect(isShortcutPress(reading({ code: 'KeyS', key: 's', ctrlKey: true }))).toBe(true);
  });

  it('refuses a key the layout needs to type at all', () => {
    expect(isShortcutPress(reading({ key: 'AltGraph' }))).toBe(false);
    expect(isShortcutPress(reading({ key: 'Dead' }))).toBe(false);
  });

  it('refuses a press made with the third-level modifier of a layout', () => {
    // AltGr sets the control and alt flags on Windows and Linux, so a German
    // user typing a backslash with AltGr+Minus looked exactly like someone
    // pressing Ctrl+Alt+Minus, and ran whatever that was bound to instead of
    // typing the character.
    expect(
      isShortcutPress(
        reading({ code: 'Minus', key: '\\', ctrlKey: true, altKey: true, altGraph: true }),
      ),
    ).toBe(false);
  });

  it('refuses a press an input method is composing with', () => {
    expect(isShortcutPress(reading({ key: 'a', composing: true }))).toBe(false);
  });
});
