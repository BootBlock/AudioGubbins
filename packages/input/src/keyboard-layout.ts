/**
 * What the user's keyboard layout types on each key.
 *
 * A shortcut is bound to a key's position (see `KeyPress`), and a browser takes
 * its own shortcuts by what a key types: Firefox, and every browser on macOS,
 * by the character; Chromium on Windows by the virtual key, which follows the
 * layout's letters and punctuation. On a layout that types Latin letters, the
 * key a browser matches is the one a US layout types the same character on. On
 * one that does not, a browser reads a letter key at its US position, and on
 * every layout a digit key is read as its digit. So what a press means to the
 * browser, what its label should say, and where a default shortcut goes all
 * need the layout. Read from the position alone, every keyboard would be a US
 * one: on Dvorak the chord prefix Ctrl+K would be Ctrl+T, a new tab, and the
 * settings shortcut Ctrl+comma would be Ctrl+W, which closes the tab.
 *
 * Known as far as it has been learned: from the browser's layout map where it
 * gives one, which Chromium does, and otherwise from the keys the user types.
 * The browsers' matching is as their documentation and source describe it, and
 * is not measured here.
 */

import { oneCharacter } from '@audiogubbins/text';

import type { KeyEventReading, KeyPress } from './keyboard.js';

/** What a layout is known to type, as far as it is known. */
export interface KeyboardLayout {
  /** The character a key types with no modifier, in lower case, or `undefined` while that is not known. */
  readonly characterAt: (code: string) => string | undefined;

  /** The key known to type a character with no modifier, or `undefined` while none is. */
  readonly keyTyping: (character: string) => string | undefined;

  /**
   * Whether the layout types Latin letters, as far as is known: false once any
   * letter key is known to type a letter outside them, as on a Cyrillic, a
   * Greek or a Hebrew layout, where a browser reads every letter key at its US
   * position. Decided for the layout rather than for each key: decided for each
   * key, a Hebrew letter key that types a quote mark would be read as the quote
   * mark's US key.
   */
  readonly latin: boolean;

  /**
   * Whether a press made with Command is read at its US position, whatever the
   * layout types without it, and `undefined` while no press has shown either
   * way: true once a Command press has typed a letter other than the one the
   * layout types on that key, false once one has typed that same letter.
   *
   * macOS has layouts that type another layout's characters while Command is
   * held, "Dvorak – QWERTY ⌘" among them, and the system and the browser read a
   * Command press by those. Read by the Dvorak characters, the chord prefix
   * Command+K would sit on the key the system reads as Command+V, and swallow
   * every paste; the palette, the settings and the themes would sit on
   * Command+R, Command+Shift+W, Command+H and Command+N.
   *
   * Unread is its own answer rather than false. Answered false, a layout that
   * has shown nothing would put the settings default on the key Dvorak types a
   * comma on, which macOS reads as Command+Shift+W and closes the window with;
   * and the US position is no safer, since the key a US layout types the
   * character on types another letter on that layout. Neither place is right
   * under both readings, so while it is unread there is no place
   * ({@link placeFor}).
   */
  readonly commandByPosition: boolean | undefined;
}

/** A layout nothing is known of, whose every key is read at its US position. */
export const UNKNOWN_LAYOUT: KeyboardLayout = {
  characterAt: () => undefined,
  keyTyping: () => undefined,
  latin: true,
  commandByPosition: undefined,
};

/**
 * What a press is made with, as far as where a character goes depends on it:
 * nothing, a modifier, or Command, which some layouts read by another layout's
 * characters ({@link KeyboardLayout.commandByPosition}).
 */
export type PressedWith = 'nothing' | 'a modifier' | 'command';

/** A letter key's code, `KeyA` to `KeyZ`. */
const LETTER_KEY = /^Key[A-Z]$/;

/** A digit key's code on the writing block, `Digit0` to `Digit9`. */
const DIGIT_KEY = /^Digit\d$/;

/**
 * A letter of the Latin script, in any language that writes with it.
 *
 * Read as `[a-z]`, a letter key typing `ı`, `ğ`, `ü` or `ş` would make the
 * whole layout a non-Latin one: on Turkish F every chord default would wait for
 * ever for a key the user has already typed, and the reservations would sit on
 * the wrong keys.
 */
const LATIN_LETTER = /^\p{Script=Latin}$/u;

/** Any letter, in any script. */
const LETTER = /^\p{L}$/u;

