import { describe, expect, it } from 'vitest';

import { UNKNOWN_LAYOUT, keyPress } from '@audiogubbins/input';

import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { commandId } from './command.js';
import { addedTo } from './held-profiles.js';
import { isReservedByPlatform } from './platform-reservations.js';
import { profileName } from './profile-name.js';
import {
  exportFileName,
  exportProfile,
  importProfile,
  parseShortcut,
  restoreProfiles,
} from './shortcut-transfer.js';
import {
  KeyboardConvention,
  bindingsFor,
  shortcut,
  shortcutKey,
  type ShortcutProfile,
} from './shortcut.js';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

const save = commandId('file.save');
const palette = commandId('view.command-palette');

const source: ShortcutProfile = {
  id: 'mine',
  displayName: 'My shortcuts',
  builtIn: false,
  bindings: [
    { commandId: save, shortcut: shortcut(keyPress('KeyS', { control: true })) },
    {
      commandId: palette,
      shortcut: shortcut(keyPress('KeyK', { control: true }), keyPress('KeyP', { control: true })),
    },
  ],
};

describe('exportProfile', () => {
  it('records the format version, so a later reader knows what it is holding', () => {
    const exported = JSON.parse(exportProfile(source)) as { schemaVersion: number };
    expect(exported.schemaVersion).toBe(SCHEMA_VERSIONS.shortcutProfile);
  });

  it('produces readable text', () => {
    expect(exportProfile(source)).toContain('\n  "displayName"');
    expect(exportProfile(source).endsWith('\n')).toBe(true);
  });
});

describe('the name of the file a profile is exported to', () => {
  /** How many bytes `text` takes in UTF-8, counted by the platform's encoder. */
  const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

  /** The file a profile named `displayName`, held beside `source`, is exported to. */
  const fileOf = (displayName: string): string =>
    exportFileName(expectSuccess(addedTo([source], { displayName, bindings: [] })));

  it('names the exported file within 255 bytes, the ending whole, from a name of any length', () => {
    // Past the 255 bytes a file system gives a name, the browser saves the
    // file under another name than the one announced.
    const long = fileOf('x'.repeat(300));
    expect(long).toBe(`${'x'.repeat(227)}.audiogubbins-shortcuts.json`);
    expect(bytesOf(long)).toBe(255);

    const cyrillic = fileOf('Ж'.repeat(120));
    expect(cyrillic.endsWith('.audiogubbins-shortcuts.json')).toBe(true);
    expect(bytesOf(cyrillic)).toBeLessThanOrEqual(255);
  });

  it('is the identifier the profile is held under, then the ending', () => {
    expect(exportFileName(source)).toBe('mine.audiogubbins-shortcuts.json');
  });
});

describe('round trip', () => {
  it('reads back every binding it wrote', () => {
    const profile = expectSuccess(importProfile(exportProfile(source), [])).profile;

    expect(profile.displayName).toBe(source.displayName);
    expect(profile.bindings).toHaveLength(2);
    expect(bindingsFor(profile, save)).toEqual(bindingsFor(source, save));
    expect(bindingsFor(profile, palette)).toEqual(bindingsFor(source, palette));
  });

  it('never imports or restores a profile as built-in, so the user can edit what they read', () => {
    const builtIn: ShortcutProfile = { ...source, builtIn: true };
    expect(expectSuccess(importProfile(exportProfile(builtIn), [])).profile.builtIn).toBe(false);
    const shipped: ShortcutProfile = { ...builtIn, id: 'default' };
    expect(
      restoreProfiles([{ id: 'mine', text: exportProfile(builtIn) }], shipped).map(
        (one) => expectSuccess(one.restored).builtIn,
      ),
    ).toEqual([false]);
  });

  it('preserves every modifier of a press', () => {
    const everyModifier: ShortcutProfile = {
      ...source,
      bindings: [
        {
          commandId: save,
          shortcut: shortcut(
            keyPress('KeyS', { control: true, shift: true, alt: true, meta: true }),
          ),
        },
      ],
    };

    // Every press is read as it was written, whatever the platform it is read
    // on makes of it. A binding the platform takes was left out here, and on a
    // keyboard layout nothing was known of yet that lost it for good.
    const profile = expectSuccess(importProfile(exportProfile(everyModifier), [])).profile;
    expect(bindingsFor(profile, save)[0]?.presses[0]).toEqual({
      key: 'KeyS',
      control: true,
      shift: true,
      alt: true,
      meta: true,
    });
  });
});

