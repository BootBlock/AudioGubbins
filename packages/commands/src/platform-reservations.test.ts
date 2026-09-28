import { describe, expect, it } from 'vitest';

import {
  browserPressOf,
  keyPress,
  keyboardLayout,
  UNKNOWN_LAYOUT,
  type KeyPress,
} from '@audiogubbins/input';

import { commandId } from './command.js';
import {
  commandPressMayBeTaken,
  describeReservation,
  isReservedByPlatform,
  platformReservation,
  shortcutOffered,
} from './platform-reservations.js';
import { KeyboardConvention, shortcut, type ShortcutProfile } from './shortcut.js';

describe('isReservedByPlatform', () => {
  it('leaves a press the browser hands to the page, however much it does with it, unless a reader relies on it', () => {
    // A press that arrives is a row only where a reader relies on the
    // browser for it, which is why Control+S, Control+P, Control+R and
    // Control+D are absent although every browser does something with
    // them. Control+Shift+B and Control+Shift+D are the same menu of the
    // same browsers, and were once rows here. A row is not only a refusal:
    // the application drops a matched binding out of the profile the
    // keyboard answers, so a user who bound one had a shortcut that did
    // nothing at all.
    for (const convention of [
      KeyboardConvention.Windows,
      KeyboardConvention.Linux,
      KeyboardConvention.Apple,
    ]) {
      const modifier =
        convention === KeyboardConvention.Apple
          ? { meta: true, shift: true }
          : { control: true, shift: true };
      for (const key of ['KeyB', 'KeyD']) {
        expect([
          convention,
          key,
          isReservedByPlatform(shortcut(keyPress(key, modifier)), convention, UNKNOWN_LAYOUT),
        ]).toEqual([convention, key, false]);
      }
    }
  });

  const { Windows, Apple, Linux } = KeyboardConvention;

  it.each([
    ['Ctrl+W', Windows, keyPress('KeyW', { control: true })],
    ['Ctrl+T', Windows, keyPress('KeyT', { control: true })],
    ['Ctrl+N', Linux, keyPress('KeyN', { control: true })],
    ['Win+E', Windows, keyPress('KeyE', { meta: true })],
    ['Command+Q', Apple, keyPress('KeyQ', { meta: true })],
    ['Command+W', Apple, keyPress('KeyW', { meta: true })],
    ['Command+Shift+W', Apple, keyPress('KeyW', { meta: true, shift: true })],
    ['Command+Shift+T', Apple, keyPress('KeyT', { meta: true, shift: true })],
    ['Command+Shift+N', Apple, keyPress('KeyN', { meta: true, shift: true })],
    ['Control+Tab', Apple, keyPress('Tab', { control: true })],
  ])('reports %s as taken by the browser or the system', (_name, convention, press) => {
    expect(isReservedByPlatform(shortcut(press), convention, UNKNOWN_LAYOUT)).toBe(true);
  });

  it.each([
    ['Ctrl+1', Windows, keyPress('Digit1', { control: true })],
    ['Ctrl+Numpad1', Windows, keyPress('Numpad1', { control: true })],
    ['Ctrl+Numpad9', Linux, keyPress('Numpad9', { control: true })],
    ['Alt+1', Linux, keyPress('Digit1', { alt: true })],
    ['Alt+9', Linux, keyPress('Digit9', { alt: true })],
    ['Alt+Left', Linux, keyPress('ArrowLeft', { alt: true })],
    ['Command+9', Apple, keyPress('Digit9', { meta: true })],
    ['Command+[', Apple, keyPress('BracketLeft', { meta: true })],
    ['Command+Numpad1', Apple, keyPress('Numpad1', { meta: true })],
  ])('leaves %s to the page, which neither engine keeps from it', (_name, convention, press) => {
    // Read from each engine's own list of what it keeps from the page:
    // Chromium's reserved commands and the keys Firefox marks reserved, and
    // on macOS WebKit, which gives the page every key equivalent first. The
    // browser acts on each only where the page does not take it, and the
    // keyboard takes every press it runs a command for.
    expect(isReservedByPlatform(shortcut(press), convention, UNKNOWN_LAYOUT)).toBe(false);
  });

  // Written from the browsers' own lists of the zoom, the address bar and
  // full screen, not from the table, so a form the table loses is caught:
  // Chromium's accelerator table, and Firefox's key set, where the zoom out
  // is the minus and the underscore, and the zoom in the plus and the equals.
  const DESKTOP_RELIED_ON = [
    ['Ctrl+L', keyPress('KeyL', { control: true })],
    ['Alt+D', keyPress('KeyD', { alt: true })],
    ['F6', keyPress('F6')],
    ['Ctrl+=', keyPress('Equal', { control: true })],
    ['Ctrl+Plus', keyPress('Equal', { control: true, shift: true })],
    ['Ctrl+Minus', keyPress('Minus', { control: true })],
    ['Ctrl+Underscore', keyPress('Minus', { control: true, shift: true })],
    ['Ctrl+0', keyPress('Digit0', { control: true })],
    ['Ctrl+NumpadAdd', keyPress('NumpadAdd', { control: true })],
    ['Ctrl+NumpadSubtract', keyPress('NumpadSubtract', { control: true })],
    ['Ctrl+Numpad0', keyPress('Numpad0', { control: true })],
    ['F11', keyPress('F11')],
  ] as const;
  const APPLE_RELIED_ON = [
    ['Command+L', keyPress('KeyL', { meta: true })],
    ['Command+=', keyPress('Equal', { meta: true })],
    ['Command+Plus', keyPress('Equal', { meta: true, shift: true })],
    ['Command+Minus', keyPress('Minus', { meta: true })],
    ['Command+Underscore', keyPress('Minus', { meta: true, shift: true })],
    ['Command+0', keyPress('Digit0', { meta: true })],
    ['Command+NumpadAdd', keyPress('NumpadAdd', { meta: true })],
    ['Command+NumpadSubtract', keyPress('NumpadSubtract', { meta: true })],
    ['Command+Numpad0', keyPress('Numpad0', { meta: true })],
  ] as const;

  it.each([
    ...DESKTOP_RELIED_ON.flatMap(([name, press]) => [
      [`${name} on Windows`, Windows, press] as const,
      [`${name} on Linux`, Linux, press] as const,
    ]),
    ...APPLE_RELIED_ON.map(([name, press]) => [name, Apple, press] as const),
  ])('refuses %s, which a reader relies on the browser for', (_name, convention, press) => {
    // They reach the page, and a binding would take them silently: a reader
    // who needs larger text would lose the zoom, and a keyboard its way out
    // of the page. The reason speaks to the person reading it, as the rest of
    // the interface does, and says they are kept for the browser.
    const reason = platformReservation(shortcut(press), convention, UNKNOWN_LAYOUT)?.reason;
    expect(reason).toContain('kept for the browser');
    expect(reason).toMatch(/\byou\b/u);
    expect(reason).not.toMatch(/\breader\b/u);
  });

  it.each([
    // From each browser's and each system's published list, not from the table:
    // a test drawn from the table can only find what the table already holds.
    ['Ctrl+PageDown', Windows, keyPress('PageDown', { control: true })],
    ['Ctrl+PageUp', Apple, keyPress('PageUp', { control: true })],
    ['Ctrl+F4', Windows, keyPress('F4', { control: true })],
    ['Ctrl+Q', Linux, keyPress('KeyQ', { control: true })],
    ['Ctrl+Shift+Q', Windows, keyPress('KeyQ', { control: true, shift: true })],
    ['Alt+F4', Windows, keyPress('F4', { alt: true })],
    ['Ctrl+Shift+Esc', Windows, keyPress('Escape', { control: true, shift: true })],
    ['Command+Shift+]', Apple, keyPress('BracketRight', { meta: true, shift: true })],
    ['Command+Option+Right', Apple, keyPress('ArrowRight', { meta: true, alt: true })],
    ['Control+Command+F', Apple, keyPress('KeyF', { meta: true, control: true })],
    ['Command+Space', Apple, keyPress('Space', { meta: true })],
    ['Alt+Shift+Tab', Linux, keyPress('Tab', { alt: true, shift: true })],
    ['Alt+Space', Windows, keyPress('Space', { alt: true })],
    ['Ctrl+Esc', Windows, keyPress('Escape', { control: true })],
    ['Command+Shift+Tab', Apple, keyPress('Tab', { meta: true, shift: true })],
    ['Command+`', Apple, keyPress('Backquote', { meta: true })],
    ['Command+Option+Esc', Apple, keyPress('Escape', { meta: true, alt: true })],
    ['Command+Shift+4', Apple, keyPress('Digit4', { meta: true, shift: true })],
    ['Control+Command+Q', Apple, keyPress('KeyQ', { meta: true, control: true })],
    ['Control+Right', Apple, keyPress('ArrowRight', { control: true })],
    ['Control+Space', Apple, keyPress('Space', { control: true })],
    // What the system itself keeps.
    ['Ctrl+Alt+Delete', Windows, keyPress('Delete', { control: true, alt: true })],
    ['Alt+Esc', Windows, keyPress('Escape', { alt: true })],
    ['Ctrl+Alt+Tab', Windows, keyPress('Tab', { control: true, alt: true })],
    ['PrintScreen', Windows, keyPress('PrintScreen')],
    ['Alt+Space', Linux, keyPress('Space', { alt: true })],
    ['Alt+F2', Linux, keyPress('F2', { alt: true })],
    ['Ctrl+Alt+Delete', Linux, keyPress('Delete', { control: true, alt: true })],
    ['Ctrl+Alt+Right', Linux, keyPress('ArrowRight', { control: true, alt: true })],
    ['Ctrl+Alt+F3', Linux, keyPress('F3', { control: true, alt: true })],
    ['Control+Command+Space', Apple, keyPress('Space', { control: true, meta: true })],
    ['Alt+PrintScreen', Windows, keyPress('PrintScreen', { alt: true })],
    ['PrintScreen', Linux, keyPress('PrintScreen')],
    ['Shift+PrintScreen', Linux, keyPress('PrintScreen', { shift: true })],
    ['Alt+PrintScreen', Linux, keyPress('PrintScreen', { alt: true })],
    ['Ctrl+Alt+T', Linux, keyPress('KeyT', { control: true, alt: true })],
    ['Ctrl+Alt+L', Linux, keyPress('KeyL', { control: true, alt: true })],
    ['Command+Shift+Q', Apple, keyPress('KeyQ', { meta: true, shift: true })],
    ['Command+Option+H', Apple, keyPress('KeyH', { meta: true, alt: true })],
    ['Command+Option+M', Apple, keyPress('KeyM', { meta: true, alt: true })],
    ['Command+Option+Space', Apple, keyPress('Space', { meta: true, alt: true })],
    // What each system keeps.
    ['Alt+Shift+PrintScreen', Windows, keyPress('PrintScreen', { alt: true, shift: true })],
    ['Ctrl+Space', Windows, keyPress('Space', { control: true })],
    ['Alt+`', Linux, keyPress('Backquote', { alt: true })],
    ['Alt+F3', Linux, keyPress('F3', { alt: true })],
    ['Alt+F7', Linux, keyPress('F7', { alt: true })],
    ['Alt+F8', Linux, keyPress('F8', { alt: true })],
    ['Alt+F10', Linux, keyPress('F10', { alt: true })],
    ['Ctrl+Esc', Linux, keyPress('Escape', { control: true })],
    ['Command+Shift+6', Apple, keyPress('Digit6', { meta: true, shift: true })],
    [
      'Control+Command+Shift+3',
      Apple,
      keyPress('Digit3', { meta: true, shift: true, control: true }),
    ],
    [
      'Control+Command+Shift+4',
      Apple,
      keyPress('Digit4', { meta: true, shift: true, control: true }),
    ],
    ['Command+Option+D', Apple, keyPress('KeyD', { meta: true, alt: true })],
    // What GNOME and KDE keep, and the input methods where one is installed.
    ['Alt+F5', Linux, keyPress('F5', { alt: true })],
    ['Alt+F6', Linux, keyPress('F6', { alt: true })],
    ['Alt+Esc', Linux, keyPress('Escape', { alt: true })],
    ['Ctrl+Alt+Tab', Linux, keyPress('Tab', { control: true, alt: true })],
    ['Ctrl+Alt+Up', Linux, keyPress('ArrowUp', { control: true, alt: true })],
    ['Ctrl+Alt+Down', Linux, keyPress('ArrowDown', { control: true, alt: true })],
    ['Ctrl+F1', Linux, keyPress('F1', { control: true })],
    ['Ctrl+F4', Linux, keyPress('F4', { control: true })],
    ['Alt+F1', Linux, keyPress('F1', { alt: true })],
    ['Ctrl+Alt+Esc', Linux, keyPress('Escape', { control: true, alt: true })],
    ['Ctrl+Space', Linux, keyPress('Space', { control: true })],
    ['Alt+`', Windows, keyPress('Backquote', { alt: true })],
  ])(
    'reports %s, which a browser or the system always takes, as reserved',
    (_name, convention, press) => {
      expect(isReservedByPlatform(shortcut(press), convention, UNKNOWN_LAYOUT)).toBe(true);
    },
  );

  it.each([
    // Each reason has to be true of the machine it is given on.
    ['Ctrl+Q', Windows, keyPress('KeyQ', { control: true })],
    ['Ctrl+Shift+Esc', Linux, keyPress('Escape', { control: true, shift: true })],
    ['Ctrl+Alt+T', Windows, keyPress('KeyT', { control: true, alt: true })],
    ['Alt+F2', Windows, keyPress('F2', { alt: true })],
    ['Ctrl+Alt+F3', Apple, keyPress('F3', { control: true, alt: true })],
    ['Alt+1', Windows, keyPress('Digit1', { alt: true })],
    ['Alt+F3', Windows, keyPress('F3', { alt: true })],
    ['Alt+Shift+PrintScreen', Linux, keyPress('PrintScreen', { alt: true, shift: true })],
  ])('leaves %s alone where nothing takes it', (_name, convention, press) => {
    expect(isReservedByPlatform(shortcut(press), convention, UNKNOWN_LAYOUT)).toBe(false);
  });

  it('leaves the shifted level of a key that types the zoom character alone', () => {
    // German, Spanish and Italian type `+` on a key of its own and `*` on the
    // same key with Shift. A browser zooms with Control and `+`, and with
    // nothing on `*`, but Shift was set whatever the press held, so the
    // shifted level was mapped to the zoom's key and refused. What is held is
    // the reading the table is asked with.
    const german = keyboardLayout([['BracketRight', '+']]);
    const zoom = keyPress('Equal', { control: true, shift: true });

    expect(browserPressOf(keyPress('BracketRight', { control: true }), german)).toEqual(zoom);
    expect(
      browserPressOf(keyPress('BracketRight', { control: true, shift: true }), german),
    ).not.toEqual(zoom);

    // The unshifted level is the zoom and is refused, and the shifted one is
    // left alone.
    const onGerman = (press: KeyPress) => isReservedByPlatform(shortcut(press), Windows, german);
    expect(onGerman(keyPress('BracketRight', { control: true }))).toBe(true);
    expect(onGerman(keyPress('BracketRight', { control: true, shift: true }))).toBe(false);
  });

  it('leaves an ordinary editing shortcut alone', () => {
    expect(
      isReservedByPlatform(shortcut(keyPress('KeyS', { control: true })), Windows, UNKNOWN_LAYOUT),
    ).toBe(false);
    expect(
      isReservedByPlatform(shortcut(keyPress('KeyS', { meta: true })), Apple, UNKNOWN_LAYOUT),
    ).toBe(false);
  });

  it('reads the platform, so a press another platform takes is left alone', () => {
    // Control+W closes a tab on Windows and nothing in a browser on a Mac,
    // where Command+W does, and Firefox on a Mac opens its private window
    // with Command+Shift+P rather than Control+Shift+P.
    expect(
      isReservedByPlatform(shortcut(keyPress('KeyW', { control: true })), Apple, UNKNOWN_LAYOUT),
    ).toBe(false);
    expect(
      isReservedByPlatform(
        shortcut(keyPress('KeyP', { control: true, shift: true })),
        Apple,
        UNKNOWN_LAYOUT,
      ),
    ).toBe(false);
    expect(
      isReservedByPlatform(shortcut(keyPress('KeyW', { meta: true })), Apple, UNKNOWN_LAYOUT),
    ).toBe(true);
    expect(
      isReservedByPlatform(
        shortcut(keyPress('KeyP', { meta: true, shift: true })),
        Apple,
        UNKNOWN_LAYOUT,
      ),
    ).toBe(true);
  });

  it('reads every press of a chord, because the browser does not know one has started', () => {
    // The browser sees the second press of Ctrl+K Ctrl+W as an ordinary
    // Ctrl+W, and closes the tab.
    const chord = shortcut(
      keyPress('KeyK', { control: true }),
      keyPress('KeyW', { control: true }),
    );
    expect(isReservedByPlatform(chord, Windows, UNKNOWN_LAYOUT)).toBe(true);
    expect(platformReservation(chord, Windows, UNKNOWN_LAYOUT)?.press).toEqual(
      keyPress('KeyW', { control: true }),
    );
  });

  it('allows a chord no press of which the platform takes', () => {
    const chord = shortcut(
      keyPress('KeyK', { control: true }),
      keyPress('KeyX', { control: true }),
    );
    expect(isReservedByPlatform(chord, Windows, UNKNOWN_LAYOUT)).toBe(false);
  });
});