/** A key's code and the character it types, as one pair. */
export type TypedKey = readonly [string, string];

/**
 * A character as a layout keeps it: in lower case, whoever gave it, so a key
 * read with Shift or Caps Lock names the same character as one read without.
 * Every place that takes a character in reads it through this.
 */
function asKept(character: string): string {
  return character.toLowerCase();
}

/**
 * `pairs` with `code` learned to type `typed`, or `pairs` itself where it
 * already does.
 *
 * The one place the learning rule is written, which the store that keeps the
 * layout learns through too. The key learned last for a character is the key
 * that types it, and a key that typed a character before no longer does:
 * otherwise a key learned before a switch of layout would still name it.
 */
export function withLearned(
  pairs: readonly TypedKey[],
  code: string,
  typed: string,
): readonly TypedKey[] {
  const character = asKept(typed);
  if (pairs.some(([one, learned]) => one === code && learned === character)) return pairs;
  return [
    ...pairs.filter(([one, learned]) => one !== code && learned !== character),
    [code, character],
  ];
}

/**
 * A layout from what is known of it: each key's code and the character it
 * types, in the order they were learned, and how it reads a Command press.
 */
export function keyboardLayout(
  pairs: Iterable<TypedKey>,
  readings: Partial<Pick<KeyboardLayout, 'commandByPosition'>> = {},
): KeyboardLayout {
  let learned: readonly TypedKey[] = [];
  for (const [code, typed] of pairs) learned = withLearned(learned, code, typed);

  const characters = new Map(learned);
  const keys = new Map(learned.map(([code, character]) => [character, code] as const));

  const latin = ![...characters].some(
    ([code, character]) =>
      LETTER_KEY.test(code) && LETTER.test(character) && !LATIN_LETTER.test(character),
  );

  return {
    characterAt: (code) => characters.get(code),
    keyTyping: (character) => keys.get(asKept(character)),
    latin,
    commandByPosition: readings.commandByPosition,
  };
}

/**
 * The key a US layout types each character on with no modifier: where the
 * browsers' own shortcuts, and this application's defaults, are written.
 */
const US_KEYS: ReadonlyMap<string, string> = new Map([
  ...Array.from(
    'abcdefghijklmnopqrstuvwxyz',
    (letter) => [letter, `Key${letter.toUpperCase()}`] as const,
  ),
  ...Array.from('0123456789', (digit) => [digit, `Digit${digit}`] as const),
  [',', 'Comma'],
  ['.', 'Period'],
  ['/', 'Slash'],
  [';', 'Semicolon'],
  ["'", 'Quote'],
  ['[', 'BracketLeft'],
  [']', 'BracketRight'],
  ['\\', 'Backslash'],
  ['-', 'Minus'],
  ['=', 'Equal'],
  ['`', 'Backquote'],
]);

/**
 * The keys of the writing block, which a layout types its characters on. A
 * numeric keypad's keys type the same few characters on every layout, and read
 * as the key for `-`, one would move a default shortcut onto the keypad.
 */
const WRITING_KEYS: ReadonlySet<string> = new Set([
  ...US_KEYS.values(),
  'IntlBackslash',
  'IntlRo',
  'IntlYen',
]);

/**
 * The characters a browser names an accelerator by that a US layout types with
 * Shift, each with its US key. `+` alone: a browser zooms in with Control on
 * the key that types it. German, Spanish and Italian type it with no modifier,
 * on a key of its own, and read by that key, which no US key types `+` on
 * unshifted, the zoom would be called free.
 *
 * Read only from a press holding no Shift ({@link browserPressOf}): with Shift
 * held the key types another character, which the browser names its own
 * accelerator by.
 */
const US_SHIFTED_ACCELERATORS: ReadonlyMap<string, string> = new Map([['+', 'Equal']]);

/**
 * Whether a browser reads this key at its US position whatever the layout
 * types on it: a digit key on every layout, a letter key on one that does not
 * type Latin letters, and every key pressed with Command on a layout that
 * reads Command by position.
 */
function readAtItsPosition(code: string, layout: KeyboardLayout, command: boolean): boolean {
  return (
    (command && layout.commandByPosition === true) ||
    DIGIT_KEY.test(code) ||
    (!layout.latin && LETTER_KEY.test(code))
  );
}