describe('importProfile rejects a file it cannot trust', () => {
  it('rejects text that is not JSON', () => {
    expect(expectFailureCode(importProfile('not a profile', []))).toBe('shortcut-profile.not-json');
  });

  it('rejects JSON that is not an object', () => {
    // An array is refused by the object check, as the title says: passed by it,
    // the array would fail later, on its version.
    expect(expectFailureCode(importProfile('[]', []))).toBe('shortcut-profile.not-a-profile');
    expect(expectFailureCode(importProfile('null', []))).toBe('shortcut-profile.not-a-profile');
  });

  it('rejects a profile written for another format version', () => {
    const wrongVersion = JSON.stringify({ schemaVersion: 999, displayName: 'x', bindings: [] });
    expect(expectFailureCode(importProfile(wrongVersion, []))).toBe(
      'shortcut-profile.unsupported-version',
    );
  });

  it('rejects a profile with no name', () => {
    const noName = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: '   ',
      bindings: [],
    });
    expect(expectFailureCode(importProfile(noName, []))).toBe('shortcut-profile.has-no-name');
  });

  it('rejects a profile with no binding list', () => {
    const noBindings = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
    });
    expect(expectFailureCode(importProfile(noBindings, []))).toBe(
      'shortcut-profile.has-no-bindings',
    );
  });

  it('rejects a binding that names no command', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [{ presses: ['C+KeyS'] }],
    });
    expect(expectFailureCode(importProfile(text, []))).toBe(
      'shortcut-profile.binding-has-no-command',
    );
  });

  it('rejects a command identifier of the wrong shape', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [{ command: 'Not A Command', presses: ['C+KeyS'] }],
    });
    expect(expectFailureCode(importProfile(text, []))).toBe('shortcut-profile.command-malformed');
  });

  it('rejects a binding with no presses', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [{ command: 'file.save', presses: [] }],
    });
    expect(expectFailureCode(importProfile(text, []))).toBe(
      'shortcut-profile.binding-has-no-presses',
    );
  });

  it('rejects a press written without a key', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [{ command: 'file.save', presses: ['C+'] }],
    });
    expect(expectFailureCode(importProfile(text, []))).toBe('shortcut-profile.press-has-no-key');
  });

  it('rejects a press naming a modifier it does not recognise', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [{ command: 'file.save', presses: ['CX+KeyS'] }],
    });
    expect(expectFailureCode(importProfile(text, []))).toBe('shortcut-profile.unknown-modifier');
  });

  it('refuses a profile whose name is longer than any a person writes', () => {
    // A profile is something users share (REQ-UX-066), so the name in one is
    // not always the reader's own. It is stored, shown in the settings and put
    // into the sentence that says which profile is in force, and nothing
    // bounded it.
    const long = 'a'.repeat(200);
    const refused = importProfile(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
        displayName: long,
        bindings: [],
      }),
      [],
    );

    expect(expectFailureCode(refused)).toBe('shortcut-profile.name-too-long');
  });

  it('holds a name made here to the rule a name read from a file is held to', () => {
    expect(profileName('a'.repeat(121))).toEqual({
      kind: 'too-long',
      text: "A profile's name can be at most 120 characters long.",
    });
    expect(profileName('😀'.repeat(120))).toBe('😀'.repeat(120));
    expect(profileName('   ')).toEqual({ kind: 'blank', text: 'A profile needs a name.' });
  });

  it('counts a name in the characters a reader sees, as the refusal says', () => {
    // Each of these is two code units, and the refusal says characters.
    const read = (displayName: string) =>
      importProfile(
        JSON.stringify({
          schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
          displayName,
          bindings: [],
        }),
        [],
      );

    expect(expectSuccess(read('😀'.repeat(120))).profile.displayName).toBe('😀'.repeat(120));
    expect(expectFailureCode(read('😀'.repeat(121)))).toBe('shortcut-profile.name-too-long');
  });

  it('says why a name read from a file is refused, by the part of the rule that refused it', () => {
    // A name of nothing but space is not too long: a reader that said every
    // refused name was would say so of a blank one.
    const summaryOf = (displayName: string): string | undefined => {
      const result = importProfile(
        JSON.stringify({
          schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
          displayName,
          bindings: [],
        }),
        [],
      );
      return result.ok ? undefined : result.failures[0].summary;
    };

    expect(summaryOf('   ')).toBe('That profile has no name.');
    expect(summaryOf('a'.repeat(121))).toBe("That profile's name is longer than 120 characters.");

    // A name that is not text is refused by the same rule, in the same words
    // and with the same code, rather than by a second copy of them.
    const notText = importProfile(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
        displayName: 42,
        bindings: [],
      }),
      [],
    );
    expect(notText.ok ? undefined : notText.failures[0].summary).toBe('That profile has no name.');
    expect(expectFailureCode(notText)).toBe('shortcut-profile.has-no-name');
  });

  it('refuses a name built of letters under more marks than any real character carries', () => {
    // Twelve letters a reader sees, and a hundred and twenty thousand code
    // units that the sentence naming the profile in force would read out.
    const stacked = `e${String.fromCodePoint(0x301).repeat(10_000)}`.repeat(12);
    const refused = importProfile(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
        displayName: stacked,
        bindings: [],
      }),
      [],
    );

    expect(expectFailureCode(refused)).toBe('shortcut-profile.name-too-long');
  });

  it('reads a name of a length a person writes', () => {
    // So the rule above is a bound rather than a refusal of every name.
    const profile = expectSuccess(
      importProfile(
        JSON.stringify({
          schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
          displayName: 'My shortcuts for mastering, with the transport on the number row',
          bindings: [],
        }),
        [],
      ),
    ).profile;

    expect(profile.displayName).toBe(
      'My shortcuts for mastering, with the transport on the number row',
    );
  });

  it('reports every malformed press of one binding at once, the first press first', () => {
    // The first press is read apart from the rest and the two failures are
    // merged. With one press per binding, as every other malformed binding here
    // has, the merge would run for none of them, and dropping the later
    // failures would change nothing any test reads.
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [{ command: 'file.save', presses: ['C+', 'CX+KeyO'] }],
    });

    const result = importProfile(text, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // In order, which is what reading the first press apart from the rest is
      // for. Were the order asserted by nothing, the two spreads could be
      // swapped with every test still passing, and a reader of a file with one
      // bad press early and one late would be told about the late one first.
      expect(result.failures.map((one) => one.summary)).toEqual([
        'Press 1 names no key.',
        'Press 2 names a modifier AudioGubbins does not recognise.',
      ]);
    }
  });

  it('quotes only a short plain form of a value the file gave, never the value whole', () => {
    // A profile is something users share (REQ-UX-066), so a value in one is
    // not always the reader's own. The version field was interpolated whole
    // into the refusal, which goes to an assertive live region a screen-reader
    // user cannot interrupt and a notice a sighted user cannot dismiss: a file
    // of a quarter of a megabyte under the size bound was a sentence of a
    // quarter of a megabyte.
    const text = JSON.stringify({
      schemaVersion: 'v'.repeat(250_000),
      displayName: 'x',
      bindings: [],
    });

    const result = importProfile(text, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const failure of result.failures) expect(failure.summary.length).toBeLessThan(300);
    }

    // The details beside the sentence too. Nothing in this phase reads one, so
    // the first surface to show one would have taken the value whole from the
    // same refusal the sentence was bounded in.
    const presses = importProfile(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
        displayName: 'x',
        bindings: [
          { command: 'file.save', presses: ['v'.repeat(250_000)] },
          { command: 'v'.repeat(250_000), presses: ['C+KeyS'] },
        ],
      }),
      [],
    );
    expect(presses.ok).toBe(false);
    if (!presses.ok) {
      for (const failure of presses.failures) {
        for (const value of Object.values(failure.details ?? {})) {
          expect(String(value).length).toBeLessThan(300);
        }
      }
    }
  });

  it('reports every malformed binding at once', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [
        { command: 'file.save', presses: ['C+'] },
        { command: 'file.open', presses: ['CX+KeyO'] },
      ],
    });

    const result = importProfile(text, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.map((one) => one.code)).toEqual([
        'shortcut-profile.press-has-no-key',
        'shortcut-profile.unknown-modifier',
      ]);
    }
  });

  it('rejects a binding that is not an object', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: ['C+KeyS'],
    });
    expect(expectFailureCode(importProfile(text, []))).toBe(
      'shortcut-profile.binding-not-an-object',
    );
  });

  it('rejects a press that is not text', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [{ command: 'file.save', presses: [{ key: 'KeyS' }] }],
    });
    expect(expectFailureCode(importProfile(text, []))).toBe('shortcut-profile.press-not-text');
  });

  it('rejects a press written without the plus sign between its modifiers and its key', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'x',
      bindings: [{ command: 'file.save', presses: ['CKeyS'] }],
    });
    expect(expectFailureCode(importProfile(text, []))).toBe('shortcut-profile.press-malformed');
  });
});

