import { describe, expect, it } from 'vitest';

import {
  KeyboardConvention,
  commandId,
  describeShortcut,
  shortcut,
  type ShortcutProfile,
} from '@audiogubbins/commands';
import { keyPress } from '@audiogubbins/input';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { keyEventOf } from '@audiogubbins/input/testing';
import { buildShellContext } from '../testing/shell-context.js';
import { buildLayoutStore } from '../testing/layout-store.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import type { KeyValueStorage } from './state-storage.js';
import { isRecord } from './stored-value.js';

/**
 * What the user's layout types, learned and used: a browser takes its own
 * shortcuts by the character, so the shell cannot read every keyboard as a US
 * one.
 */

/** The keys a profile binds a command to. */
function keysOf(profile: ShortcutProfile, id: string): readonly string[] | undefined {
  return profile.bindings
    .find((binding) => binding.commandId === commandId(id))
    ?.shortcut.presses.map((press) => press.key);
}

describe('the keyboard layout store', () => {
  it('learns what each key types from the keys the user presses', () => {
    const store = buildLayoutStore().store;
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });

    store.learn(keyEventOf('KeyV', 'k'));
    store.learn(keyEventOf('KeyV', 'k'));
    store.learn(keyEventOf('Digit1', '!', { shiftKey: true }));

    expect(store.get().characterAt('KeyV')).toBe('k');
    expect(store.get().characterAt('Digit1')).toBeUndefined();
    expect(told).toBe(1);
  });

  it('takes a layout map whole, and a key typed later over it', () => {
    const store = buildLayoutStore().store;
    store.adopt([
      ['KeyK', 't'],
      ['KeyV', 'k'],
    ]);
    store.learn(keyEventOf('KeyK', 'k'));

    expect(store.get().characterAt('KeyK')).toBe('k');
    expect(store.get().keyTyping('k')).toBe('KeyK');
  });

  it('keeps what it learned for the next visit, and starts from nothing it cannot read', () => {
    // Started from nothing at every visit, a browser with no layout map read
    // every keyboard as a US one until the user had typed again.
    const raw = ephemeralStorage();
    buildLayoutStore(raw).store.learn(keyEventOf('KeyV', 'k'));

    expect(buildLayoutStore(raw).store.get().characterAt('KeyV')).toBe('k');

    raw.write('audiogubbins.keyboard-layout', '{"schemaVersion": 1, "keys": [');
    expect(buildLayoutStore(raw).store.get().characterAt('KeyV')).toBeUndefined();
    raw.write(
      'audiogubbins.keyboard-layout',
      JSON.stringify({ schemaVersion: SCHEMA_VERSIONS.keyboardLayout + 1, keys: [['KeyV', 'k']] }),
    );
    expect(buildLayoutStore(raw).store.get().characterAt('KeyV')).toBeUndefined();
  });

  it('knows a character in capitals from a layout map or storage as the one typed', () => {
    // A map or a stored text that gives a capital names the key typed without
    // Shift, so the same key typed later is nothing new.
    const raw = ephemeralStorage();
    raw.write(
      'audiogubbins.keyboard-layout',
      JSON.stringify({ schemaVersion: SCHEMA_VERSIONS.keyboardLayout, keys: [['KeyQ', 'A']] }),
    );
    const store = buildLayoutStore(raw).store;
    store.adopt([['KeyW', 'Z']]);
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });

    store.learn(keyEventOf('KeyQ', 'a'));
    store.learn(keyEventOf('KeyW', 'z'));

    expect(told).toBe(0);
  });
});

describe('a default that waits for a key', () => {
  it('names the character whose key it waits for, in a profile that follows it', () => {
    // On Dvorak the key at K types T: until the key that types K is known, the
    // defaults behind the prefix have nowhere to go.
    const layout = buildLayoutStore().store;
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, layout);
    layout.learn(keyEventOf('KeyK', 't'));

    const waiting = context.shortcuts.get().waiting;
    expect(waiting.find((one) => one.commandId === commandId('view.command-palette'))).toEqual({
      commandId: commandId('view.command-palette'),
      characters: ['k'],
      waitsForCommandLayer: false,
    });
    expect(waiting.map((one) => one.commandId)).not.toContain(commandId('settings.open'));

    // A copy follows only the defaults it has not changed.
    context.shortcuts.duplicate('Mine');
    context.shortcuts.rebind(commandId('view.theme-dark'), shortcut(keyPress('F9')));
    const mine = context.shortcuts.get().waiting.map((one) => one.commandId);
    expect(mine).toContain(commandId('view.command-palette'));
    expect(mine).not.toContain(commandId('view.theme-dark'));

    // K is typed on the key a US keyboard has V on, so the Selection tool's V
    // waits in turn until the key Dvorak types V on, a US full stop, is seen.
    layout.learn(keyEventOf('KeyV', 'k'));
    expect(context.shortcuts.get().waiting.map((one) => one.characters)).toEqual([['v']]);
    layout.learn(keyEventOf('Period', 'v'));
    expect(context.shortcuts.get().waiting).toEqual([]);
  });
});

