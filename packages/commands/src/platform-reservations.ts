/**
 * What the browser and the operating system take before AudioGubbins sees it.
 *
 * REQ-UX-066 requires reserved shortcuts to be handled deliberately rather than
 * bound and silently swallowed. The answer is one concern, separate from what a
 * shortcut is and how it is written: the rebinding path, the recorder, the
 * settings' list of what is taken, the keyboard, and what the menus, the
 * palette and the hints offer all ask it, and none of them owns it. The rules
 * it reads are in `reservation-table.ts`.
 */

import {
  UNKNOWN_LAYOUT,
  browserPressOf,
  commandLayerKeys,
  keyPress,
  type KeyPress,
  type KeyboardLayout,
  type TypedKey,
} from '@audiogubbins/input';

import type { CommandId } from './command.js';
import { RESERVATIONS } from './reservation-table.js';
import {
  bindingsFor,
  describeShortcut,
  type KeyboardConvention,
  type Shortcut,
  type ShortcutProfile,
  shortcut,
} from './shortcut.js';

/**
 * A key press the browser or the operating system takes before AudioGubbins
 * sees it, and what it takes it for.
 */
export interface PlatformReservation {
  /** The press that is taken. */
  readonly press: KeyPress;

  /**
   * What takes it, as a sentence a user can act on.
   *
   * Said with the refusal, because "the browser takes that" is not true of
   * every browser for every press: Firefox keeps Ctrl+Shift+P for a private
   * window and Chrome gives it to the page. A user told which browser and what
   * for can tell whether the rule is about theirs.
   */
  readonly reason: string;
}

/**
 * The first press of a shortcut the platform takes, and why, or `undefined`
 * when every press reaches AudioGubbins.
 *
 * Every press is read, not only the first. A chord is AudioGubbins' own state:
 * the browser does not know Ctrl+K has started one, sees an ordinary Ctrl+W as
 * the second press, and closes the tab. A started chord does not have the
 * keyboard, so a chord is refused for any press of it the browser takes.
 *
 * Each press is read as the browser reads it, on the user's layout: the rules
 * are written at the US keys a browser's shortcuts are named by, and a press
 * of another key that types the same character is the same shortcut to the
 * browser (see `keyboard-layout.ts`). Read by position alone, a Dvorak user's
 * Ctrl+K would be allowed, and the browser would open a tab with it.
 */
export function platformReservation(
  value: Shortcut,
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): PlatformReservation | undefined {
  for (const press of value.presses) {
    const asTheBrowserReadsIt = browserPressOf(press, layout);
    const rule = RESERVATIONS.find(
      (one) => one.conventions.includes(convention) && one.matches(asTheBrowserReadsIt),
    );
    if (rule !== undefined) return { press, reason: rule.reason };
  }
  return undefined;
}

/**
 * Whether the platform may take a Command press of the key at `code` before
 * the page sees it, under either reading of the layout.
 *
 * Some layouts type one set of characters and another while Command is held,
 * and until a press shows which, a Command press of a key is read either at
 * the key's own position or as the character the layout types there. A key
 * is only safe to ask a reader to press where neither reading is taken. On
 * AZERTY the key that types "a" is read either as itself or as the key a US
 * keyboard types "q" on, and macOS quits the browser with the second.
 *
 * Both readings are worked out here, so each is asked of a keyboard nothing is
 * known of rather than being worked out a second time. Written in the settings
 * note and again in its test, the two could come apart with nothing to notice.
 */
export function commandPressMayBeTaken(
  code: string,
  layout: KeyboardLayout,
  convention: KeyboardConvention,
): boolean {
  const atItsPosition = keyPress(code, { meta: true });
  return [atItsPosition, browserPressOf(atItsPosition, layout)].some((press) =>
    isReservedByPlatform(shortcut(press), convention, UNKNOWN_LAYOUT),
  );
}

/**
 * The key a reader is asked to press with Command, to show how their system
 * reads a Command press: the first that can show it and that neither reading
 * leaves to the platform, or `undefined` where there is none.
 *
 * Both readings, because which of the two the system reads is the very thing
 * the press is asked for to settle: there is no safe key while both are open.
 *
 * One answer for the settings, which name it, and for the keyboard, which keeps
 * the browser from acting on it while it is asked for: bound to nothing, the
 * press would reach the browser, and on Dvorak – QWERTY ⌘ the key that types
 * `c` is Command+I, which Firefox opens a window with.
 */
export function commandLayerKeyAsked(
  layout: KeyboardLayout,
  convention: KeyboardConvention,
): TypedKey | undefined {
  return commandLayerKeys(layout).find(
    ([code]) => !commandPressMayBeTaken(code, layout, convention),
  );
}

/** Whether the browser or the operating system takes any press of this shortcut first. */
export function isReservedByPlatform(
  value: Shortcut,
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): boolean {
  return platformReservation(value, convention, layout) !== undefined;
}

/**
 * How a command's shortcut is written where it is offered as one to press: a
 * menu entry, a palette row, a hint on a button.
 *
 * The first of its bindings the platform does not take, and nothing where it
 * has none. Offered as a shortcut, a binding the platform takes would teach a
 * press that does something else: "Close this panel Ctrl+W" in the Workspace
 * menu, for a binding made on a French keyboard, would close the browser tab
 * when it is pressed. Every binding is read, not only the first, so a command
 * whose first binding is taken shows its second where that one works. The
 * Shortcuts settings name each taken binding with its reason, which is where it
 * can be changed.
 *
 * This command's bindings are read, rather than a usable profile being built to
 * take the first entry of. Every menu entry and every palette row asks, the
 * menus are built on every render and the palette's rows on every keystroke,
 * and building the profile would run the whole reservation table over every
 * binding of it each time, to use one answer.
 */
export function shortcutOffered(
  profile: ShortcutProfile,
  id: CommandId,
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): string | undefined {
  const first = bindingsFor(profile, id).find(
    (binding) => !isReservedByPlatform(binding, convention, layout),
  );
  return first === undefined ? undefined : describeShortcut(first, convention, layout);
}

/**
 * Why a shortcut cannot be bound, for the user who tried.
 *
 * One sentence for the rebinding refusal and the recorder alike, so the two
 * cannot tell the user different things about the same combination.
 */
export function describeReservation(
  reservation: PlatformReservation,
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): string {
  return `${describeShortcut({ presses: [reservation.press] }, convention, layout)} cannot be used: ${reservation.reason} Choose another.`;
}
