import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { commandId, exportProfile, shortcut } from '@audiogubbins/commands';
import { keyPress } from '@audiogubbins/input';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { LOADING_TIME, loadTheApplication } from './testing/application-modules.js';
import { DVORAK } from './testing/keyboard-layouts.js';
import { everythingQueued } from './testing/waiting.js';

/**
 * The keyboard layout as the application is wired: taken from the browser's
 * layout map at the start, and learned from the keys the user types.
 *
 * Each part is tested alone elsewhere, the listener with its callback replaced
 * and the reader with a navigator made for it, so a shell that read no map, or
 * learned from no key, would pass those tests while it read every keyboard as a
 * US one.
 */

/** The browser's layout map, as Chromium gives it: here, only that K types T. */
function stubLayoutMap(pairs: readonly (readonly [string, string])[]): void {
  Object.defineProperty(window.navigator, 'keyboard', {
    configurable: true,
    value: { getLayoutMap: async () => await Promise.resolve(new Map(pairs)) },
  });
}

beforeAll(loadTheApplication, LOADING_TIME);

/** What takes down the application the test mounted. */
let unmount: (() => void) | undefined;

afterEach(() => {
  act(() => {
    unmount?.();
  });
  unmount = undefined;
  document.body.replaceChildren();
  window.localStorage.clear();
  Reflect.deleteProperty(window.navigator, 'keyboard');
  Reflect.deleteProperty(window.navigator, 'userAgentData');
});

/** What the Shortcuts settings list for a command. */
function rowOf(label: string): HTMLElement {
  const header = screen.getByRole('rowheader', { name: label });
  const row = header.closest('tr');
  if (row === null) throw new Error(`${label} has no row`);
  return row;
}

/** What the Shortcuts settings list for the command palette. */
function paletteRow(): HTMLElement {
  return rowOf('Show the command palette');
}

/** Mounts the application on a keyboard whose layout map says K types T, and opens the Shortcuts settings. */
async function mountOnDvorakAndOpenShortcuts(): Promise<void> {
  stubLayoutMap([['KeyK', 't']]);
  const { mount } = await import('./app.js');
  const container = document.createElement('div');
  document.body.append(container);
  await act(async () => {
    unmount = mount(container);
    await everythingQueued();
  });
  await act(async () => {
    fireEvent.keyDown(document.body, { code: 'Comma', key: ',', ctrlKey: true });
    await Promise.resolve();
  });
  await userEvent.click(await screen.findByRole('tab', { name: 'Shortcuts' }));
}

