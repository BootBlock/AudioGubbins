/**
 * Keyboard shortcuts: chords, profiles, conflicts and how they are written
 * down.
 *
 * REQ-UX-066 requires a coherent default profile, full remapping, single keys,
 * modifier combinations, multi-key chords, named profiles, import and export,
 * reset to defaults, conflict detection, search, platform-specific
 * representation, and display in menus and command search. It also requires
 * that browser and operating-system reserved shortcuts are handled deliberately
 * rather than bound and silently swallowed by the browser; those are
 * `platform-reservations.ts`, and changing a profile is `profile-editing.ts`.
 *
 * Nothing here touches a keyboard event. This package is compiled without the
 * DOM type definitions. A `KeyboardEvent` is translated into a {@link KeyPress}
 * at the edge, which keeps chord matching, conflict detection and profile
 * handling testable without a browser and without synthesising events.
 */

import {
  keyNameOn,
  keyPress,
  keyPressesMatch,
  type KeyPress,
  type KeyboardLayout,
  type KeyboardPlatform,
} from '@audiogubbins/input';

import type { CommandId } from './command.js';

/**
 * A shortcut: one key press, or a sequence of them.
 *
 * A sequence is a chord, for example Ctrl+K followed by Ctrl+T. Chords give a
 * large command set memorable bindings without exhausting the modifier
 * combinations, which matters for an editor with a command palette full of
 * actions.
 */
export interface Shortcut {
  readonly presses: readonly [KeyPress, ...KeyPress[]];
}

/** Builds a shortcut from one or more presses. */
export function shortcut(first: KeyPress, ...rest: readonly KeyPress[]): Shortcut {
  return { presses: [first, ...rest] };
}

/** Whether two shortcuts are the same sequence. */
export function shortcutsMatch(left: Shortcut, right: Shortcut): boolean {
  return (
    left.presses.length === right.presses.length &&
    left.presses.every((press, index) => {
      const other = right.presses[index];
      return other !== undefined && keyPressesMatch(press, other);
    })
  );
}

/**
 * A stable text form of a shortcut, used as a map key and in a saved profile.
 *
 * Not for display: it is deliberately unambiguous rather than readable, so that
 * two shortcuts are equal exactly when their keys are equal.
 */
export function shortcutKey(value: Shortcut): string {
  return value.presses
    .map(
      (press) =>
        `${press.control ? 'C' : ''}${press.shift ? 'S' : ''}${press.alt ? 'A' : ''}${press.meta ? 'M' : ''}+${press.key}`,
    )
    .join(' ');
}

/** Which conventions to use when writing a shortcut out for a person to read. */
export const KeyboardConvention = {
  /** Ctrl, Alt, Shift, Win. */
  Windows: 'windows',

  /** The Apple symbols, in their conventional order. */
  Apple: 'apple',

  /** Ctrl, Alt, Shift, Super. */
  Linux: 'linux',
} as const;

/** Which conventions to use when writing a shortcut out for a person to read. */
export type KeyboardConvention = (typeof KeyboardConvention)[keyof typeof KeyboardConvention];

/** How each modifier is written, and in what order, under each convention. */
const MODIFIER_STYLE: Record<
  KeyboardConvention,
  {
    readonly control: string;
    readonly alt: string;
    readonly shift: string;
    readonly meta: string;
    readonly separator: string;
  }
> = {
  [KeyboardConvention.Windows]: {
    control: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Win',
    separator: '+',
  },
  [KeyboardConvention.Apple]: {
    control: '⌃',
    alt: '⌥',
    shift: '⇧',
    meta: '⌘',
    separator: '',
  },
  [KeyboardConvention.Linux]: {
    control: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Super',
    separator: '+',
  },
};

/**
 * Key codes whose conventional name differs from the code.
 *
 * The arrows are words rather than glyphs. Every other non-letter key here is a
 * word, and a written shortcut is drawn as plain text inside a menu entry, so
 * it becomes part of the entry's accessible name: whether a screen reader
 * speaks an arrow glyph at all depends on its symbol-verbosity setting and its
 * locale dictionary, and several say nothing at the default. Written as glyphs,
 * "Make the workspace brighter Ctrl+K, Ctrl+" would be where the entry stopped,
 * since two shipped defaults are on the arrow keys.
 */