describe('the shell on another keyboard layout', () => {
  it('builds the shipped profile again as the layout becomes known', () => {
    const layout = buildLayoutStore().store;
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, layout);
    expect(keysOf(context.shortcuts.get().profile, 'settings.open')).toEqual(['Comma']);

    // Dvorak: the key at comma types W, and a comma is typed at W.
    layout.learn(keyEventOf('Comma', 'w'));
    layout.learn(keyEventOf('KeyW', ','));

    expect(keysOf(context.shortcuts.get().profile, 'settings.open')).toEqual(['KeyW']);
  });

  it('leaves an Apple default unplaced until a Command press shows how the layout is read', () => {
    // Placed by the layout's characters, the chord prefix sat on the key the
    // system reads as Command+V and swallowed every paste; placed at the US
    // key, the settings sat on the key Dvorak types `w` on, which macOS reads
    // as Command+Shift+W and closes the window with. So it waits.
    const layout = buildLayoutStore().store;
    const { context } = buildShellContext(undefined, KeyboardConvention.Apple, layout);
    layout.learn(keyEventOf('KeyV', 'k'));
    layout.learn(keyEventOf('KeyR', 'p'));
    layout.learn(keyEventOf('KeyW', ','));
    const unread = context.shortcuts.get();
    expect(keysOf(unread.profile, 'view.command-palette')).toBeUndefined();
    expect(keysOf(unread.profile, 'settings.open')).toBeUndefined();
    expect(
      unread.waiting.filter((each) => each.waitsForCommandLayer).map((each) => each.commandId),
    ).toContain(commandId('settings.open'));

    // Read as a layout that does not switch, each default goes where the
    // layout types its character.
    const dvorak = buildLayoutStore().store;
    const onDvorak = buildShellContext(undefined, KeyboardConvention.Apple, dvorak).context;
    dvorak.learn(keyEventOf('KeyV', 'k'));
    dvorak.learn(keyEventOf('KeyR', 'p'));
    dvorak.learn(keyEventOf('KeyV', 'k', { metaKey: true }));
    expect(keysOf(onDvorak.shortcuts.get().profile, 'view.command-palette')).toEqual([
      'KeyV',
      'KeyR',
    ]);

    layout.learn(keyEventOf('KeyV', 'v', { metaKey: true }));
    const profile = context.shortcuts.get().profile;
    expect(keysOf(profile, 'view.command-palette')).toEqual(['KeyK', 'KeyP']);
    // Named as Command reads it: by the Dvorak characters, ⌘K read ⌘T.
    const palette = profile.bindings.find(
      (binding) => binding.commandId === commandId('view.command-palette'),
    );
    expect(
      palette && describeShortcut(palette.shortcut, KeyboardConvention.Apple, layout.get()),
    ).toBe('⌘K, ⌘P');

    // The settings sit at the comma's own US key, not the key Dvorak types a
    // comma on, which the system reads as Command+Shift+W.
    expect(keysOf(profile, 'settings.open')).toEqual(['Comma']);
    expect(context.shortcuts.get().waiting.some((each) => each.waitsForCommandLayer)).toBe(false);
  });

  it('refuses to bind a press the browser takes by what it types on the layout', () => {
    const layout = buildLayoutStore().store;
    layout.learn(keyEventOf('KeyK', 't'));
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, layout);

    const refused = context.shortcuts.rebind(
      commandId('settings.open'),
      shortcut(keyPress('KeyK', { control: true })),
    );

    expect(refused?.[0]).toMatch(/^Ctrl\+T cannot be used: /);
  });

  it('keeps what the browser takes in an imported profile, and says which', () => {
    const layout = buildLayoutStore().store;
    layout.learn(keyEventOf('KeyK', 't'));
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, layout);
    const profile = {
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'Carried over',
      bindings: [
        { command: 'view.theme-light', presses: ['C+KeyK'] },
        { command: 'settings.open', presses: ['C+Comma'] },
      ],
    };

    const outcome = context.shortcuts.imported(JSON.stringify(profile));

    expect(outcome).toEqual({ kind: 'in force', reservedCommands: ['view.theme-light'] });
    expect(keysOf(context.shortcuts.get().profile, 'view.theme-light')).toEqual(['KeyK']);
  });

  it('keeps a binding an imported profile carries for a keyboard not known yet', () => {
    // A profile carried to another machine is read before anything is typed,
    // and on a browser with no layout map nothing is known at all. Judged on
    // that, a French user's Ctrl on the key that types Z read as Ctrl+W and
    // was removed for good.
    const layout = buildLayoutStore().store;
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, layout);
    const profile = {
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'Carried over',
      bindings: [{ command: 'view.theme-light', presses: ['C+KeyW'] }],
    };

    const outcome = context.shortcuts.imported(JSON.stringify(profile));

    expect(outcome.kind).toBe('in force');
    expect(keysOf(context.shortcuts.get().profile, 'view.theme-light')).toEqual(['KeyW']);
  });

  it('writes a shortcut by what the layout types on each key', () => {
    const layout = buildLayoutStore().store;
    layout.learn(keyEventOf('KeyV', 'k'));

    expect(
      describeShortcut(
        shortcut(keyPress('KeyV', { control: true })),
        KeyboardConvention.Windows,
        layout.get(),
      ),
    ).toBe('Ctrl+K');
  });
});