describe('a press on another keyboard layout', () => {
  const { Windows, Apple } = KeyboardConvention;

  // Part of US Dvorak, and of French AZERTY: the keys the cases press.
  const DVORAK = keyboardLayout([
    ['KeyK', 't'],
    ['Comma', 'w'],
    ['KeyV', 'k'],
  ]);
  const AZERTY = keyboardLayout([
    ['KeyZ', 'w'],
    ['KeyW', 'z'],
  ]);

  it('takes a Command press of a key under either reading of a layout that may switch', () => {
    // On AZERTY the key at Q types "a": read at its position it is Command+Q,
    // which quits the browser on macOS, and read as what it types it is
    // Command+A, which does not. Either reading may be the one in force, so
    // the key may be taken. The key at W types "z", read as Command+W or as
    // Command+Z, and the first closes the tab. The key at A types "q": read
    // at its position it is Command+A, and only as what it types is it the
    // Command+Q that quits.
    const azerty = keyboardLayout([
      ['KeyQ', 'a'],
      ['KeyW', 'z'],
      ['KeyA', 'q'],
    ]);

    expect(commandPressMayBeTaken('KeyQ', azerty, Apple)).toBe(true);
    expect(commandPressMayBeTaken('KeyW', azerty, Apple)).toBe(true);
    expect(commandPressMayBeTaken('KeyA', azerty, Apple)).toBe(true);
  });

  it('leaves a Command press alone where neither reading is taken', () => {
    // On Dvorak the key at I types "c": Command+I or Command+C, neither of
    // which the table holds. The key at N types "b", and Command+N opens a
    // window, so that one is taken.
    const dvorak = keyboardLayout([
      ['KeyI', 'c'],
      ['KeyN', 'b'],
    ]);

    expect(commandPressMayBeTaken('KeyI', dvorak, Apple)).toBe(false);
    expect(commandPressMayBeTaken('KeyN', dvorak, Apple)).toBe(true);
  });

  it('is read as the character it types, which is what the browser takes it by', () => {
    // On Dvorak the key at K types T, so Ctrl+K there is the browser's new
    // tab, and the key at comma types W, so Ctrl+comma closes the tab. Read by
    // position, both were allowed.
    expect(
      isReservedByPlatform(shortcut(keyPress('KeyK', { control: true })), Windows, DVORAK),
    ).toBe(true);
    expect(
      isReservedByPlatform(shortcut(keyPress('Comma', { control: true })), Windows, DVORAK),
    ).toBe(true);
    expect(
      isReservedByPlatform(shortcut(keyPress('KeyZ', { control: true })), Windows, AZERTY),
    ).toBe(true);
    expect(isReservedByPlatform(shortcut(keyPress('KeyK', { meta: true })), Apple, DVORAK)).toBe(
      true,
    );
  });

  it('leaves a press alone that types nothing the browser takes, wherever the key is', () => {
    // AZERTY types Z at the key a US keyboard has W on, and Dvorak types K at
    // the key a US keyboard has V on: neither is the browser's.
    expect(
      isReservedByPlatform(shortcut(keyPress('KeyW', { control: true })), Windows, AZERTY),
    ).toBe(false);
    expect(
      isReservedByPlatform(shortcut(keyPress('KeyV', { control: true })), Windows, DVORAK),
    ).toBe(false);
  });

  it('names the key by what the layout types on it, in the refusal', () => {
    const reservation = platformReservation(
      shortcut(keyPress('Comma', { control: true })),
      Windows,
      DVORAK,
    );
    if (reservation === undefined) throw new Error('Ctrl+comma on Dvorak was not refused');
    expect(describeReservation(reservation, Windows, DVORAK)).toMatch(/^Ctrl\+W cannot be used: /);
  });
});