describe('the keyboard layout, as the application is wired', () => {
  it('reads the layout map at the start, learns a key the user types, and keeps the instruction out of the live region', async () => {
    // On Dvorak the key at K types T, so the chord prefix cannot go there, and
    // until the key that types K is known the palette has no default.
    await mountOnDvorakAndOpenShortcuts();
    expect(within(paletteRow()).getByText('None')).toBeInTheDocument();

    // Said, with the key it waits for: left out with no reason, the default
    // looked removed, and came back only once the user happened to type K.
    const waiting = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(waiting).toHaveTextContent(
      '9 default shortcuts have no key yet: AudioGubbins has not seen where your keyboard types their character.',
    );
    const [row, ...rest] = within(waiting).getAllByRole('listitem');
    expect(rest).toEqual([]);
    expect(row).toBeVisible();
    expect(row?.textContent).toMatch(/^The key that types "K": Show the command palette, /);

    // The instruction is read where it stands, not out of a live region. The
    // attribute used to be on the wrapper holding both lists, so each of the
    // keys the reader was asked to press changed a count, a paragraph and a
    // row, and the whole fifty-five-word instruction was read again before
    // they could press the next one.
    const said = [waiting, ...waiting.querySelectorAll('*')].filter((element) =>
      element.hasAttribute('aria-live'),
    );
    expect(said.length).toBeGreaterThan(0);
    for (const region of said) expect(region.textContent).not.toContain('Press');

    // Typing K, on the key a US keyboard has V on, teaches the layout where K
    // is, and the default goes there, named by what the key types.
    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'KeyV', key: 'k' });
      await Promise.resolve();
    });
    expect(paletteRow()).toHaveTextContent('Ctrl+K, Ctrl+P');

    // Nothing waits any more, and that is said where the list was: taken away
    // in silence, the last placement told a screen-reader user nothing. The
    // live region carries the progress alone — the instruction beside it is
    // there to be read once, and reading it again after every key the reader
    // was asked to press would be fifty-five words between each press.
    const done = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(done).toHaveTextContent('Every default shortcut now has a key on your keyboard.');
    expect(within(done).queryByRole('listitem')).toBeNull();

    // Every live region in the group, the group itself included: the
    // attribute used to be on the wrapper holding both lists, so the whole
    // instruction was read again after each key the reader was asked for.
    const regions = [done, ...done.querySelectorAll('*')].filter((element) =>
      element.hasAttribute('aria-live'),
    );
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) expect(region.textContent).not.toContain('Press');
  });

  it('learns a key pressed into the shortcut recorder, which takes each press from the page', async () => {
    // The recorder stops a press reaching the listener that learns every other
    // one, so it teaches the layout itself: wired to nothing, a key the user
    // pressed there taught nothing.
    await mountOnDvorakAndOpenShortcuts();
    expect(within(rowOf('Close this panel')).getByText('None')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Change the shortcut for Show the command palette' }),
    );
    await act(async () => {
      fireEvent.keyDown(
        screen.getByRole('textbox', { name: 'Shortcut for Show the command palette' }),
        {
          code: 'KeyV',
          key: 'k',
        },
      );
      await Promise.resolve();
    });

    expect(rowOf('Close this panel')).toHaveTextContent('Ctrl+K, Ctrl+X');
  });

  it('says, politely, that a shortcut saved again is already what the command has', async () => {
    // The recorder closes on Save, and a shortcut that was already the
    // command's closed it in silence. The recorder asks for that to be said,
    // and the settings and the application each pass the request on: dropped
    // at any of the three, the second Save said nothing, and no test failed.
    await mountOnDvorakAndOpenShortcuts();

    const recordOnce = async (): Promise<void> => {
      await userEvent.click(
        screen.getByRole('button', { name: 'Change the shortcut for Close this panel' }),
      );
      const field = screen.getByRole('textbox', { name: 'Shortcut for Close this panel' });
      await act(async () => {
        fireEvent.keyDown(field, { code: 'KeyY', key: 'f', ctrlKey: true, shiftKey: true });
        fireEvent.keyDown(field, { code: 'Escape', key: 'Escape' });
        await Promise.resolve();
      });
      await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    };

    await recordOnce();
    await recordOnce();

    const polite = screen.getAllByRole('status').map((region) => region.textContent);
    const urgent = screen.getAllByRole('alert').map((region) => region.textContent);
    expect(polite.some((text) => text.endsWith('is already its shortcut.'))).toBe(true);
    expect(urgent.some((text) => text.includes('is already its shortcut'))).toBe(false);
  });

  it('says why the defaults wait, on a browser that refuses its layout map', async () => {
    // Answered by whether the browser offered a map, a browser that refused it
    // was reported as giving one, and the wait was explained without its cause.
    Object.defineProperty(window.navigator, 'keyboard', {
      configurable: true,
      value: {
        getLayoutMap: async () => {
          await Promise.resolve();
          throw new DOMException('Refused.', 'SecurityError');
        },
      },
    });
    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      unmount = mount(container);
      await everythingQueued();
    });
    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'KeyK', key: 't' });
      fireEvent.keyDown(document.body, { code: 'Comma', key: ',', ctrlKey: true });
      await Promise.resolve();
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Shortcuts' }));

    expect(screen.getByRole('group', { name: 'Waiting for your keyboard' })).toHaveTextContent(
      'This browser does not tell AudioGubbins what your keyboard types on each key.',
    );
  });

  it('gives no cause for the wait while the browser is still being asked for its map', async () => {
    // A capability still being asked about is missing, with a reason that says
    // it is being asked: that is no cause of the wait, and read as one it told
    // the user AudioGubbins was still asking, in a note about their keyboard.
    Object.defineProperty(window.navigator, 'keyboard', {
      configurable: true,
      value: { getLayoutMap: () => new Promise(() => undefined) },
    });
    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      unmount = mount(container);
      await everythingQueued();
    });
    await act(async () => {
      fireEvent.keyDown(document.body, { code: 'KeyK', key: 't' });
      fireEvent.keyDown(document.body, { code: 'Comma', key: ',', ctrlKey: true });
      await Promise.resolve();
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Shortcuts' }));

    // The note is the instruction alone, with no cause after it, whatever the
    // registry says while it asks.
    const waiting = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(within(waiting).getByText(/no key yet/).textContent).toBe(
      '9 default shortcuts have no key yet: AudioGubbins has not seen where your keyboard types their character. Press the key named below once on its own, with Caps Lock off, anywhere in AudioGubbins, and they are placed.',
    );
  });

  it('says why the defaults wait, on a browser that gives no layout map', async () => {
    // The capability registry knows the map is missing; the settings did not
    // say so, and the wait was explained without its cause.
    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      unmount = mount(container);
      await everythingQueued();
    });
    await act(async () => {
      // Typed: the key at K is known to type T, so the chord defaults wait.
      fireEvent.keyDown(document.body, { code: 'KeyK', key: 't' });
      fireEvent.keyDown(document.body, { code: 'Comma', key: ',', ctrlKey: true });
      await Promise.resolve();
    });
    await userEvent.click(await screen.findByRole('tab', { name: 'Shortcuts' }));

    expect(screen.getByRole('group', { name: 'Waiting for your keyboard' })).toHaveTextContent(
      'This browser does not tell AudioGubbins what your keyboard types on each key.',
    );
  });

  /** Mounts the application on Apple hardware whose layout map is Dvorak's. */
  async function mountOnAppleDvorak(): Promise<void> {
    Object.defineProperty(window.navigator, 'userAgentData', {
      configurable: true,
      value: { platform: 'macOS' },
    });
    const codes = [
      ...Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (letter) => `Key${letter}`),
      ...Array.from('1234567890', (digit) => `Digit${digit}`),
      'Minus',
      'Equal',
      'BracketLeft',
      'BracketRight',
      'Semicolon',
      'Quote',
      'Comma',
      'Period',
      'Slash',
    ];
    stubLayoutMap(codes.map((code) => [code, DVORAK.characterAt(code) ?? ''] as const));
    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      unmount = mount(container);
      await everythingQueued();
    });
  }

  /**
   * Presses Command with the key that types C on Dvorak, and says whether the
   * browser may act on it. Command+I on Dvorak - QWERTY Command, and Copy on
   * plain Dvorak.
   */
  async function pressCommandC(shiftKey: boolean): Promise<boolean> {
    let delivered = false;
    await act(async () => {
      delivered = fireEvent.keyDown(document.body, {
        code: 'KeyI',
        key: shiftKey ? 'C' : 'c',
        metaKey: true,
        shiftKey,
      });
      await Promise.resolve();
    });
    return delivered;
  }

  it('keeps from the browser the Command press the settings ask for, while they ask for it', async () => {
    // Bound to nothing, the press the note asks for reached the browser,
    // and on Dvorak - QWERTY Command the key that types C is Command+I,
    // which some browsers open a window with.
    await mountOnAppleDvorak();
    // From the menu: the settings' own shortcut waits for the same press.
    const help = screen.getByRole('menuitem', { name: 'Help' });
    help.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    await userEvent.click(await screen.findByRole('tab', { name: 'Shortcuts' }));
    expect(screen.getByRole('group', { name: 'Waiting for your keyboard' })).toHaveTextContent(
      /press made with Command/,
    );

    // Asked for with Command alone, and only while a default waits: with
    // Shift it is another press, and once the wait is over, nobody asks.
    expect(await pressCommandC(true)).toBe(true);
    expect(await pressCommandC(false)).toBe(false);
    expect(await pressCommandC(false)).toBe(true);
  });

  it('leaves to the browser the press the settings ask for, made with Caps Lock on, which teaches nothing', async () => {
    // Caps Lock changes what a Command press is read as, so the layout learns
    // nothing from such a press and the wait goes on. The keyboard's own copy
    // of the guard left Caps Lock out, and kept the press from the browser
    // for nothing.
    await mountOnAppleDvorak();
    const help = screen.getByRole('menuitem', { name: 'Help' });
    help.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    await userEvent.click(await screen.findByRole('tab', { name: 'Shortcuts' }));
    const waiting = screen.getByRole('group', { name: 'Waiting for your keyboard' });
    expect(waiting).toHaveTextContent(/press made with Command/);

    let delivered = false;
    await act(async () => {
      delivered = fireEvent.keyDown(document.body, {
        code: 'KeyI',
        key: 'C',
        metaKey: true,
        modifierCapsLock: true,
      });
      await Promise.resolve();
    });

    expect(delivered).toBe(true);
    expect(waiting).toHaveTextContent(/press made with Command/);
  });

  it('leaves to the browser a Command press of another key while the settings ask for one', async () => {
    // What is asked for is a press of the key the note names: any Command
    // press kept from the browser while a key was named took from the reader
    // whatever else they pressed with Command there.
    await mountOnAppleDvorak();
    const help = screen.getByRole('menuitem', { name: 'Help' });
    help.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Settings' }));
    await userEvent.click(await screen.findByRole('tab', { name: 'Shortcuts' }));
    expect(screen.getByRole('group', { name: 'Waiting for your keyboard' })).toHaveTextContent(
      /press made with Command/,
    );

    let delivered = false;
    await act(async () => {
      delivered = fireEvent.keyDown(document.body, { code: 'KeyG', key: 'i', metaKey: true });
      await Promise.resolve();
    });

    expect(delivered).toBe(true);
  });

  it('leaves the same press to the browser while the settings do not ask for it, where plain Dvorak copies with it', async () => {
    // Kept from the browser whenever a default waited, the press the note
    // names was cancelled anywhere in the application, and on plain Dvorak
    // it is Command+C: the reader's first copy did nothing, and the next
    // paste gave them whatever the clipboard held before.
    await mountOnAppleDvorak();

    expect(await pressCommandC(false)).toBe(true);
  });

  it('lets a press the platform takes reach the browser, though the profile binds it', async () => {
    // Kept in the profile and listed in the settings as taken, the binding
    // still ran its command and cancelled the press, which on a browser that
    // does hand it over took from the reader the tab it would have opened.
    window.localStorage.setItem(
      'audiogubbins.shortcuts',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
        selectedId: 'mine',
        profiles: [
          {
            id: 'mine',
            text: exportProfile({
              id: 'mine',
              displayName: 'Mine',
              builtIn: false,
              bindings: [
                {
                  commandId: commandId('settings.open'),
                  shortcut: shortcut(keyPress('KeyT', { control: true })),
                },
              ],
            }),
            following: [],
          },
        ],
      }),
    );
    const { mount } = await import('./app.js');
    const container = document.createElement('div');
    document.body.append(container);
    await act(async () => {
      unmount = mount(container);
      await everythingQueued();
    });

    let delivered = false;
    await act(async () => {
      delivered = fireEvent.keyDown(document.body, { code: 'KeyT', key: 't', ctrlKey: true });
      await Promise.resolve();
    });

    expect(delivered).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
