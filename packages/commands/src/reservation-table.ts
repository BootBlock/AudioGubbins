/**
 * What the browser and the operating system take before AudioGubbins sees it,
 * as a table of rules.
 *
 * Apart from the answer given from it (`platform-reservations.ts`), because it
 * grows with every browser and system found to take a press, and the answer
 * does not: the table is data, read one rule at a time against a published
 * list, and the answer is the logic that reads a shortcut against it.
 */

import { keyPress, keyPressesMatch, type KeyPress } from '@audiogubbins/input';

import { KeyboardConvention } from './shortcut.js';

/** One kind of press the platform takes, and on which conventions. */
export interface ReservationRule {
  readonly conventions: readonly KeyboardConvention[];
  readonly matches: (press: KeyPress) => boolean;
  readonly reason: string;
}

/** Windows and Linux: Control is the browser's modifier, and Alt its second. */
const DESKTOP: readonly KeyboardConvention[] = [
  KeyboardConvention.Windows,
  KeyboardConvention.Linux,
];

/** Apple hardware: Command is the browser's modifier. */
const APPLE: readonly KeyboardConvention[] = [KeyboardConvention.Apple];

/** Windows alone, for what its own system or its browsers take and Linux's do not. */
const WINDOWS: readonly KeyboardConvention[] = [KeyboardConvention.Windows];

/**
 * Linux alone, likewise.
 *
 * ChromeOS and Android are here too, because the application maps every system
 * that is neither Windows nor Apple onto this convention. The presses below do
 * not reach a page on any of the three, so the rows are right on all of them;
 * the reasons are written to say so. A row that named a GNOME launcher or a KDE
 * force-quit cursor would be a sentence shown to a Chromebook user about a
 * desktop they do not run. ChromeOS's own shortcuts, and a convention of its
 * own, are Phase 14's.
 */
const LINUX: readonly KeyboardConvention[] = [KeyboardConvention.Linux];

/**
 * The reasons of the third kind, each written once for every platform that
 * keeps the press: shown in the settings and in a refusal, they speak to the
 * person reading them, as the rest of the interface does.
 */
const TO_THE_ADDRESS_BAR =
  'The browser moves to its address bar with it, which is how you leave the page from the keyboard, so it is kept for the browser.';
const ZOOMS_THE_PAGE =
  'The browser zooms the page with it, which you may need for larger text, so it is kept for the browser.';
const FILLS_THE_SCREEN =
  'The browser fills the screen with it, and it is how you leave full screen, so it is kept for the browser.';

/** Every convention. */
const EVERY_CONVENTION: readonly KeyboardConvention[] = [...DESKTOP, ...APPLE];

/** A rule for an exact list of presses. */
function exactly(
  conventions: readonly KeyboardConvention[],
  presses: readonly KeyPress[],
  reason: string,
): ReservationRule {
  return {
    conventions,
    matches: (press) => presses.some((reserved) => keyPressesMatch(press, reserved)),
    reason,
  };
}

/** The same key under each of several modifier sets. */
function withEach(
  keys: readonly string[],
  modifierSets: readonly Partial<Omit<KeyPress, 'key'>>[],
): readonly KeyPress[] {
  return keys.flatMap((key) => modifierSets.map((modifiers) => keyPress(key, modifiers)));
}