describe('a profile the user made, across a restart and as the layout is learned', () => {
  it('keeps a binding made on another layout when it starts before the layout is known', () => {
    // Checked again at the start with nothing learned, the key a French layout
    // types Z on was read as Ctrl+W, dropped without a word, and written away.
    const raw = ephemeralStorage();
    const azerty = buildLayoutStore().store;
    azerty.learn(keyEventOf('KeyW', 'z'));
    const first = buildShellContext(raw, KeyboardConvention.Windows, azerty).context;
    const undo = shortcut(keyPress('KeyW', { control: true }));
    expect(first.shortcuts.rebind(commandId('view.theme-light'), undo)).toBeUndefined();

    const layout = buildLayoutStore().store;
    const { context } = buildShellContext(raw, KeyboardConvention.Windows, layout);
    expect(keysOf(context.shortcuts.get().profile, 'view.theme-light')).toEqual(['KeyW']);

    // Said while the layout is not known, where it reads as the browser's
    // Ctrl+W, and no longer once the key is known to type Z.
    expect(context.shortcuts.get().reserved.map((one) => one.commandId)).toContain(
      commandId('view.theme-light'),
    );
    layout.learn(keyEventOf('KeyW', 'z'));
    expect(context.shortcuts.get().reserved).toEqual([]);
  });

  it('moves a default copied into a profile the user made with the default, as the layout is learned', () => {
    // Copied at US positions before the layout was known, the chord prefix
    // stayed on the key Dvorak types T on, which the browser reads as Ctrl+T.
    const layout = buildLayoutStore().store;
    const { context } = buildShellContext(undefined, KeyboardConvention.Windows, layout);
    context.shortcuts.unbind(commandId('help.start-diagnostic-mode'));
    expect(context.shortcuts.get().profile.builtIn).toBe(false);

    layout.learn(keyEventOf('KeyK', 't'));
    layout.learn(keyEventOf('KeyV', 'k'));
    layout.learn(keyEventOf('Comma', 'w'));
    layout.learn(keyEventOf('KeyW', ','));

    const { profile } = context.shortcuts.get();
    expect(keysOf(profile, 'view.command-palette')).toEqual(['KeyV', 'KeyP']);
    expect(keysOf(profile, 'settings.open')).toEqual(['KeyW']);
    // What the user changed stays changed.
    expect(keysOf(profile, 'help.start-diagnostic-mode')).toBeUndefined();
    expect(context.shortcuts.get().reserved).toEqual([]);
  });
});