describe('parseShortcut', () => {
  it('reads a shortcut as the profile writes one, press by press', () => {
    expect(expectSuccess(parseShortcut('  C+KeyK   CS+KeyP '))).toEqual(
      shortcut(
        keyPress('KeyK', { control: true }),
        keyPress('KeyP', { control: true, shift: true }),
      ),
    );
  });

  it('refuses a shortcut of no presses', () => {
    expect(expectFailureCode(parseShortcut('   '))).toBe('shortcut-profile.binding-has-no-presses');
  });

  it('refuses a press as an imported file would', () => {
    expect(expectFailureCode(parseShortcut('C+KeyK KeyP'))).toBe(
      'shortcut-profile.press-malformed',
    );
  });
});

describe('a profile holding shortcuts the platform takes', () => {
  it('is read whole, so a binding the browser would take is not lost', () => {
    // Left out here, a binding was gone for good. What the platform takes is
    // decided where the keyboard layout is known and said beside the table,
    // which is the only place it can be said as the layout becomes known.
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'From another platform',
      bindings: [
        { command: 'file.save', presses: ['C+KeyS'] },
        { command: 'file.close', presses: ['C+KeyW'] },
      ],
    });

    const profile = expectSuccess(importProfile(text, [])).profile;

    expect(profile.bindings).toHaveLength(2);
    expect(bindingsFor(profile, save)).toHaveLength(1);
    expect(bindingsFor(profile, commandId('file.close'))[0]?.presses[0]?.key).toBe('KeyW');
  });

  it('keeps a binding whose second press is kept for the browser', () => {
    // A chord is AudioGubbins' own state, so Ctrl+L is refused as the second
    // press of Ctrl+K Ctrl+L as it is on its own: it is how a keyboard
    // reaches the address bar. The user is told, and the binding stays where
    // they put it.
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'Chords',
      bindings: [{ command: 'view.theme-light', presses: ['C+KeyK', 'C+KeyL'] }],
    });
    expect(
      isReservedByPlatform(
        shortcut(keyPress('KeyL', { control: true })),
        KeyboardConvention.Windows,
        UNKNOWN_LAYOUT,
      ),
    ).toBe(true);

    const profile = expectSuccess(importProfile(text, [])).profile;
    expect(bindingsFor(profile, commandId('view.theme-light'))[0]?.presses).toHaveLength(2);
  });

  it('reads the bindings a file holds as they are written, whatever platform wrote them', () => {
    // Control+W closes a tab on Windows and does nothing in a browser on a
    // Mac, where Command+W does. Nothing here depends on which it is: each
    // press is read as the file writes it, and not turned into another.
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'Carried between machines',
      bindings: [
        { command: 'file.close', presses: ['C+KeyW'] },
        { command: 'view.theme-light', presses: ['M+KeyJ'] },
      ],
    });

    const { bindings } = expectSuccess(importProfile(text, [])).profile;
    expect(bindings.map((one) => [one.commandId, shortcutKey(one.shortcut)])).toEqual([
      ['file.close', 'C+KeyW'],
      ['view.theme-light', 'M+KeyJ'],
    ]);
  });
});