/**
 * What the browser or the operating system takes before AudioGubbins sees it.
 *
 * REQ-UX-066 requires these to be handled deliberately. Binding one would
 * produce a shortcut that appears in the menu and then does something else
 * entirely, which is worse than having no shortcut: the user learns the
 * application is unreliable rather than that the binding is unavailable.
 *
 * Each rule applies under the conventions whose browsers take it. Control+W
 * closes a tab on Windows and Linux and does nothing in a browser on a Mac,
 * where Command+W does; reserving both everywhere would refuse a Mac user a
 * key their browser leaves alone, with a reason that is not true of their
 * machine.
 *
 * Within a convention the list is deliberately conservative, and it reserves
 * the union of the four supported browsers: the rebinding path does not know
 * which browser will run the profile, and a profile is carried between browsers
 * by export. A binding wrongly called reserved costs the user a shortcut, and
 * says which browser it is for; one wrongly allowed costs them their trust in
 * the whole profile.
 *
 * A rule here is one of three kinds. The first is a press at least one
 * supported browser keeps from the page: it does not arrive at all on that
 * browser. The second is a press a supported system may take, on any
 * convention: the Linux desktop rows, the Windows row about an input method,
 * and the catch-all for a combination held with the Windows or Super key,
 * because what a desktop or an input method does is not the browser's to
 * decide. The third is a press that reaches the page but that a reader relies
 * on the browser for: zooming the page, moving to the address bar, which is how
 * a reader leaves the page from the keyboard, and leaving full screen. The page
 * could take it, and a binding on it would take it silently: a reader who needs
 * larger text would lose the zoom the too-narrow notice tells them to use. It
 * is refused as the others are, with a reason that names the reader and says it
 * is kept for the browser.
 *
 * The third kind keeps every form of the zoom each browser binds, and the
 * documented way into the address bar, not every way a browser offers. The
 * search field's own keys (Control+K and Control+E in Chromium, Control+K in
 * Firefox), the menu (F10, and Alt alone) and Shift+F6, which goes back
 * through the panes F6 goes forward through, are left free: a reader keeps a
 * way out while Control+L, Alt+D and F6 are refused, and Control+K is the
 * prefix of AudioGubbins' own chords.
 *
 * A press the browser acts on but hands to the page first, and that no reader
 * relies on, is not here. That is why Control+S, Control+P, Control+R and
 * Control+D are absent although every browser does something with them: an
 * audio editor wants Save, and it gets the press. The test below says so of
 * Control+S, and is the statement of that choice. A tab by its number and Alt
 * or Command with an arrow or a bracket, for back and forward, are absent for
 * the same reason, and so is Command with a comma, which Safari opens its
 * settings with. None is a row on the belief that a browser keeps it from the
 * page, because neither engine's own list says so: Chromium keeps a press from
 * the page only where it closes a tab or a window, opens one, reopens a closed
 * tab, moves between tabs or quits
 * (`BrowserCommandController::IsReservedCommandOrKey`), and Firefox only the
 * keys its key set marks `reserved`: a new window or tab, closing one, a
 * private window, quitting and leaving full screen. On macOS WebKit gives the
 * page every key equivalent before the browser acts on it
 * (`WebViewImpl::performKeyEquivalent`). Each reaches the page first, and a
 * binding on one runs, because the keyboard cancels a press it runs a command
 * for. What Safari's own menus take before WebKit sees a press is not read
 * here. Premise not run.
 *
 * The application disables all three kinds alike today. Telling the first two
 * apart, so that a row of the first is disabled only on the engine that keeps
 * its press, is Phase 14's, with the engine each row is in force on. The third
 * is disabled on every engine, because a reader relies on it on every one.
 *
 * The first kind describes a window with tabs: in an installed window Chromium
 * keeps nothing from the page (`IsReservedCommandOrKey` returns early for an
 * app window) and there is no address bar, so the split has to treat the
 * installed window as a case of its own.
 *
 * Control+Shift+B and Control+Shift+D are absent, whatever the shipped profile
 * binds to them. They are the bookmarks bar and bookmark-every-tab: the same
 * menu of the same browsers as Control+D, which the sentence above names as
 * deliberately absent, and in no engine's reserved-accelerator set. A row for
 * them and that sentence cannot both be right, and the criterion is what
 * decides, rather than a binding found on a press. What a row costs is why: it
 * is not only a refusal, since the application drops a matched binding out of
 * the profile the keyboard answers, so a row that is wrong is a shortcut that
 * does nothing at all.
 *
 * A binding on a rule here is kept in the profile and answered to nowhere: the
 * application splits a profile by this table and the keyboard answers only what
 * is left. It is answered to nowhere rather than only on the browsers that take
 * it, because the union is what makes a profile mean the same thing on every
 * machine it is carried to: a rule one engine acts on and another delivers
 * would otherwise give the same exported profile two behaviours, and the user
 * who bound it would meet the second one on a borrowed laptop. The settings say
 * that cause rather than saying the browser stopped the press, which on that
 * laptop would not be true.
 *
 * A rule of the first kind is added where an engine's own list keeps its press
 * from the page, of the second where a system may take its press, and of the
 * third where a reader relies on the browser for it.
 */
