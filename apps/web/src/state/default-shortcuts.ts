/**
 * The shortcut profile AudioGubbins ships with.
 *
 * REQ-UX-066 asks for a strong, coherent default profile and says to prefer
 * familiar professional conventions over invented mappings where they can be
 * used safely. The qualification matters: a convention that the browser takes
 * first cannot be used safely, and binding it anyway produces a shortcut that
 * appears in the menu and then does something else entirely.
 *
 * Built for the platform rather than written down once. A Mac user presses
 * Command where a Windows user presses Control, so every binding that means
 * "the usual modifier" resolves to the one the platform actually uses. Control
 * everywhere would be wrong on Apple hardware rather than merely written down
 * oddly.
 *
 * Nothing here binds a shortcut the browser takes first, at any press of a
 * chord: the browser does not know a chord has started, so the second press is
 * as much its to take as the first. The rebinding path refuses those, and a
 * test reads every press of this profile on every platform, so the shipped
 * profile cannot quietly include a shortcut that never fires.
 *
 * The editor's keys are pressed alone, or with Shift, as an audio editor's
 * are: arrows move the playhead and zoom, and a letter chooses a tool. A key
 * pressed alone is the shortcut's only outside a field one types in and a
 * control that uses the key itself (`use-shortcuts.ts`), and a screen reader
 * in browse mode keeps a letter for itself, which is why the editor's surface
 * is an application region, where the reader passes keys through.
 *
 * Every character here is a letter, or the comma. A layout that types Latin
 * letters types each of them with no modifier, and on one that types other
 * characters on those keys, as a Russian layout does, each goes to its US key,
 * which is where a browser reads it there. A character a layout reaches only
 * with Shift is outside the model, so a default written as one would either
 * wait for a key nobody can press or land on whatever the US key types there, a
 * dead key among them.
 */