describe('a profile the user made, through storage while the layout changes', () => {
  /** Dvorak's keys for the chord prefix and the settings shortcut. */
  function learnDvorak(layout: ReturnType<typeof buildLayoutStore>['store']): void {
    layout.learn(keyEventOf('KeyK', 't'));
    layout.learn(keyEventOf('KeyV', 'k'));
    layout.learn(keyEventOf('Comma', 'w'));
    layout.learn(keyEventOf('KeyW', ','));
  }

  it('still follows the default after a reload, and moves with it as the layout is learned', () => {
    // Which commands follow the default is stored beside the profile. Written
    // as nothing, or read back as nothing, a copy made on the first visit
    // stopped following at the next, and the chord prefix stayed on the key
    // Dvorak types T on, which the browser reads as Ctrl+T.
    const raw = ephemeralStorage();
    buildShellContext(
      raw,
      KeyboardConvention.Windows,
      buildLayoutStore().store,
    ).context.shortcuts.unbind(commandId('help.start-diagnostic-mode'));

    const layout = buildLayoutStore().store;
    const { context } = buildShellContext(raw, KeyboardConvention.Windows, layout);
    expect(context.shortcuts.get().profile.builtIn).toBe(false);
    learnDvorak(layout);

    expect(keysOf(context.shortcuts.get().profile, 'view.command-palette')).toEqual([
      'KeyV',
      'KeyP',
    ]);
  });

  it('keeps a binding made on another layout through a write made before the layout is known', () => {
    // Read as written, the binding survives the start; written back by a
    // session that knew nothing of the layout, it has to survive that write
    // too, or the next session would read it from nowhere.
    const raw = ephemeralStorage();
    const azerty = buildLayoutStore().store;
    azerty.learn(keyEventOf('KeyW', 'z'));
    const undo = shortcut(keyPress('KeyW', { control: true }));
    buildShellContext(raw, KeyboardConvention.Windows, azerty).context.shortcuts.rebind(
      commandId('view.theme-light'),
      undo,
    );

    const unknown = buildShellContext(raw, KeyboardConvention.Windows, buildLayoutStore().store);
    unknown.context.shortcuts.unbind(commandId('help.start-diagnostic-mode'));

    const third = buildShellContext(raw, KeyboardConvention.Windows, buildLayoutStore().store);
    expect(keysOf(third.context.shortcuts.get().profile, 'view.theme-light')).toEqual(['KeyW']);
  });

  it('writes nothing when the layout changes and no default moves', () => {
    // Compared as the text each exports, a profile whose bindings were in
    // another order read as moved, so the first key learned after any rebind
    // wrote every profile again.
    let writes = 0;
    const raw = ephemeralStorage();
    const counting: KeyValueStorage = {
      ...raw,
      write: (key, value) => {
        if (key === 'audiogubbins.shortcuts') writes += 1;
        raw.write(key, value);
      },
    };
    const layout = buildLayoutStore().store;
    const { context } = buildShellContext(counting, KeyboardConvention.Windows, layout);
    context.shortcuts.rebind(
      commandId('view.theme-dark'),
      shortcut(keyPress('KeyY', { control: true, shift: true })),
    );
    const before = writes;

    layout.learn(keyEventOf('KeyA', 'a'));

    expect(writes).toBe(before);
  });
});