/**
 * Whether the two readings of a Command press on this key would disagree: the
 * layer is unread, and the character the layout types on the key is one a US
 * layout types on another key.
 *
 * A key both layers type the same character on shows nothing and has nothing to
 * decide. Dvorak keeps `a` on the US `a` key, so Command+A on "Dvorak – QWERTY
 * ⌘" types `a` under either reading: read as proof that the layout does not
 * switch, it would undo the reading at the commonest Mac shortcut there is.
 *
 * Nor does a key typing a character no US layout types without Shift, such as
 * `+` on a German keyboard. A browser reads such a key at its own position
 * whichever layer it is on, so the two readings agree and there is nothing to
 * settle.
 */
function readingsDisagreeOn(code: string, layout: KeyboardLayout): boolean {
  if (layout.commandByPosition !== undefined) return false;
  const character = layout.characterAt(code);
  if (character === undefined) return false;
  const usKey = US_KEYS.get(character);
  return usKey !== undefined && usKey !== code;
}

/**
 * The press a browser matches a press on: with the US key that types what the
 * pressed key types on this layout, or with the pressed key itself while that
 * is not known, or is a character no US key types, or where a browser reads the
 * key at its position. The digit row of a French layout types punctuation, and
 * read by that, Ctrl+4 would be taken for Ctrl+quote. A key typing `+` is the
 * US key that types it with Shift, pressed with Shift
 * ({@link US_SHIFTED_ACCELERATORS}).
 */
export function browserPressOf(press: KeyPress, layout: KeyboardLayout): KeyPress {
  if (readAtItsPosition(press.key, layout, press.meta)) return press;
  const character = layout.characterAt(press.key);
  if (character === undefined) return press;

  const usKey = US_KEYS.get(character);
  if (usKey !== undefined) return { ...press, key: usKey };

  // Only a press that holds no Shift of its own. The character is what the key
  // types unshifted, so the browser names that accelerator with Shift; held
  // down, the key types something else and the browser names that instead.
  // German, Spanish and Italian type `*` with Shift on the key that types `+`,
  // and no browser zooms with Control and `*`, so mapped to the zoom's key, the
  // press would be refused for nothing.
  if (press.shift) return press;
  const shifted = US_SHIFTED_ACCELERATORS.get(character);
  return shifted === undefined ? press : { ...press, key: shifted, shift: true };
}

/**
 * Whether a shortcut written as this character, pressed with Command, has no
 * place on this layout yet: the layout types the character on a key a US
 * layout types another character on, and no Command press has shown which of
 * the two the system reads.
 *
 * There is no safe place while both are open. Put where the layout types the
 * character, a switching layout would give the chord prefix the key the system
 * reads as Command+V and swallow every paste; put at the US key, a layout that
 * does not switch would give the settings the key Dvorak types `w` on, which
 * macOS reads as Command+Shift+W and closes the window with. So the default
 * waits, and one Command press on a key the two layers differ on settles it.
 */
function commandLayerUnread(character: string, layout: KeyboardLayout): boolean {
  const known = layout.keyTyping(character);
  return known !== undefined && readingsDisagreeOn(known, layout);
}

/**
 * Where a character's shortcut goes on this layout, or which press it is
 * waiting for.
 *
 * A key, or one of two waits, and never both: a key typed on its own ends
 * `'a key'`, and any qualifying key held with Command ends
 * `'the Command layer'` ({@link commandLayerKeys} answers which). The caller
 * has to tell them apart to say which press to ask for.
 */
export type Placement =
  | { readonly key: string; readonly waitsFor?: undefined }
  | { readonly key?: undefined; readonly waitsFor: 'a key' | 'the Command layer' };

/**
 * Where a shortcut written as the character it is pressed with goes on this
 * layout, pressed with a modifier or not, and which press it waits for where
 * it goes nowhere.
 *
 * The key known to type the character, unless the press is modified and a
 * browser reads that key at its position as something else: Ctrl on the French
 * digit row's hyphen is Ctrl+6 to a browser, so there is no place for it. While
 * no key is known, the character's US key, unless that key is known to type
 * another character a US layout has: then the character is on a key not learned
 * yet, and the answer is `undefined`, because the US key would be a different
 * shortcut, perhaps one the browser takes. A key that types a character no US
 * layout has is where a browser falls back to the US position, so the US key
 * stands there. Pressed with Command on a layout that reads Command by
 * position, it is the character's US key.
 *
 * The answer says which wait it is rather than leaving the caller to work it
 * out. Answered as a key or `undefined`, the caller would have to ask a second
 * time whether the Command layer is read yet, to decide which `undefined` it
 * had been given: one rule with two applications, where a third reason for
 * `undefined` in here would put a default in the wrong wait list with nothing
 * to notice.
 */
