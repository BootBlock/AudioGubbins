import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AVAILABLE,
  CommandCategory,
  KeyboardConvention,
  commandId,
  createChordTracker,
  createCommandBus,
  createCommandRegistry,
  keyboardPlatformFor,
  shortcut,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { keyPress } from '@audiogubbins/input';

import { buildLayoutStore } from '../testing/layout-store.js';
import { buildShellContext } from '../testing/shell-context.js';
import { isTextField, ownsItsKeys, useShortcuts } from './use-shortcuts.js';

/**
 * The edge that turns a key event into a command.
 *
 * Driven here: without these, making it read AltGr as never held would bring
 * back a German user's backslash running Ctrl+Alt+Minus, and every other test
 * would stay green.
 */

afterEach(() => {
  document.body.replaceChildren();
});

/** A key event dispatched at an element, as a browser would send it. */
function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** A text field in the document, for the typing cases. */
function field(): HTMLInputElement {
  const input = document.createElement('input');
  document.body.append(input);
  return input;
}

describe('isTextField', () => {
  it('knows a field from anything else', () => {
    const button = document.createElement('button');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(button, editable);

    expect(isTextField(field())).toBe(true);
    expect(isTextField(document.createElement('textarea'))).toBe(true);
    expect(isTextField(button)).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe('useShortcuts', () => {
  /** Each chord the listener gave up, since the last listener was made. */
  let cancelled: string[] = [];

  /** Each key the listener read, as its code and what the layout typed. */
  let read: string[] = [];

  /**
   * A listener over a profile binding Ctrl+Alt+Minus, Option+B and Ctrl+K
   * Ctrl+X, counting what ran.
   */
  function listening(convention: KeyboardConvention) {
    const ran: string[] = [];
    cancelled = [];
    read = [];
    const registry = createCommandRegistry<null>();
    for (const id of ['test.minus', 'test.option-b', 'test.chord']) {
      registry.register({
        id: commandId(id),
        label: id,
        category: CommandCategory.View,
        undoable: false,
        availability: () => AVAILABLE,
        run: () => {
          ran.push(id);
          return { kind: 'applied', next: null };
        },
      });
    }
    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    const bus = createCommandBus(registry, logger);
    const profile: ShortcutProfile = {
      id: 'test',
      displayName: 'Test',
      builtIn: true,
      bindings: [
        {
          commandId: commandId('test.minus'),
          shortcut: shortcut(keyPress('Minus', { control: true, alt: true })),
        },
        {
          commandId: commandId('test.option-b'),
          shortcut: shortcut(keyPress('KeyB', { alt: true })),
        },
        {
          commandId: commandId('test.chord'),
          shortcut: shortcut(
            keyPress('KeyK', { control: true }),
            keyPress('KeyX', { control: true }),
          ),
        },
      ],
    };

    renderHook(() => {
      useShortcuts({
        tracker: createChordTracker(() => profile),
        run: (id) => {
          bus.execute(null, { commandId: id });
        },
        onPendingChange: vi.fn(),
        onAnnounce: vi.fn(),
        onChordCancelled: () => {
          cancelled.push('cancelled');
        },
        platform: keyboardPlatformFor(convention),
        reader: {
          read: (reading) => {
            read.push(`${reading.code}:${reading.key}`);
          },
          asked: () => false,
        },
        logger,
      });
    });
    return ran;
  }

  it('lets a German user type a backslash with AltGr, rather than running Ctrl+Alt+Minus', () => {
    const ran = listening(KeyboardConvention.Windows);

    const event = press(field(), {
      key: '\\',
      code: 'Minus',
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });

    expect(ran).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not run Ctrl+Alt+Minus for AltGr outside a field either', () => {
    // The field's own check would catch the press above; this is the listener's.
    const ran = listening(KeyboardConvention.Windows);

    press(document.body, {
      key: '\\',
      code: 'Minus',
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });

    expect(ran).toEqual([]);
  });

  it('runs Ctrl+Alt+Minus when it is pressed without AltGr', () => {
    const ran = listening(KeyboardConvention.Windows);

    press(document.body, { key: '-', code: 'Minus', ctrlKey: true, altKey: true });

    expect(ran).toEqual(['test.minus']);
  });

  it('runs an Option shortcut on Apple hardware, where an engine reports Option as AltGr', () => {
    const ran = listening(KeyboardConvention.Apple);

    press(document.body, { key: '∫', code: 'KeyB', altKey: true, modifierAltGraph: true });

    expect(ran).toEqual(['test.option-b']);
  });

  it('leaves an Option press in a field to type its character, reported as AltGr or not', () => {
    // Chromium and WebKit on macOS report Option as Alt alone. Only a press the
    // engine reported as AltGr was left to the field, so on those engines a
    // bound Option press took the character the user was typing.
    const ran = listening(KeyboardConvention.Apple);

    const asAlt = press(field(), { key: '∫', code: 'KeyB', altKey: true });
    const asAltGr = press(field(), {
      key: '∫',
      code: 'KeyB',
      altKey: true,
      modifierAltGraph: true,
    });

    expect(ran).toEqual([]);
    expect(asAlt.defaultPrevented).toBe(false);
    expect(asAltGr.defaultPrevented).toBe(false);
  });

  it('hands every key it reads to the layout, typing in a field included', () => {
    // What the user's layout types is learned from what they press, so a key
    // typed into a field teaches it as much as a shortcut does.
    listening(KeyboardConvention.Windows);

    press(field(), { code: 'KeyK', key: 't' });
    press(document.body, { code: 'Comma', key: 'w', ctrlKey: true });

    expect(read).toEqual(['KeyK:t', 'Comma:w']);
  });

  it('gives up a chord in progress when the user types into a field', () => {
    // It survived, so a user who pressed the prefix, clicked into a field and
    // typed a name completed a shortcut with the Ctrl+X they meant as cut.
    const ran = listening(KeyboardConvention.Windows);
    const input = field();

    press(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    press(input, { key: 'a', code: 'KeyA' });
    press(input, { key: 'x', code: 'KeyX', ctrlKey: true });

    expect(ran).toEqual([]);
    expect(cancelled).toEqual(['cancelled']);
  });

  it('says the chord is given up when Escape abandons it', () => {
    listening(KeyboardConvention.Windows);

    press(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    press(document.body, { key: 'Escape', code: 'Escape' });

    expect(cancelled).toEqual(['cancelled']);
  });

  it('gives up a chord in progress when the window loses focus, without saying so', () => {
    // A user who pressed the prefix and switched away came back to a tracker
    // still waiting, and their next keystroke completed a shortcut they had
    // long forgotten starting. Nothing is said: the window is not in front.
    const ran = listening(KeyboardConvention.Windows);

    press(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    window.dispatchEvent(new Event('blur'));
    press(document.body, { key: 'x', code: 'KeyX', ctrlKey: true });

    expect(ran).toEqual([]);
    expect(cancelled).toEqual([]);
  });

  it('runs a chord through the one voiced run it is given', () => {
    const ran = listening(KeyboardConvention.Windows);

    press(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    press(document.body, { key: 'x', code: 'KeyX', ctrlKey: true });

    expect(ran).toEqual(['test.chord']);
  });
});

describe('useShortcuts over the stores it is wired to', () => {
  it('lets the first Command+V through on a layout that switches under Command', () => {
    // "Dvorak – QWERTY ⌘": the key at V types K, so the chord prefix Command+K
    // was placed there, and the system reads that key with Command as V. The
    // press is learned from before it is matched, which moves the prefix off
    // the key, so the paste reaches the page.
    const layout = buildLayoutStore().store;
    layout.adopt([
      ['KeyV', 'k'],
      ['KeyR', 'p'],
    ]);
    const { context } = buildShellContext(undefined, KeyboardConvention.Apple, layout);
    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    const pending = vi.fn();
    renderHook(() => {
      useShortcuts({
        tracker: createChordTracker(() => context.shortcuts.get().usable),
        run: vi.fn(),
        onPendingChange: pending,
        onAnnounce: vi.fn(),
        onChordCancelled: vi.fn(),
        platform: keyboardPlatformFor(KeyboardConvention.Apple),
        reader: {
          read: layout.learn,
          asked: () => false,
        },
        logger,
      });
    });

    const pasted = press(document.body, { code: 'KeyV', key: 'v', metaKey: true });

    expect(pasted.defaultPrevented).toBe(false);
    expect(pending).not.toHaveBeenCalled();
  });

  it('keeps the browser from acting on a press the application asked the reader for', () => {
    // Bound to nothing, the press the settings ask for passed through, and
    // the browser acted on it: Command+I opens a window in Firefox.
    const { context } = buildShellContext(undefined, KeyboardConvention.Apple);
    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    renderHook(() => {
      useShortcuts({
        tracker: createChordTracker(() => context.shortcuts.get().usable),
        run: vi.fn(),
        onPendingChange: vi.fn(),
        onAnnounce: vi.fn(),
        onChordCancelled: vi.fn(),
        platform: keyboardPlatformFor(KeyboardConvention.Apple),
        reader: {
          read: vi.fn(),
          asked: (reading) => reading.code === 'KeyI',
        },
        logger,
      });
    });

    expect(press(document.body, { code: 'KeyI', key: 'c', metaKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(press(document.body, { code: 'KeyV', key: 'v', metaKey: true }).defaultPrevented).toBe(
      false,
    );
  });

  it('runs Brighten and Darken from a text field, and not the theme', () => {
    // Their second presses were bare letters: typed into the field, they gave
    // up the chord. Given the theme's own letters with Shift instead, they
    // stayed a pair with the theme, told apart by one modifier, and both were
    // browser accelerators. An arrow types nothing in a field.
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows);
    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('test');
    const ran: string[] = [];
    renderHook(() => {
      useShortcuts({
        tracker: createChordTracker(() => context.shortcuts.get().usable),
        run: (id) => {
          ran.push(id);
        },
        onPendingChange: vi.fn(),
        onAnnounce: vi.fn(),
        onChordCancelled: vi.fn(),
        platform: keyboardPlatformFor(KeyboardConvention.Windows),
        reader: {
          read: vi.fn(),
          asked: () => false,
        },
        logger,
      });
    });
    const input = field();

    for (const code of ['ArrowUp', 'ArrowDown'] as const) {
      press(input, { code: 'KeyK', key: 'k', ctrlKey: true });
      press(input, { code, key: code, ctrlKey: true });
    }

    expect(ran).toEqual(['view.brighten', 'view.darken']);

    // The theme's own letters are the theme, and brightness is nowhere near
    // them: the pair a user confused was told apart by one modifier.
    for (const [code, key] of [
      ['KeyB', 'b'],
      ['KeyD', 'd'],
    ] as const) {
      press(input, { code: 'KeyK', key: 'k', ctrlKey: true });
      press(input, { code, key, ctrlKey: true });
    }

    expect(ran).toEqual(['view.brighten', 'view.darken', 'view.theme-light', 'view.theme-dark']);
  });
});

describe('a key a focused control uses itself', () => {
  /** A reading of `code`, with the modifiers given. */
  const reading = (code: string, modifiers: { readonly ctrlKey?: boolean } = {}) => ({
    code,
    key: code,
    ctrlKey: modifiers.ctrlKey ?? false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    altGraph: false,
    composing: false,
    capsLock: false,
  });

  /** An element inside a new element of `role`, in the page. */
  function inside(role: string): HTMLElement {
    const holder = document.createElement('div');
    holder.setAttribute('role', role);
    const child = document.createElement('button');
    holder.append(child);
    document.body.append(holder);
    return child;
  }

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('is the control’s: an arrow in a toolbar, a letter in a menu', () => {
    expect(ownsItsKeys(inside('toolbar'), reading('ArrowLeft'))).toBe(true);
    expect(ownsItsKeys(inside('menu'), reading('KeyM'))).toBe(true);
    expect(ownsItsKeys(inside('slider'), reading('Home'))).toBe(true);
  });

  it('is a shortcut’s anywhere else, with a modifier, and for a letter in a toolbar', () => {
    expect(ownsItsKeys(document.body, reading('ArrowLeft'))).toBe(false);
    expect(ownsItsKeys(inside('menu'), reading('KeyA', { ctrlKey: true }))).toBe(false);
    expect(ownsItsKeys(inside('toolbar'), reading('KeyV'))).toBe(false);
  });
});