describe('what the stored keyboard layout records', () => {
  /** The keys a stored layout names, in the order they are written. */
  function storedKeys(raw: KeyValueStorage): readonly (readonly string[])[] {
    const text = raw.read('audiogubbins.keyboard-layout') ?? '{}';
    const parsed: unknown = JSON.parse(text);
    const keys = isRecord(parsed) ? parsed['keys'] : undefined;
    return Array.isArray(keys) ? (keys as readonly (readonly string[])[]) : [];
  }

  it('writes the keys in the order of their codes, not the order they were typed', () => {
    // Written as learned, it recorded the order the user first typed each
    // letter in: typing a name into any field wrote its letters out in order,
    // and the file was kept between visits.
    const raw = ephemeralStorage();
    const { store } = buildLayoutStore(raw);

    for (const [code, character] of [
      ['KeyJ', 'j'],
      ['KeyA', 'a'],
      ['KeyN', 'n'],
      ['KeyE', 'e'],
    ] as const) {
      store.learn(keyEventOf(code, character));
    }

    expect(storedKeys(raw)).toEqual([
      ['KeyA', 'a'],
      ['KeyE', 'e'],
      ['KeyJ', 'j'],
      ['KeyN', 'n'],
    ]);
  });

  it('reads back only a key of the writing block typing one character', () => {
    // Only the shape `[string, string]` was checked, so any stored text became
    // a key's label, however the storage came by it.
    const raw = ephemeralStorage();
    raw.write(
      'audiogubbins.keyboard-layout',
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.keyboardLayout,
        keys: [
          ['KeyV', 'k'],
          ['NumpadSubtract', '-'],
          ['KeyB', 'not one character'],
          ['KeyN', ''],
        ],
      }),
    );

    const layout = buildLayoutStore(raw).store.get();
    expect(layout.characterAt('KeyV')).toBe('k');
    expect(layout.characterAt('NumpadSubtract')).toBeUndefined();
    expect(layout.characterAt('KeyB')).toBeUndefined();
    expect(layout.characterAt('KeyN')).toBeUndefined();
  });

  it('says so when the stored layout cannot be read, as the other stores do', () => {
    const raw = ephemeralStorage();
    raw.write('audiogubbins.keyboard-layout', '{"schemaVersion": 1, "keys": [');

    const { logs } = buildLayoutStore(raw);
    expect(logs.snapshot().map((record) => record.message)).toContain(
      'The stored keyboard layout could not be read, so it is learned again.',
    );
  });

  it('gives a fixed reason for stored text it cannot read, never the text', () => {
    // The parser's own message quotes the start of the text it could not read.
    const raw = ephemeralStorage();
    raw.write('audiogubbins.keyboard-layout', 'Jane Smith');

    const [warning] = buildLayoutStore(raw)
      .logs.snapshot()
      .filter((record) => record.message.startsWith('The stored keyboard layout'));
    expect(warning?.fields).toEqual({ reason: 'not JSON' });
  });

  it('learns that the layout types another layout under Command, keeps it, and forgets it again', () => {
    // "Dvorak – QWERTY ⌘": the key at V types K, and V while Command is held.
    const raw = ephemeralStorage();
    const { store } = buildLayoutStore(raw);
    store.learn(keyEventOf('KeyV', 'k'));
    // A key typed on its own shows nothing of what Command does.
    expect(store.get().commandByPosition).toBeUndefined();

    store.learn(keyEventOf('KeyV', 'v', { metaKey: true }));
    expect(store.get().commandByPosition).toBe(true);
    expect(buildLayoutStore(raw).store.get().commandByPosition).toBe(true);

    // Moved to Dvorak alone, a Command press types the layout's own letter.
    store.learn(keyEventOf('KeyV', 'k', { metaKey: true }));
    expect(store.get().commandByPosition).toBe(false);
    expect(buildLayoutStore(raw).store.get().commandByPosition).toBe(false);
  });

  it('reads no Command layer where the platform has none', () => {
    // The ⌘ layer is a macOS arrangement. A Windows-key or Super-key press
    // reports `metaKey` just as a Command press does, and the store asked
    // every press of it whatever the platform: a system that reported a
    // different letter under Meta would have set the flag that blanks every
    // key label held with Meta. Nothing on those platforms is likely to, and
    // nothing prevented it either.
    const raw = ephemeralStorage();
    const { store } = buildLayoutStore(raw, KeyboardConvention.Windows);
    store.learn(keyEventOf('KeyV', 'k'));

    store.learn(keyEventOf('KeyV', 'v', { metaKey: true }));

    expect(store.get().commandByPosition).toBeUndefined();
    expect(
      buildLayoutStore(raw, KeyboardConvention.Windows).store.get().commandByPosition,
    ).toBeUndefined();
    // The same press on Apple hardware is read, so the rule above is the
    // platform's answer rather than the press teaching nothing.
    const apple = buildLayoutStore(ephemeralStorage()).store;
    apple.learn(keyEventOf('KeyV', 'k'));
    apple.learn(keyEventOf('KeyV', 'v', { metaKey: true }));
    expect(apple.get().commandByPosition).toBe(true);
  });

  it('keeps a reading through a Command press on a key both layers type alike', () => {
    // Dvorak keeps `a` where a US layout has it, so Command+A types `a`
    // whichever layer the system reads. Taken as proof that the layout does
    // not switch, Select All undid the reading, and the next Command press
    // was placed by the layout's own characters again.
    const raw = ephemeralStorage();
    const { store } = buildLayoutStore(raw);
    store.learn(keyEventOf('KeyV', 'k'));
    store.learn(keyEventOf('KeyA', 'a'));
    store.learn(keyEventOf('KeyV', 'v', { metaKey: true }));
    expect(store.get().commandByPosition).toBe(true);

    store.learn(keyEventOf('KeyA', 'a', { metaKey: true }));
    expect(store.get().commandByPosition).toBe(true);
    expect(buildLayoutStore(raw).store.get().commandByPosition).toBe(true);
  });
});