export function placeFor(
  character: string,
  layout: KeyboardLayout,
  pressedWith: PressedWith,
): Placement {
  const command = pressedWith === 'command';
  const usKey = US_KEYS.get(character);
  const at = (key: string | undefined): Placement =>
    key === undefined ? { waitsFor: 'a key' } : { key };

  if (command && layout.commandByPosition === true) return at(usKey);

  const known = layout.keyTyping(character);
  if (known !== undefined) {
    if (command && commandLayerUnread(character, layout)) return { waitsFor: 'the Command layer' };
    if (pressedWith === 'nothing' || !readAtItsPosition(known, layout, command))
      return { key: known };
    return known === usKey ? { key: known } : { waitsFor: 'a key' };
  }

  if (usKey === undefined) return { waitsFor: 'a key' };

  // A key a browser reads at its position is the US key whatever it types, so
  // it stands there: read by what it types, `w` on a Hebrew layout would have
  // no place although `KeyW` is where a browser matches it.
  if (readAtItsPosition(usKey, layout, command)) return { key: usKey };

  const there = layout.characterAt(usKey);
  return there === undefined || there === character || !US_KEYS.has(there)
    ? { key: usKey }
    : { waitsFor: 'a key' };
}

/**
 * The name a character is shown by: the character in capitals, where the
 * capital is one character too, and the character itself otherwise. `ß` in
 * capitals is `SS`, two letters no keycap shows.
 *
 * The one place the rule is written, so a key's label and the same character's
 * name in the waiting list agree: a copy that always upper-cased would name `ß`
 * as `SS` in one and not in the other.
 */
export function characterName(character: string): string {
  const capital = character.toUpperCase();
  return oneCharacter(capital) ? capital : character;
}

/**
 * What the key of a press is called on this layout: {@link characterName} of
 * the character it types, or `undefined` while that is not known or the
 * layout reads the press at its US position under Command, where its US name
 * is the one the browser and the system read it by.
 */
export function keyNameOn(
  press: Pick<KeyPress, 'key' | 'meta'>,
  layout: KeyboardLayout,
): string | undefined {
  if (press.meta && (layout.commandByPosition === true || readingsDisagreeOn(press.key, layout))) {
    return undefined;
  }
  const character = layout.characterAt(press.key);
  return character === undefined ? undefined : characterName(character);
}

/**
 * Whether a key and a character could be a key of the writing block typing
 * that character: what {@link typedCharacterOf} accepts from a key event.
 *
 * Read by whatever takes a pair from outside this build, a stored layout or a
 * browser's layout map. Checked only for being two strings, any text at all in
 * a layout kept from an earlier visit would become a key's label.
 */
export function couldBeTyped(code: string, character: string): boolean {
  return WRITING_KEYS.has(code) && character.trim() !== '' && oneCharacter(character);
}

/**
 * The key and the character a key event shows the layout types, when it shows
 * one: a single printable character, typed on the writing block with no
 * modifier at all. Shift, Alt, Option and AltGr each change what a key types,
 * and Command does on the macOS layouts that type another layout's characters
 * while it is held, "Dvorak – QWERTY ⌘" among them: learned from it, a key
 * would be learned again at every press and the defaults would move between
 * keys ({@link commandLayerOf} reads such a press instead). Control is left out
 * with it, since a shortcut is not typing. The character is kept in lower case
 * ({@link asKept}), the form every pair of a layout is in.
 *
 * Caps Lock changes what a letter key types as Shift does, and the capital is
 * lower-cased again, so nothing is learned while it is on: learned from, a
 * press on Turkish Q would move `i` from `Quote` to `KeyI`, which is the key
 * that types `ı`, and the layout would read as Latin and non-Latin by turns.
 */
export function typedCharacterOf(reading: KeyEventReading): TypedKey | undefined {
  if (reading.shiftKey || reading.altKey || reading.altGraph || reading.composing) return undefined;
  if (reading.ctrlKey || reading.metaKey || reading.capsLock) return undefined;
  if (!couldBeTyped(reading.code, reading.key)) return undefined;
  return [reading.code, asKept(reading.key)];
}