describe('the reason a reservation gives', () => {
  it.each([
    // Each true of the system it is given on: Firefox quits with Control+Q on
    // Linux alone, and with Control+Shift+Q on Windows.
    [
      KeyboardConvention.Linux,
      keyPress('KeyQ', { control: true }),
      'Firefox quits with it on Linux.',
    ],
    [
      KeyboardConvention.Windows,
      keyPress('KeyQ', { control: true, shift: true }),
      'Firefox on Windows, and Chrome on Windows and Linux, quit with it.',
    ],
    [
      KeyboardConvention.Linux,
      keyPress('KeyQ', { control: true, shift: true }),
      'Firefox on Windows, and Chrome on Windows and Linux, quit with it.',
    ],
  ])('names what takes the press on that system', (convention, press, reason) => {
    expect(platformReservation(shortcut(press), convention, UNKNOWN_LAYOUT)?.reason).toBe(reason);
  });

  it('claims nothing of a desktop the Linux convention cannot promise', () => {
    // The application maps every system that is neither Windows nor Apple onto
    // the Linux convention, ChromeOS and Android among them. Six rows were
    // added saying "The Linux desktop keeps it for itself", which is a
    // sentence shown to a Chromebook user about a desktop they do not run, and
    // is not true of a stock GNOME session for Control+Space either.
    const presses = [
      keyPress('Space', { control: true }),
      keyPress('F2', { alt: true }),
      keyPress('F1', { alt: true }),
      keyPress('PrintScreen'),
      keyPress('KeyT', { control: true, alt: true }),
      keyPress('Backquote', { alt: true }),
      keyPress('Tab', { control: true, alt: true }),
      keyPress('KeyG', { meta: true }),
    ];

    const reasons = presses.map(
      (press) =>
        platformReservation(shortcut(press), KeyboardConvention.Linux, UNKNOWN_LAYOUT)?.reason,
    );

    // Every press is taken, so the rule is not passing on an empty list.
    expect(reasons.filter((one) => one === undefined)).toEqual([]);
    expect(reasons.filter((one) => one?.includes('Linux desktop') === true)).toEqual([]);
    expect(reasons.filter((one) => one?.includes('GNOME') === true)).toEqual([]);
    expect(reasons.filter((one) => one?.includes('KDE') === true)).toEqual([]);
  });
});

