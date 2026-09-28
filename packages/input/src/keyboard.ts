/**
 * One key with its modifiers, and how a key event becomes one.
 *
 * The keyboard half of the input model, beside the pointer half: the press
 * itself, and the reading of a key event. Both are about the device, not about
 * commands, so they are here rather than in the command layer, which binds
 * presses to commands and takes its presses from here, or in the application's
 * shortcut hook.
 *
 * A key event is read through the few fields it needs rather than the browser's
 * own type, so this package, and the command layer that depends on it, stay
 * compiled without the browser's type definitions.
 */

/**
 * One key with its modifiers.
 *
 * `key` is the physical key's code, as `KeyboardEvent.code` reports it, for
 * example `KeyS` or `Digit1`. The code rather than the character, because a
 * shortcut is a position on the keyboard: binding to the character would move
 * the shortcut when the user changes layout, so a French layout would find
 * Ctrl+Z somewhere else.
 */
export interface KeyPress {
  readonly key: string;
  readonly control: boolean;
  readonly shift: boolean;
  readonly alt: boolean;

  /** The Command key on Apple hardware, the Windows key elsewhere. */
  readonly meta: boolean;
}

/** Builds a key press, defaulting every modifier to released. */
export function keyPress(key: string, modifiers: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress {
  return {
    key,
    control: modifiers.control ?? false,
    shift: modifiers.shift ?? false,
    alt: modifiers.alt ?? false,
    meta: modifiers.meta ?? false,
  };
}

/** Whether two key presses are the same key with the same modifiers. */
export function keyPressesMatch(left: KeyPress, right: KeyPress): boolean {
  return (
    left.key === right.key &&
    left.control === right.control &&
    left.shift === right.shift &&
    left.alt === right.alt &&
    left.meta === right.meta
  );
}

/**
 * Keys that are never a press of their own.
 *
 * A modifier arrives as its own event before the key it modifies, so feeding
 * one to a chord would abandon the chord the moment the user reached for
 * Control to type its second press. Two more belong here for the same reason:
 * `AltGraph` is the right-hand Alt a European layout uses to reach a bracket or
 * a backslash, and `Dead` is what a browser reports for the first half of an
 * accented character. Without them, a French or German user typing a chord
 * would lose it to a key they have to press to type at all.
 *
 * `Process` and `Unidentified` are what a browser reports while an input method
 * is composing, which is the same case again: the user is typing a character,
 * not a shortcut.
 */
const NEVER_A_PRESS: ReadonlySet<string> = new Set([
  'Control',
  'Shift',
  'Alt',
  'AltGraph',
  'Meta',
  'CapsLock',
  'OS',
  'Dead',
  'Process',
  'Unidentified',
]);

/**
 * Whether a key can be part of a shortcut at all.
 *
 * Takes `KeyboardEvent.key`, the character the layout produces, rather than the
 * code a press is built from: what a key means to the layout is exactly what
 * decides this, and the same physical key is `AltGraph` on one layout and `Alt`
 * on another.
 */
export function isShortcutKey(key: string): boolean {
  return !NEVER_A_PRESS.has(key);
}

/** The fields of a key event a press is read from. */
export interface KeyEventReading {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;

  /**
   * What the layout produces, as `KeyboardEvent.key` reports it.
   *
   * The press itself is built from the code, because a shortcut is a position
   * on the keyboard. This says whether the press is one a shortcut can be made
   * of at all: a modifier, a dead key or a key an input method is composing
   * with is the user typing a character.
   */
  readonly key: string;

  /**
   * Whether the layout's third-level modifier is held, on a platform where
   * that means the user is typing a character.
   *
   * On a European layout AltGr is how a bracket, a backslash or a euro sign is
   * typed, and Windows and Linux report it as Control and Alt together. Read
   * from `getModifierState('AltGraph')`, because the two flags on their own
   * cannot be told apart from the combination; never set on Apple hardware,
   * where Option is a shortcut modifier (see {@link KeyboardPlatform}).
   */
  readonly altGraph: boolean;

  /** Whether an input method is composing with this press. */
  readonly composing: boolean;

  /**
   * Whether Caps Lock is on, read from `getModifierState('CapsLock')`.
   *
   * It changes what a letter key types, as Shift does, and neither flag above
   * reports it. Nothing is learned from a press made with it on: learned from,
   * a capital `I` on Turkish Q would be lower-cased back to `i` and learned on
   * the key that types `ı`, which would move `i` off its own key and make the
   * layout read as non-Latin.
   */
  readonly capsLock: boolean;
}

/**
 * Whether a key event is a press a shortcut could be made of.
 *
 * The one answer both edges ask, the listener that runs a shortcut and the
 * recorder that binds one, so the two cannot disagree. AltGr is part of it:
 * read as Control and Alt, a German user pressing AltGr+B to type a backslash
 * would run whatever Ctrl+Alt+B is bound to, and the character would never
 * reach the field.
 */
export function isShortcutPress(reading: KeyEventReading): boolean {
  return isShortcutKey(reading.key) && !reading.altGraph && !reading.composing;
}

/**
 * The fields of a browser's key event that a reading is taken from.
 *
 * Structural, so this package reads an event without the browser's type
 * definitions and a test can hand it a plain object. The reading is taken here
 * rather than in the application's shortcut hook, so it is tested here, AltGr
 * included, and the settings' recorder reads three fields off an event without
 * importing a hook module.
 */
export interface KeyEventSource {
  readonly code: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
  getModifierState(key: string): boolean;
}

/** How the platform uses the key a layout reaches its third-level characters with. */
export interface KeyboardPlatform {
  /**
   * Whether a press with AltGr held is the user typing a character.
   *
   * True on Windows and Linux, where AltGr is how a European layout types a
   * bracket, a backslash or a euro sign, and arrives as Control and Alt
   * together. False on Apple hardware, where Option is a modifier shortcuts are
   * made with: some engines report it as AltGr, and read as typing, an Option
   * shortcut could be neither recorded nor run there.
   */
  readonly altGraphIsTyping: boolean;

  /**
   * Whether Alt, as Option, types a character in a text field.
   *
   * True on Apple hardware, where Option with a letter types an accent or a
   * symbol; the field keeps the press whether or not the engine reports it as
   * AltGr, which Chromium and WebKit on macOS do not. False elsewhere, where
   * Alt with a key is a shortcut wherever it is pressed.
   */
  readonly optionTypesInAField: boolean;
}

/**
 * Whether a press made in a text field is the user typing into it.
 *
 * A shortcut must not fire while someone is naming a workspace. Only bare and
 * shifted keys are let through to the field, and Option on Apple hardware: a
 * combination with Control or Command is a shortcut wherever it is pressed, and
 * swallowing it inside a field would make the application feel inconsistent
 * about where it listens. AltGr on Windows and Linux never arrives here,
 * because it is not a shortcut press at all (`isShortcutPress`). The one rule
 * for both edges, in one place: read again in the listener from the raw event,
 * it would be read without the platform.
 */
export function isTypingPress(reading: KeyEventReading, platform: KeyboardPlatform): boolean {
  if (reading.ctrlKey || reading.metaKey) return false;
  return !reading.altKey || platform.optionTypesInAField;
}

/**
 * Reads what the input model needs from a key event.
 *
 * AltGr is read through `getModifierState`, because Windows and Linux report it
 * as Control and Alt together and the flags alone cannot tell the two apart.
 */
export function readingOf(event: KeyEventSource, platform: KeyboardPlatform): KeyEventReading {
  return {
    code: event.code,
    key: event.key,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    altGraph: platform.altGraphIsTyping && event.getModifierState('AltGraph'),
    composing: event.isComposing,
    capsLock: event.getModifierState('CapsLock'),
  };
}

/** Turns a key event into a key press. */
export function keyPressFromEvent(event: KeyEventReading): KeyPress {
  return {
    // `code` is the physical key. Binding to `key` would move every shortcut
    // when the user changed layout, so a French keyboard would find Ctrl+Z
    // somewhere else (REQ-UX-066).
    key: event.code,
    control: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}