const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Delete: 'Del',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
};

/**
 * The readable name of one key: the character the user's layout types on it,
 * when that is known and is one a keycap shows, and otherwise its US name. A
 * label read from the US name alone would tell a Dvorak user to press K for the
 * key their keyboard calls V.
 */
function keyLabel(press: KeyPress, layout: KeyboardLayout): string {
  const typed = keyNameOn(press, layout);
  if (typed !== undefined) return typed;
  const code = press.key;
  const named = KEY_LABELS[code];
  if (named !== undefined) return named;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Numpad ${code.slice(6)}`;
  return code;
}

/**
 * A key whose label is the character the convention joins presses with, braced
 * so the two can be told apart.
 *
 * German, Spanish, Italian and the Nordic layouts type `+` on a key of its own,
 * and Windows and Linux join presses with `+`, so unbraced, a binding on that
 * key would be written `Ctrl++` in the binding list, in the recorder and in a
 * refusal, which is correct and reads as a typo.
 */
function labelApart(label: string, separator: string): string {
  return label === separator ? `[${label}]` : label;
}

/**
 * Writes a shortcut the way the platform's users expect to read it.
 *
 * REQ-UX-066 requires platform-specific representation. Apple keyboards put the
 * modifiers in a fixed symbolic order with no separator; Windows and Linux
 * spell them out and join them with a plus. Showing Apple users "Ctrl+S" for a
 * shortcut they press with Command is an instruction that does not work.
 */
export function describeShortcut(
  value: Shortcut,
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): string {
  const style = MODIFIER_STYLE[convention];

  return value.presses
    .map((press) => {
      const parts: string[] = [];
      // Apple's published order is Control, Option, Shift, Command. The other
      // conventions have no fixed order; this one reads the same everywhere.
      if (press.control) parts.push(style.control);
      if (press.alt) parts.push(style.alt);
      if (press.shift) parts.push(style.shift);
      if (press.meta) parts.push(style.meta);
      parts.push(labelApart(keyLabel(press, layout), style.separator));
      return parts.join(style.separator);
    })
    .join(', ');
}

/**
 * Writes the presses of a chord as `describeShortcut` does, or answers
 * `undefined` while there are none: a chord still being pressed, which the
 * status bar shows and a screen reader is told.
 */
export function describePresses(
  presses: readonly KeyPress[],
  convention: KeyboardConvention,
  layout: KeyboardLayout,
): string | undefined {
  const [first, ...rest] = presses;
  return first === undefined
    ? undefined
    : describeShortcut({ presses: [first, ...rest] }, convention, layout);
}

/**
 * The modifier a platform's users reach for first.
 *
 * REQ-UX-066 requires platform-specific representation, and representation is
 * only half of it: a Mac user presses Command where a Windows user presses
 * Control, and a profile that binds Control everywhere is wrong on Apple
 * hardware rather than merely written down oddly. The shipped profile is built
 * from this, so every binding that means "the usual modifier" resolves to the
 * one the platform actually uses.
 */
export const PrimaryModifier = {
  Control: 'control',
  Meta: 'meta',
} as const;

/** The modifier a platform's users reach for first. */
export type PrimaryModifier = (typeof PrimaryModifier)[keyof typeof PrimaryModifier];

/** Which modifier this platform conventionally uses for an application shortcut. */
export function primaryModifierFor(convention: KeyboardConvention): PrimaryModifier {
  return convention === KeyboardConvention.Apple ? PrimaryModifier.Meta : PrimaryModifier.Control;
}

/**
 * How a platform's keyboard uses AltGr, for reading a key event.
 *
 * Apple hardware makes shortcuts with Option, which some engines report as
 * AltGr; everywhere else AltGr is how a layout types a character.
 */
export function keyboardPlatformFor(convention: KeyboardConvention): KeyboardPlatform {
  const apple = convention === KeyboardConvention.Apple;
  return { altGraphIsTyping: !apple, optionTypesInAField: apple };
}

/**
 * A key press using the platform's usual modifier.
 *
 * The other modifiers are stated as normal. Only the primary one is decided by
 * the platform, because it is the only one whose convention differs: Shift and
 * Alt mean the same thing everywhere.
 */
export function primaryPress(
  key: string,
  primary: PrimaryModifier,
  modifiers: Partial<Pick<KeyPress, 'shift' | 'alt'>> = {},
): KeyPress {
  return keyPress(key, {
    ...modifiers,
    control: primary === PrimaryModifier.Control,
    meta: primary === PrimaryModifier.Meta,
  });
}

/** A named set of bindings. */
export interface ShortcutProfile {
  /** Stable identifier, for example `default` or a generated one for a custom profile. */
  readonly id: string;

  /** British-English name the user sees and may change. */
  readonly displayName: string;

  /** Whether this profile ships with AudioGubbins and cannot be deleted. */
  readonly builtIn: boolean;

  /** What each command is bound to. A command may have several bindings. */
  readonly bindings: readonly ShortcutBinding[];
}

/** One binding of a shortcut to a command. */
export interface ShortcutBinding {
  readonly commandId: CommandId;
  readonly shortcut: Shortcut;
}

/**
 * Two or more commands bound to the same shortcut.
 *
 * REQ-UX-066 requires conflict detection. A silent conflict means one of the
 * two commands stops responding, and the user has no way to discover which
 * binding took it.
 */
export interface ShortcutConflict {
  readonly shortcut: Shortcut;
  readonly commandIds: readonly [CommandId, CommandId, ...CommandId[]];
}

/**
 * Every conflict in a profile.
 *
 * A prefix conflict counts: binding Ctrl+K and also Ctrl+K Ctrl+T means the
 * first fires before the second can be typed, so the chord is unreachable.
 */
export function findShortcutConflicts(profile: ShortcutProfile): readonly ShortcutConflict[] {
  const byKey = new Map<string, { shortcut: Shortcut; commandIds: CommandId[] }>();

  for (const binding of profile.bindings) {
    const key = shortcutKey(binding.shortcut);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { shortcut: binding.shortcut, commandIds: [binding.commandId] });
    } else if (!existing.commandIds.includes(binding.commandId)) {
      existing.commandIds.push(binding.commandId);
    }
  }

  const conflicts: ShortcutConflict[] = [];

  for (const entry of byKey.values()) {
    const [first, second, ...rest] = entry.commandIds;
    if (first !== undefined && second !== undefined) {
      conflicts.push({ shortcut: entry.shortcut, commandIds: [first, second, ...rest] });
    }
  }

  // A binding that is a strict prefix of a longer one makes the longer one
  // unreachable, because the shorter one fires as soon as it is complete.
  for (const shorter of profile.bindings) {
    for (const longer of profile.bindings) {
      if (shorter === longer) continue;
      if (shorter.shortcut.presses.length >= longer.shortcut.presses.length) continue;
      if (shorter.commandId === longer.commandId) continue;

      const isPrefix = shorter.shortcut.presses.every((press, index) => {
        const other = longer.shortcut.presses[index];
        return other !== undefined && keyPressesMatch(press, other);
      });

      if (isPrefix) {
        conflicts.push({
          shortcut: longer.shortcut,
          commandIds: [shorter.commandId, longer.commandId],
        });
      }
    }
  }

  return conflicts;
}

/** Every binding for a command, so a menu can show what it responds to. */
export function bindingsFor(profile: ShortcutProfile, id: CommandId): readonly Shortcut[] {
  return profile.bindings
    .filter((binding) => binding.commandId === id)
    .map((binding) => binding.shortcut);
}

/** The command a completed shortcut runs, or `undefined`. */
export function commandForShortcut(
  profile: ShortcutProfile,
  value: Shortcut,
): CommandId | undefined {
  return profile.bindings.find((binding) => shortcutsMatch(binding.shortcut, value))?.commandId;
}

/**
 * Whether the presses so far could still complete a longer binding.
 *
 * The keyboard handler asks this to decide whether to wait for another press or
 * to give up and let the key through. Without it a chord's first press would
 * either be swallowed forever or never start a chord at all.
 */
export function isShortcutPrefix(profile: ShortcutProfile, pressed: readonly KeyPress[]): boolean {
  return profile.bindings.some(
    (binding) =>
      binding.shortcut.presses.length > pressed.length &&
      pressed.every((press, index) => {
        const other = binding.shortcut.presses[index];
        return other !== undefined && keyPressesMatch(press, other);
      }),
  );
}