describe('describeReservation', () => {
  it('names the press and what takes it, so the user can tell whether it is their browser', () => {
    const reservation = platformReservation(
      shortcut(keyPress('KeyP', { control: true, shift: true })),
      KeyboardConvention.Windows,
      UNKNOWN_LAYOUT,
    );
    expect(reservation).toBeDefined();
    if (reservation === undefined) return;
    expect(describeReservation(reservation, KeyboardConvention.Windows, UNKNOWN_LAYOUT)).toBe(
      'Ctrl+Shift+P cannot be used: Firefox opens a private window with it. Choose another.',
    );
  });
});

describe('a shortcut the platform takes', () => {
  const close = commandId('file.close');
  const taken: ShortcutProfile = {
    id: 'mine',
    displayName: 'Mine',
    builtIn: false,
    bindings: [{ commandId: close, shortcut: shortcut(keyPress('KeyW', { control: true })) }],
  };

  it('is not offered as a shortcut to press', () => {
    // Kept in the profile, because the keyboard layout becomes known as the
    // user types and dropping the binding lost it for good. Shown beside a
    // menu entry, though, it taught a press that closes the browser tab.
    expect(
      shortcutOffered(taken, close, KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    ).toBeUndefined();
  });

  it('is offered where the platform does not take it', () => {
    expect(shortcutOffered(taken, close, KeyboardConvention.Apple, UNKNOWN_LAYOUT)).toBe('⌃W');
  });

  it('is offered again once the layout shows the key types something else', () => {
    // A French layout types Z where a US one types W. Before anything is
    // typed the binding reads as Ctrl+W, which the browser takes; once the
    // layout is known it reads as Ctrl+Z, which it does not.
    const french = keyboardLayout([['KeyW', 'z']]);

    expect(
      shortcutOffered(taken, close, KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    ).toBeUndefined();
    expect(shortcutOffered(taken, close, KeyboardConvention.Windows, french)).toBe('Ctrl+Z');
  });

  it('is nothing at all for a command with no binding', () => {
    expect(
      shortcutOffered(taken, commandId('file.save'), KeyboardConvention.Apple, UNKNOWN_LAYOUT),
    ).toBeUndefined();
  });

  it('offers the first binding the platform does not take', () => {
    // Only the first was read, so a command whose first binding was taken
    // showed no shortcut although its second worked.
    const two: ShortcutProfile = {
      ...taken,
      bindings: [
        ...taken.bindings,
        {
          commandId: close,
          shortcut: shortcut(
            keyPress('KeyK', { control: true }),
            keyPress('KeyX', { control: true }),
          ),
        },
      ],
    };

    expect(shortcutOffered(two, close, KeyboardConvention.Windows, UNKNOWN_LAYOUT)).toBe(
      'Ctrl+K, Ctrl+X',
    );
  });
});

describe('a key that types the plus sign unmodified', () => {
  it('is refused with Control, as the zoom it is read as is', () => {
    // German types `+` on a key of its own, and the browser reads Control on
    // it as Control with the US plus key, which is its zoom. Read by that key,
    // which no US key types `+` on without Shift, the zoom was called free.
    const german = keyboardLayout([['BracketRight', '+']]);

    expect(
      platformReservation(
        shortcut(keyPress('BracketRight', { control: true })),
        KeyboardConvention.Windows,
        german,
      )?.reason,
    ).toContain('zooms the page');
  });
});