import {
  KeyboardConvention,
  PrimaryModifier,
  commandId,
  primaryModifierFor,
  primaryPress,
  shortcut,
  type CommandId,
  type Shortcut,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import { keyPress, placeFor, type KeyPress, type KeyboardLayout } from '@audiogubbins/input';

/** The identifier of the profile AudioGubbins ships with. */
export const DEFAULT_PROFILE_ID = 'default';

/**
 * Builds the default bindings for a platform and a keyboard layout.
 *
 * The chord prefix is the primary modifier with K, following the convention
 * that a prefix opens a family of related actions. Workspace and appearance
 * actions sit behind it because they are used deliberately rather than
 * reflexively, and a single key each would spend the small supply of unmodified
 * shortcuts on something rare.
 *
 * Each binding is written as the character it is pressed with, and goes on the
 * key that types that character on the user's layout: the browser takes its own
 * shortcuts by the character, and written at US key positions, the profile
 * would put the prefix on Ctrl+T on Dvorak and the settings shortcut on Ctrl+W,
 * which closes the tab. A binding whose key is not known yet, because the US
 * key is known to type something else, is left out until the layout shows where
 * its character is (see `placeDefaults`).
 */
export function defaultShortcutProfile(
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): ShortcutProfile {
  return placeDefaults(convention, layout).profile;
}

/** The default profile on a layout, and each default it cannot place yet. */
export interface DefaultPlacement {
  /** The defaults whose keys are known. */
  readonly profile: ShortcutProfile;

  /**
   * Each command whose default is left out, with the characters whose keys it
   * waits for. Said rather than only left out: a default that went from the
   * menus and the settings with no reason given would look removed, and would
   * come back only once the user happened to type its character.
   */
  readonly waiting: ReadonlyMap<CommandId, readonly string[]>;

  /**
   * Each command whose default waits for a press made with Command.
   *
   * The key its character sits on is known; which of the two layers the system
   * reads a Command press by is not ({@link placeFor}). Pressing that key would
   * teach nothing, so these are said apart from the rest: told to press it and
   * seeing nothing happen, a user would have no way on.
   *
   * Which command waits, and no more. One qualifying press settles the reading
   * for every one of them at once, and a default's own character need not sit
   * on a key that can make one: the settings default is written as a comma, and
   * a comma is not a letter. Which key ends the wait is the layout's to answer
   * (`commandLayerKeys` in the input package), not this list's.
   */
  readonly waitingForCommandLayer: ReadonlySet<CommandId>;
}

/** Places the defaults on a layout, as `defaultShortcutProfile` describes. */
export function placeDefaults(
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): DefaultPlacement {
  const primary: PrimaryModifier = primaryModifierFor(convention);
  const apple = convention === KeyboardConvention.Apple;

  /** The characters whose place waits for a Command press rather than for a key. */
  const openUnderCommand = new Set<string>();

  /** The key typing a character with the platform's usual modifier, or the character while it is not known. */
  const primaryOn = (
    character: string,
    modifiers: Partial<Pick<KeyPress, 'shift' | 'alt'>> = {},
  ): KeyPress | string => {
    const command = primary === PrimaryModifier.Meta;
    const place = placeFor(character, layout, command ? 'command' : 'a modifier');
    if (place.key !== undefined) return primaryPress(place.key, primary, modifiers);
    if (place.waitsFor === 'the Command layer') openUnderCommand.add(character);
    return character;
  };

  /** The chord prefix every deliberate action sits behind. */
  const prefix = primaryOn('k');

  /**
   * A shortcut of the presses given, or the characters whose keys are not known
   * yet.
   *
   * The first press is its own parameter, so a chord of no presses cannot be
   * asked for, and no branch has to say what one would be. The presses are
   * split in one pass.
   */
  const of = (
    first: KeyPress | string,
    ...rest: readonly (KeyPress | string)[]
  ): Shortcut | readonly string[] => {
    const waitingFor = new Set<string>();
    const placed: KeyPress[] = [];
    if (typeof first === 'string') waitingFor.add(first);
    for (const press of rest) {
      if (typeof press === 'string') waitingFor.add(press);
      else placed.push(press);
    }

    if (typeof first === 'string' || waitingFor.size > 0) return [...waitingFor];
    return shortcut(first, ...placed);
  };

  const bindings: readonly {
    readonly commandId: CommandId;
    readonly shortcut: Shortcut | readonly string[];
  }[] = [
    {
      // Behind the prefix, because Ctrl+Shift+P and Command+Shift+P are
      // Firefox's private window: Firefox keeps them in the browser and the
      // page never sees them, so bound to them, the palette's own shortcut
      // would open nothing there. The menu shows this one beside the entry,
      // which is how a user finds it. The familiar combination stays refused on
      // every browser, because a profile does not know which browser will run
      // it; the refusal names Firefox, so a user on another browser knows why.
      commandId: commandId('view.command-palette'),
      shortcut: of(prefix, primaryOn('p')),
    },
    {
      // Command+comma is what every Mac application uses for its settings,
      // and Safari opens its own with it. Whether Safari's menu acts on it
      // before WebKit hands it to the page is not read, so it is no row of
      // the reservation table, but a default is placed without the user
      // asking, and one that did nothing on Safari would be found only by
      // pressing it. Apple hardware gets the shifted form instead, and a
      // user can rebind it to the conventional one.
      commandId: commandId('settings.open'),
      shortcut: of(primaryOn(',', apple ? { shift: true } : {})),
    },

    // Brightness, behind the prefix, on the arrow keys: up for brighter and
    // down for darker.
    //
    // Three other pairs fail, each for its own reason. `=` and `-`:
    // Ctrl+Shift+Equal and Ctrl+Minus are the browser's zoom, a layout types
    // neither without Shift, and on German and Swiss the key a US layout types
    // `=` on is a dead key, so the second press could never fire. Bare B and D:
    // a screen reader in browse mode keeps them for itself, as the next button
    // and the next landmark, and in a text field the letter would be typed and
    // the chord given up. The theme's own letters with Shift: reachable, but
    // Ctrl+K Ctrl+B is the light theme, so Ctrl+K Ctrl+Shift+B for Brighten
    // would keep the pair a user confuses a pair, told apart by the modifier a
    // user is likeliest to leave on or let go; and Ctrl+Shift+B and
    // Ctrl+Shift+D are the bookmarks bar and bookmark-every-tab in Chrome, Edge
    // and Firefox, which hand them to the page first: neither is in any
    // engine's set of presses it keeps from the page, as the reservation
    // table's header reads those sets.
    //
    // An arrow key answers all of it. It is the same key on every layout, so
    // it never waits and never moves; it types nothing in a field; it is
    // modified, so a screen reader passes it through; and up for brighter
    // needs no learning. No browser or system takes it *before the page* with
    // the usual modifier alone on any convention, which is the reservation
    // table's criterion and is what matters here. macOS does act on Command
    // with the arrows — scroll to top and bottom, and document start and end
    // inside a field — and is believed to deliver the press, which the chord
    // handler cancels on both the waiting press and the running one either
    // way.
    {
      commandId: commandId('view.brighten'),
      shortcut: of(prefix, primaryPress('ArrowUp', primary)),
    },
    {
      commandId: commandId('view.darken'),
      shortcut: of(prefix, primaryPress('ArrowDown', primary)),
    },

    // Workspace, behind the prefix. Switching is deliberately unbound: every
    // candidate second press is either a browser accelerator or a key that
    // passes through to a field while the user is typing, and the command is
    // one keystroke away in the Workspace menu. Anyone who wants a key for it
    // can bind one.
    { commandId: commandId('workspace.save-as'), shortcut: of(prefix, primaryOn('s')) },
    { commandId: commandId('workspace.reset'), shortcut: of(prefix, primaryOn('r')) },
    {
      // X, the mark a close button carries. W is the usual key and the browser
      // closes the tab with it, as the second press of a chord as much as on
      // its own: the prefix does not protect it, and bound to W, this would
      // close the user's tab.
      commandId: commandId('workspace.close-panel'),
      shortcut: of(prefix, primaryOn('x')),
    },

    // Theme, also behind the prefix: a user switches theme rarely and should
    // not be able to do it by accident while editing.
    { commandId: commandId('view.theme-dark'), shortcut: of(prefix, primaryOn('d')) },
    {
      // B, for bright. Control+L is kept for the browser, which moves to its
      // address bar with it, at any step of a chord.
      commandId: commandId('view.theme-light'),
      shortcut: of(prefix, primaryOn('b')),
    },

    {
      // Not Shift+F12, which is unreachable on an Apple laptop and on most
      // Chromebooks, where the function row needs a second modifier of its own.
      commandId: commandId('help.start-diagnostic-mode'),
      shortcut: of(prefix, primaryOn('g')),
    },
    ...editorBindings(of, layout, primaryOn, (key) => primaryPress(key, primary)),
  ];

  const waiting = new Map<CommandId, readonly string[]>();
  const waitingForCommandLayer = new Set<CommandId>();
  const placed: { readonly commandId: CommandId; readonly shortcut: Shortcut }[] = [];
  for (const binding of bindings) {
    if (isPlaced(binding.shortcut)) {
      placed.push({ ...binding, shortcut: binding.shortcut });
      continue;
    }
    const forAKey = binding.shortcut.filter((character) => !openUnderCommand.has(character));
    const forTheLayer = binding.shortcut.filter((character) => openUnderCommand.has(character));
    if (forAKey.length > 0) waiting.set(binding.commandId, forAKey);
    if (forTheLayer.length > 0) waitingForCommandLayer.add(binding.commandId);
  }

  return {
    profile: {
      id: DEFAULT_PROFILE_ID,
      displayName: 'AudioGubbins default',
      builtIn: true,
      bindings: placed,
    },
    waiting,
    waitingForCommandLayer,
  };
}

/**
 * The editor's defaults. Up and down zoom, as a vertical move of a timeline
 * does in most editors; left and right move the playhead a pixel, a sample
 * with the usual modifier, and extend the selection by a sample with Shift.
 * The tools are the letters their names or their habits give: V selects, R
 * selects a range of time, H is the hand, Z zooms, C cuts with the razor and N
 * places markers; M adds a marker at the playhead, as in most editors.
 */
function editorBindings(
  of: (
    first: KeyPress | string,
    ...rest: readonly (KeyPress | string)[]
  ) => Shortcut | readonly string[],
  layout: KeyboardLayout,
  primaryOn: (character: string) => KeyPress | string,
  withPrimary: (key: string) => KeyPress,
): readonly { readonly commandId: CommandId; readonly shortcut: Shortcut | readonly string[] }[] {
  /** The key typing a character pressed alone, or with Shift, or the character while it is not known. */
  const alone = (character: string, shift = false): KeyPress | string => {
    const place = placeFor(character, layout, 'nothing');
    return place.key === undefined ? character : keyPress(place.key, { shift });
  };
  /** A named key, the same on every layout, pressed alone or with Shift. */
  const named = (key: string, shift = false): KeyPress => keyPress(key, { shift });
  const bind = (id: string, shortcut: Shortcut | readonly string[]) => ({
    commandId: commandId(id),
    shortcut,
  });
  return [
    bind('editor.zoom-in', of(named('ArrowUp'))),
    bind('editor.zoom-out', of(named('ArrowDown'))),
    bind('editor.zoom-to-fit', of(alone('f'))),
    bind('editor.zoom-to-selection', of(alone('f', true))),
    bind('editor.playhead-back-pixel', of(named('ArrowLeft'))),
    bind('editor.playhead-forward-pixel', of(named('ArrowRight'))),
    bind('editor.playhead-back-sample', of(withPrimary('ArrowLeft'))),
    bind('editor.playhead-forward-sample', of(withPrimary('ArrowRight'))),
    bind('editor.extend-selection-back', of(named('ArrowLeft', true))),
    bind('editor.extend-selection-forward', of(named('ArrowRight', true))),
    bind('editor.playhead-to-start', of(named('Home'))),
    bind('editor.playhead-to-end', of(named('End'))),
    bind('editor.scroll-back', of(named('PageUp'))),
    bind('editor.scroll-forward', of(named('PageDown'))),
    bind('editor.tool-select', of(alone('v'))),
    bind('editor.tool-time-select', of(alone('r'))),
    bind('editor.tool-hand', of(alone('h'))),
    bind('editor.tool-zoom', of(alone('z'))),
    bind('editor.tool-razor', of(alone('c'))),
    bind('editor.tool-marker', of(alone('n'))),
    bind('editor.add-marker', of(alone('m'))),
    bind('editor.remove-markers', of(named('Delete'))),
    bind('editor.select-all', of(primaryOn('a'))),
    // D, for deselect, as image and audio editors have it; the bookmark the
    // browser makes with it is handed to the page first.
    bind('editor.clear-selection', of(primaryOn('d'))),
    bind('editor.toggle-snapping', of(alone('s'))),
    bind('editor.next-display-mode', of(alone('d'))),
    bind('editor.show-all-channels', of(alone('l'))),
  ];
}

/** Whether a default was placed, rather than left waiting for characters. */
function isPlaced(shortcut: Shortcut | readonly string[]): shortcut is Shortcut {
  return !Array.isArray(shortcut);
}
