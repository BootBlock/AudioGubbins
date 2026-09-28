/**
 * Keyboard layouts a test reads the shortcuts on: what each key of the writing
 * block types with no modifier.
 *
 * Four that differ from a US layout in the ways that matter to a shortcut:
 * Dvorak moves the Latin letters, French AZERTY moves some letters and puts
 * other characters on the digits, German QWERTZ swaps two letters and types a
 * dead key where a US layout types `=`, and Russian types no Latin letter at
 * all, where a browser falls back to the key's US position.
 */

import { UNKNOWN_LAYOUT, keyboardLayout, type KeyboardLayout } from '@audiogubbins/input';

/** A layout from rows of codes and the characters they type, in order. */
function layoutOf(
  rows: readonly (readonly [string, string])[],
  readings: { readonly commandByPosition?: boolean } = {},
): KeyboardLayout {
  return keyboardLayout(
    rows.flatMap(([codes, characters]) =>
      codes.split(' ').map((code, index) => [code, Array.from(characters)[index] ?? ''] as const),
    ),
    readings,
  );
}

/** The keys of each row of the writing block, left to right. */
const DIGITS = 'Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal';
const TOP = 'KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight';
const HOME = 'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote';
const BOTTOM = 'KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash';

/** The rows of US Dvorak, read three ways below. */
const DVORAK_ROWS = [
  [DIGITS, '1234567890[]'],
  [TOP, "',.pyfgcrl/="],
  [HOME, 'aoeuidhtns-'],
  [BOTTOM, ';qjkxbmwvz'],
] as const;

/** US Dvorak, with no Command press read yet. */
export const DVORAK: KeyboardLayout = layoutOf(DVORAK_ROWS);

/**
 * US Dvorak on a system that reads a Command press at the key's US position,
 * as "Dvorak - QWERTY Command" does.
 *
 * The two settled readings are layouts in their own right here because a
 * default that waits for the reading is placed on neither, so every test read
 * on an unread layout under the Apple conventions reads an empty profile:
 * without them, the family would cover the wait and neither answer to it.
 */
const DVORAK_BY_POSITION: KeyboardLayout = layoutOf(DVORAK_ROWS, {
  commandByPosition: true,
});

/** US Dvorak on a system that reads a Command press by what the layout types. */
const DVORAK_BY_CHARACTER: KeyboardLayout = layoutOf(DVORAK_ROWS, {
  commandByPosition: false,
});

/** French AZERTY. */
export const AZERTY: KeyboardLayout = layoutOf([
  [DIGITS, '&é"\'(-è_çà)='],
  [TOP, 'azertyuiop^$'],
  [HOME, 'qsdfghjklmù'],
  [BOTTOM, 'wxcvbn,;:!'],
]);

/**
 * German QWERTZ.
 *
 * The key a US layout types `=` on types the acute accent, a dead key: a
 * default written as `=` would go there, and its press could never reach a
 * chord. `=` itself needs Shift, so nothing the user types can teach it.
 */
export const GERMAN: KeyboardLayout = layoutOf([
  [DIGITS, '1234567890ß´'],
  [TOP, 'qwertzuiopü+'],
  [HOME, 'asdfghjklöä'],
  [BOTTOM, 'yxcvbnm,.-'],
]);

/** Russian ЙЦУКЕН. */
export const RUSSIAN: KeyboardLayout = layoutOf([
  [DIGITS, '1234567890-='],
  [TOP, 'йцукенгшщзхъ'],
  [HOME, 'фывапролджэ'],
  [BOTTOM, 'ячсмитьбю.'],
]);

/**
 * Every layout here, with the name a test titles a case by, in one order: a
 * keyboard nothing is known of, and six that move the characters a default
 * is written as — Dvorak read three ways, AZERTY, German and Russian.
 *
 * Beside the layouts rather than written out in each file that sweeps them:
 * written out in each, a layout added here would have to be added to every
 * table by hand, and the tables could disagree about what one of them is, as
 * two that gave `UNKNOWN_LAYOUT` different names would.
 */
export const NAMED_LAYOUTS: readonly (readonly [string, KeyboardLayout])[] = [
  ['a keyboard nothing is known of', UNKNOWN_LAYOUT],
  ['Dvorak', DVORAK],
  ['Dvorak read by position', DVORAK_BY_POSITION],
  ['Dvorak read by character', DVORAK_BY_CHARACTER],
  ['AZERTY', AZERTY],
  ['German', GERMAN],
  ['a Russian layout', RUSSIAN],
];