export const RESERVATIONS: readonly ReservationRule[] = [
  exactly(
    EVERY_CONVENTION,
    [
      ...withEach(['Tab'], [{ control: true }, { control: true, shift: true }]),
      ...withEach(['PageUp', 'PageDown'], [{ control: true }]),
    ],
    'The browser moves between its tabs with it.',
  ),

  exactly(
    DESKTOP,
    [
      ...withEach(['KeyW'], [{ control: true }, { control: true, shift: true }]),
      keyPress('F4', { control: true }),
    ],
    'The browser closes the tab or the window with it.',
  ),
  // Split by system, because each reason has to be true of the machine it is
  // given on: Firefox quits with Control+Q on Linux and with Control+Shift+Q
  // on Windows, so one row for both gives a Windows user a false reason.
  exactly(LINUX, [keyPress('KeyQ', { control: true })], 'Firefox quits with it on Linux.'),
  exactly(
    DESKTOP,
    [keyPress('KeyQ', { control: true, shift: true })],
    'Firefox on Windows, and Chrome on Windows and Linux, quit with it.',
  ),
  exactly(
    DESKTOP,
    [keyPress('F4', { alt: true })],
    'The operating system closes the window with it.',
  ),
  exactly(
    WINDOWS,
    [keyPress('Escape', { control: true, shift: true })],
    'Windows opens its Task Manager with it.',
  ),
  exactly(
    WINDOWS,
    [keyPress('Space', { alt: true }), keyPress('Escape', { control: true })],
    "Windows opens the window's menu, or the Start menu, with it.",
  ),
  // What the system itself keeps, which no page is sent: the secure sign-in
  // sequence, the switchers, and the screenshot keys on Windows; the window
  // menu, the run dialogue, the log-out dialogue, the consoles, the screenshot
  // key, the terminal and the lock on the Linux desktops. The recorder cannot
  // capture most of these, and a profile carried in from another machine could
  // bind them.
  exactly(
    WINDOWS,
    [
      keyPress('Delete', { control: true, alt: true }),
      keyPress('Escape', { alt: true }),
      keyPress('Tab', { control: true, alt: true }),
      ...withEach(['PrintScreen'], [{}, { alt: true }]),
    ],
    'Windows keeps it for itself: the security screen, switching windows, or a screenshot.',
  ),
  exactly(
    WINDOWS,
    [keyPress('PrintScreen', { alt: true, shift: true })],
    'Windows turns high contrast on and off with it.',
  ),
  exactly(
    WINDOWS,
    [keyPress('Space', { control: true }), keyPress('Backquote', { alt: true })],
    'Windows switches an East Asian input method with it, where one is installed.',
  ),
  // fcitx and fcitx5, the input methods most East Asian users of a Linux
  // desktop type with, switch on Control+Space as Windows' do. GNOME's own
  // switcher is Super+Space, so a stock GNOME session leaves this press alone
  // and the reason says "may" rather than "does".
  exactly(
    LINUX,
    [keyPress('Space', { control: true })],
    'An input method may switch with it, where one is installed.',
  ),
  exactly(
    LINUX,
    [
      keyPress('Space', { alt: true }),
      keyPress('F2', { alt: true }),
      keyPress('Delete', { control: true, alt: true }),
      ...withEach(['ArrowLeft', 'ArrowRight'], [{ control: true, alt: true }]),
      ...withEach(
        Array.from({ length: 12 }, (_, index) => `F${String(index + 1)}`),
        [{ control: true, alt: true }],
      ),
    ],
    "Your desktop may keep it for itself: the window's menu, running a command, logging out, or another workspace or console.",
  ),
  exactly(
    LINUX,
    [
      // GNOME and KDE both take the screenshot key, with Shift and Alt as well.
      ...withEach(['PrintScreen'], [{}, { shift: true }, { alt: true }]),
      ...withEach(['KeyT', 'KeyL'], [{ control: true, alt: true }]),
    ],
    'Your desktop may keep it for itself: a screenshot, a terminal, or locking the screen.',
  ),
  exactly(
    LINUX,
    [
      // GNOME: the windows of one application, and moving, resizing or
      // maximising a window. KDE: the window menu, and system activity.
      keyPress('Backquote', { alt: true }),
      ...withEach(['F3', 'F5', 'F7', 'F8', 'F10'], [{ alt: true }]),
      keyPress('Escape', { control: true }),
    ],
    "Your desktop may keep it for itself: a window's own menu, moving, sizing or restoring it, or its list of activity.",
  ),
  exactly(
    LINUX,
    [
      // GNOME: the groups of one application's windows, every window, the
      // panels, and the workspaces above and below. KDE: the desktops.
      ...withEach(['F6', 'Escape'], [{ alt: true }]),
      keyPress('Tab', { control: true, alt: true }),
      ...withEach(['ArrowUp', 'ArrowDown'], [{ control: true, alt: true }]),
      ...withEach(['F1', 'F2', 'F3', 'F4'], [{ control: true }]),
    ],
    'Your desktop may keep it for itself: moving between windows, panels, workspaces or desktops.',
  ),
  exactly(
    LINUX,
    // KDE: the application launcher, and the cursor that closes a window by force.
    [keyPress('F1', { alt: true }), keyPress('Escape', { control: true, alt: true })],
    'Your desktop may keep it for itself: its launcher, or closing a window by force.',
  ),
  exactly(
    DESKTOP,
    withEach(['KeyT'], [{ control: true }, { control: true, shift: true }]),
    'The browser opens a tab, or reopens the last one closed, with it.',
  ),
  exactly(
    DESKTOP,
    withEach(['KeyN'], [{ control: true }, { control: true, shift: true }]),
    'The browser opens a window, or a private one, with it.',
  ),
  exactly(
    DESKTOP,
    withEach(['Tab'], [{ alt: true }, { alt: true, shift: true }]),
    'The operating system moves between applications with it.',
  ),

  // Firefox's private window. Firefox handles it in the browser and never
  // delivers it to the page, so a shortcut bound to it would do nothing at all
  // on one of the four browsers AudioGubbins supports. A test that presses a
  // key through the automation driver cannot see this, because the driver
  // injects into the page the browser would have kept the key from.
  exactly(
    DESKTOP,
    [keyPress('KeyP', { control: true, shift: true })],
    'Firefox opens a private window with it.',
  ),

  // The third kind: presses that reach the page and that a reader relies on
  // the browser for. The zoom in is written Ctrl+Plus, which on most layouts
  // is the Equal key with Shift held, and both browsers bind the zoom out
  // with Shift as well, Chromium as Control+Shift+Minus and Firefox as the
  // underscore, so both keys are kept with Shift and without, and the
  // keypad's keys have codes of their own.
  exactly(
    DESKTOP,
    [keyPress('KeyL', { control: true }), keyPress('KeyD', { alt: true }), keyPress('F6')],
    TO_THE_ADDRESS_BAR,
  ),
  exactly(
    DESKTOP,
    [
      ...withEach(['Equal', 'Minus'], [{ control: true }, { control: true, shift: true }]),
      keyPress('Digit0', { control: true }),
      ...withEach(['NumpadAdd', 'NumpadSubtract', 'Numpad0'], [{ control: true }]),
    ],
    ZOOMS_THE_PAGE,
  ),
  exactly(DESKTOP, [keyPress('F11')], FILLS_THE_SCREEN),

  {
    conventions: DESKTOP,
    matches: (press) => press.meta,
    reason: 'The operating system may keep a combination with the Windows or Super key for itself.',
  },

  exactly(
    APPLE,
    withEach(['KeyW'], [{ meta: true }, { meta: true, shift: true }]),
    'The browser closes the tab or the window with it.',
  ),
  exactly(
    APPLE,
    withEach(['KeyT'], [{ meta: true }, { meta: true, shift: true }]),
    'The browser opens a tab, or reopens the last one closed, with it.',
  ),
  exactly(
    APPLE,
    withEach(['KeyN'], [{ meta: true }, { meta: true, shift: true }]),
    'The browser opens a window, or a private one, with it.',
  ),
  // The third kind, with Command.
  exactly(APPLE, [keyPress('KeyL', { meta: true })], TO_THE_ADDRESS_BAR),
  exactly(
    APPLE,
    [
      ...withEach(['Equal', 'Minus'], [{ meta: true }, { meta: true, shift: true }]),
      keyPress('Digit0', { meta: true }),
      ...withEach(['NumpadAdd', 'NumpadSubtract', 'Numpad0'], [{ meta: true }]),
    ],
    ZOOMS_THE_PAGE,
  ),
  exactly(
    APPLE,
    withEach(['KeyQ', 'KeyH', 'KeyM', 'Tab'], [{ meta: true }]),
    'macOS quits, hides, minimises or leaves the browser with it.',
  ),

  exactly(
    APPLE,
    [
      ...withEach(['BracketLeft', 'BracketRight'], [{ meta: true, shift: true }]),
      ...withEach(['ArrowLeft', 'ArrowRight'], [{ meta: true, alt: true }]),
    ],
    'The browser moves between its tabs with it.',
  ),
  exactly(
    APPLE,
    [keyPress('KeyF', { meta: true, control: true })],
    'macOS fills the screen with it.',
  ),
  exactly(APPLE, [keyPress('Space', { meta: true })], 'macOS opens Spotlight with it.'),
  exactly(
    APPLE,
    [
      keyPress('Tab', { meta: true, shift: true }),
      ...withEach(['Backquote'], [{ meta: true }, { meta: true, shift: true }]),
    ],
    'macOS moves between applications, or between their windows, with it.',
  ),
  exactly(
    APPLE,
    [keyPress('Escape', { meta: true, alt: true })],
    'macOS opens Force Quit with it.',
  ),
  exactly(
    APPLE,
    [
      ...withEach(['Digit3', 'Digit4', 'Digit5', 'Digit6'], [{ meta: true, shift: true }]),
      // The same, to the clipboard rather than to a file.
      ...withEach(['Digit3', 'Digit4'], [{ meta: true, shift: true, control: true }]),
    ],
    'macOS takes a screenshot with it.',
  ),
  exactly(
    APPLE,
    [keyPress('KeyD', { meta: true, alt: true })],
    'macOS shows and hides the Dock with it.',
  ),
  exactly(
    APPLE,
    [keyPress('KeyQ', { meta: true, control: true })],
    'macOS locks the screen with it.',
  ),
  exactly(APPLE, [keyPress('KeyQ', { meta: true, shift: true })], 'macOS logs out with it.'),
  exactly(
    APPLE,
    withEach(['KeyH', 'KeyM'], [{ meta: true, alt: true }]),
    "macOS hides the other applications, or minimises all of the browser's windows, with it.",
  ),
  exactly(
    APPLE,
    [keyPress('Space', { meta: true, alt: true })],
    'macOS opens a Finder search with it.',
  ),
  exactly(
    APPLE,
    withEach(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], [{ control: true }]),
    'macOS moves between spaces, or shows Mission Control, with it.',
  ),
  exactly(
    APPLE,
    [keyPress('Space', { control: true })],
    'macOS switches the input source with it.',
  ),
  exactly(
    APPLE,
    [keyPress('Space', { control: true, meta: true })],
    'macOS opens its emoji and symbols with it.',
  ),
  exactly(
    APPLE,
    [keyPress('KeyP', { meta: true, shift: true })],
    'Firefox opens a private window with it.',
  ),
];