/**
 * Every key of this layout a Command press would show the layer by, in a
 * stable order: the key's code and the character it types.
 *
 * Asked of the layout rather than of the defaults that are waiting. One
 * qualifying press settles the reading for every default at once, so which
 * shortcut waits decides nothing about which key ends the wait — and a
 * default's own character need not be on a key that can end it. The settings
 * default is written as a comma, and a comma is not a letter, so a reader asked
 * for the key that types it would press it and learn nothing.
 *
 * The conditions are {@link commandLayerOf}'s own, so every key here is a key
 * that press is read from: a letter key, typing a letter, which a US layout
 * types somewhere else. A key a US layout types the same character on cannot
 * tell the two readings apart, whichever it types now.
 *
 * All of them rather than one, because whether the press ever reaches the page
 * is not this package's to answer. Read is not delivered: the browser and the
 * operating system take some combinations first, and which ones depends on the
 * conventions in force, which this package knows nothing of. A caller naming
 * one of these to a reader picks the first its own reservation table leaves
 * alone.
 *
 * Empty where the layout has shown no such key: the ordinary state of a
 * browser that offers no layout map, where nothing is known of a key until the
 * user has typed it plainly, and the lasting state of a layout that moves its
 * punctuation and leaves every letter where a US layout types it. No press
 * settles the reading while that holds, so the settings say so rather than
 * name a key.
 */
export function commandLayerKeys(layout: KeyboardLayout): readonly TypedKey[] {
  const settling: TypedKey[] = [];

  for (const code of US_KEYS.values()) {
    if (!LETTER_KEY.test(code)) continue;

    const character = layout.characterAt(code);
    if (character === undefined || !LETTER.test(character)) continue;
    if (US_KEYS.get(character) === code) continue;

    settling.push([code, character]);
  }

  // The characters' own order, so which key a caller reaches first follows
  // from what the layout types rather than from the order `US_KEYS` happens to
  // be written in.
  return settling.toSorted(([, left], [, right]) => (left < right ? -1 : Number(left > right)));
}

/**
 * What a key event shows of the characters the layout types while Command is
 * held: `'another layout'` where a press made with Command alone typed a
 * letter other than the one the layout types on that key, `'the same'` where
 * it typed that letter, and `undefined` where it shows neither.
 *
 * Read from a Command press, which the learning rule leaves alone
 * ({@link typedCharacterOf}): what such a press types is not a character of the
 * layout, but whether it differs says whether the layout switches under
 * Command. Both answers are read, so a user who moves from "Dvorak – QWERTY ⌘"
 * to Dvorak is read as Dvorak again at their next Command press.
 *
 * A key both layers type the same character on is read as neither
 * ({@link readingsDisagreeOn}).
 *
 * ## What this rests on, and what it does not
 *
 * The premise is that on macOS, Chromium, WebKit and Gecko all put the ⌘
 * layer's character in `event.key`. That is what their documentation and
 * source describe and it is not measured here; an engine that did not would
 * report the unswitched letter, which this reads as `'the same'` and the store
 * reads as a layout that does not switch. That is the answer a browser with no
 * layer gives, so such an engine costs a "Dvorak – QWERTY ⌘" user the benefit
 * and costs nobody a working shortcut.
 *
 * Only a press made with Command and nothing else is read. macOS applies the
 * layer whenever Command is held, ⌘⇧ and ⌘⌥ included, but a shifted or
 * optioned press types a different character again and neither layer's plain
 * letter can be recovered from it, so such a press teaches nothing rather
 * than teaching something wrong.
 *
 * Nothing here is true away from Apple hardware. The store is given the
 * platform's conventions and asks this only under Apple's: a Windows-key or
 * Super-key press reports `metaKey`, and read as a Command press on a system
 * that has no ⌘ layer it could set the flag that blanks every key label held
 * with Meta.
 */
export function commandLayerOf(
  reading: KeyEventReading,
  layout: KeyboardLayout,
): 'another layout' | 'the same' | undefined {
  if (!reading.metaKey || reading.ctrlKey || reading.altKey || reading.shiftKey) return undefined;
  if (reading.altGraph || reading.composing || reading.capsLock) return undefined;
  if (!LETTER_KEY.test(reading.code) || !oneCharacter(reading.key)) return undefined;

  const known = layout.characterAt(reading.code);
  const typed = asKept(reading.key);
  if (known === undefined || !LETTER.test(known) || !LETTER.test(typed)) return undefined;

  // A key a US layout types the same character on cannot tell the two layers
  // apart, whichever it types now.
  if (US_KEYS.get(known) === reading.code) return undefined;
  return typed === known ? 'the same' : 'another layout';
}
