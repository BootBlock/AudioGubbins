import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  bindingsFor,
  exportProfile,
  restoreProfiles,
  shortcut,
  shortcutKey,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { LONGEST_COST_TEST_MS, relativeCost } from '@audiogubbins/test-fixtures';
import { keyPress } from '@audiogubbins/input';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';

import { shellCommands } from '../commands/shell-commands.js';
import type { ShellContext } from '../commands/shell-context.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { DEFAULT_PROFILE_ID } from './default-shortcuts.js';
import { wholeNotice } from './recovery-notices.js';
import { textsSetAside } from './set-aside-texts.js';

/**
 * Stored shortcut profiles this build cannot read, whole or in part.
 *
 * A profile is work the user made (REQ-UX-066), and what could not be read is
 * in no list: the first rebind, switch, copy, import or reset writes the
 * profiles over it. It is set aside before that write, and the user is told
 * what could not be read and where its text is.
 */

const PROFILES = 'audiogubbins.shortcuts';
const SET_ASIDE = 'audiogubbins.shortcuts.unreadable';

/** Ctrl+Alt+B, which nothing in the default profile uses. */
const FREE = shortcut(keyPress('KeyB', { control: true, alt: true }));

/** Ctrl+Alt+J, which nothing in the default profile uses either. */
const ALSO_FREE = shortcut(keyPress('KeyJ', { control: true, alt: true }));

/** Text that is not JSON, where the profiles should be. */
const NOT_JSON = '{"schemaVersion":1,"selectedId":"mine","profiles":[';

/** What AudioGubbins says it does while there is no room to set the text aside. */
const TRIES_AGAIN =
  'AudioGubbins tries again each time you change your shortcuts, and at the next start.';

/** The start of the advice on making room, which the status bar shows apart. */
const ADVICE = 'To make room without losing anything';

/** Where the notice says the text can be exported or discarded. */
const EXPORT_IT = 'The Shortcuts settings can export what could not be read, or discard it.';

/** The notice about the stored profiles, as the status bar shows it, while it stands. */
function noticeOf(context: ShellContext): string | undefined {
  const { recovery } = context.shortcuts.get();
  return recovery === undefined ? undefined : wholeNotice(recovery);
}

/** Storage holding the given text where the profiles are kept. */
function storageHolding(text: string) {
  const raw = ephemeralStorage();
  raw.write(PROFILES, text);
  return raw;
}

/** The texts set aside, in the order they were. */
const setAside = (raw: ReturnType<typeof ephemeralStorage>): readonly string[] =>
  textsSetAside(raw.read(SET_ASIDE));

/** A change the user makes, which writes the profiles. */
function change(context: ShellContext, to = FREE, command = 'settings.open'): void {
  expect(context.shortcuts.rebind(commandId(command), to)).toBeUndefined();
}

/**
 * Storage whose set-aside key is at its quota until room is made: a write of
 * it is refused while `full` holds, and kept once it does not.
 */
function quotaFor(raw: ReturnType<typeof ephemeralStorage>) {
  const quota = {
    full: true,
    storage: {
      ...raw,
      write: (key: string, value: string) => {
        if (quota.full && key === SET_ASIDE) throw new Error('The quota is full.');
        raw.write(key, value);
      },
    },
  };
  return quota;
}

/**
 * The stored text of two profiles the user made, "Mine" and "Theirs", with a
 * third entry each of `broken` beside them, and the one named in force.
 */
function profilesWithBroken(selectedId: string, ...broken: readonly unknown[]): string {
  const raw = ephemeralStorage();
  const { context } = buildShellContext(raw);
  expect(context.shortcuts.duplicate('Mine')).toBeUndefined();
  expect(context.shortcuts.duplicate('Theirs')).toBeUndefined();

  const stored: unknown = JSON.parse(raw.read(PROFILES) ?? '');
  if (typeof stored !== 'object' || stored === null || !('profiles' in stored)) {
    throw new Error('The profiles were not stored.');
  }
  const { profiles } = stored;
  if (!Array.isArray(profiles)) throw new Error('The profiles were not stored as a list.');
  return JSON.stringify({ ...stored, selectedId, profiles: [...profiles, ...broken] });
}

/** An entry `readProfile` refuses: a binding with a modifier no keyboard has. */
const REFUSED = {
  id: 'broken',
  text: '{"schemaVersion":1,"displayName":"Broken","bindings":[{"command":"settings.open","presses":["Q+KeyZ"]}]}',
};

/** Runs a shell command against a context. */
function busFor(context: ShellContext) {
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  const bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
  return (id: string) => bus.execute(context, { commandId: commandId(id) });
}

describe('shortcuts in a browser that cannot compare names', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('refuses in words to copy the built-in shortcuts or to import, and keeps what is in force', async () => {
    // A change to the built-in shortcuts is made in a copy, which is named: a
    // copy that cannot be named throws where it is refused without a word.
    const RealCollator = Intl.Collator;
    vi.spyOn(Intl, 'Collator').mockImplementation(
      class extends RealCollator {
        constructor(_locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
          super('tr', options);
        }
      },
    );
    vi.resetModules();
    const { buildShellContext: build } = await import('../testing/shell-context.js');
    const { context } = build(ephemeralStorage());
    const before = context.shortcuts.get().profile;
    const REFUSED = [
      'This browser cannot compare names as AudioGubbins does, so a profile cannot be copied, imported or named here.',
    ];

    expect(context.shortcuts.rebind(commandId('settings.open'), FREE)).toEqual(REFUSED);
    expect(context.shortcuts.unbind(commandId('settings.open'))).toEqual(REFUSED);
    expect(context.shortcuts.duplicate('Mine')).toBe(REFUSED[0]);
    expect(context.shortcuts.imported(exportProfile({ ...before, displayName: 'Mine' }))).toEqual({
      kind: 'refused',
      refusal: REFUSED,
    });
    expect(context.shortcuts.get().profile).toBe(before);
  });
});

describe('stored shortcut profiles that cannot be read', () => {
  it('sets aside text that is not JSON before the first change, and keeps it through the next', () => {
    const raw = storageHolding(NOT_JSON);
    const { context } = buildShellContext(raw);

    expect(noticeOf(context)).toBe(
      `The shortcut profiles you made could not be read, so the default shortcuts are in force. The text that could not be read is kept aside. ${EXPORT_IT}`,
    );
    expect(context.shortcuts.get().profile.id).toBe(DEFAULT_PROFILE_ID);

    change(context);
    expect(setAside(raw)).toEqual([NOT_JSON]);
    expect(raw.read(PROFILES)).not.toBe(NOT_JSON);

    change(context, ALSO_FREE);
    expect(setAside(raw)).toEqual([NOT_JSON]);
    expect(noticeOf(context)).toContain('kept aside');
  });

  it('sets aside profiles written in another format, and says they were', () => {
    // A newer build's format: this one cannot read it, and the first change
    // wrote this build's format over it.
    const newer = JSON.stringify({ schemaVersion: 99, selectedId: 'mine', profiles: [] });
    const raw = storageHolding(newer);
    const { context } = buildShellContext(raw);

    expect(noticeOf(context)).toBe(
      `The shortcut profiles you made were written in another format, one this version of AudioGubbins cannot read, so the default shortcuts are in force. The text that could not be read is kept aside. ${EXPORT_IT}`,
    );

    change(context);
    expect(setAside(raw)).toEqual([newer]);

    change(context, ALSO_FREE);
    expect(setAside(raw)).toEqual([newer]);
  });

  it('keeps the profiles it can read, sets aside the text of one it cannot, and says how many', () => {
    const stored = profilesWithBroken('mine', REFUSED);
    const raw = storageHolding(stored);
    const { context } = buildShellContext(raw);

    expect(context.shortcuts.get().available.map((one) => one.displayName)).toEqual([
      expect.any(String),
      'Mine',
      'Theirs',
    ]);
    expect(context.shortcuts.get().profile.displayName).toBe('Mine');
    expect(noticeOf(context)).toBe(
      `One of the shortcut profiles you made could not be read, so it is not listed. The text that could not be read is kept aside. ${EXPORT_IT}`,
    );

    change(context);
    expect(setAside(raw)).toEqual([stored]);
    expect(raw.read(PROFILES)).not.toContain('Broken');
    expect(raw.read(PROFILES)).toContain('Theirs');
  });

  it('says how many it left out, and that the defaults are in force where the one in use was among them', () => {
    const raw = storageHolding(profilesWithBroken('broken', REFUSED, 42));
    const { context } = buildShellContext(raw);

    expect(context.shortcuts.get().profile.id).toBe(DEFAULT_PROFILE_ID);
    expect(noticeOf(context)).toBe(
      `2 of the shortcut profiles you made could not be read, so they are not listed. The one in use was among them, so the default shortcuts are in force. The text that could not be read is kept aside. ${EXPORT_IT}`,
    );
  });

  it('logs what it could not read with no text of the user in it', () => {
    // An entry of no stored shape, and one of the stored shape that the reading
    // refuses, which carries a profile's name and bindings as a real one does.
    const refusedWithAName = {
      id: 'jane-smith',
      text: '{"schemaVersion":1,"displayName":"Jane Smith","bindings":[{"command":"view.theme-light","presses":["C+KeyT"]},{"command":"settings.open","presses":["Q+KeyZ"]}]}',
    };
    const raw = storageHolding(
      profilesWithBroken('mine', { id: 'Jane Smith', note: 'Jane' }, refusedWithAName),
    );
    const { logs } = buildShellContext(raw);

    const records = logs.snapshot();
    expect(
      records
        .filter((record) => record.message.startsWith('A stored shortcut profile'))
        .map((record) => record.fields),
    ).toEqual([
      { position: 3, firstProblem: 'not-a-stored-profile' },
      { position: 4, firstProblem: expect.any(String) },
    ]);
    // Every record, its message and its fields, of every level.
    const logged = JSON.stringify(records.map(({ message, fields }) => [message, fields]));
    for (const text of ['Jane', 'Smith', 'jane-smith', 'C+KeyT', 'Q+KeyZ', 'theme-light']) {
      expect(logged).not.toContain(text);
    }
  });

  it('leaves out each profile stored under an identifier out of shape, sets the text aside, and logs none of it', () => {
    // Kept as stored, the identifier would be the name of the file the profile
    // is exported to and the words of the announcement: a hidden file, an
    // extension turned around, a separator, a second line, or a megabyte.
    const outOfShape = [
      '',
      'a\u202Egnp.exe',
      'x'.repeat(1_000_000),
      'a/b',
      'a\nb',
      '-a',
      'a--b',
      'Theirs',
    ];
    const text = exportProfile({ id: 'x', displayName: 'Hostile', builtIn: false, bindings: [] });
    const stored = profilesWithBroken('mine', ...outOfShape.map((id) => ({ id, text })));
    const raw = storageHolding(stored);
    const { context, logs } = buildShellContext(raw);

    expect(context.shortcuts.get().available.map((one) => one.displayName)).toEqual([
      expect.any(String),
      'Mine',
      'Theirs',
    ]);
    expect(context.shortcuts.get().profile.displayName).toBe('Mine');
    expect(noticeOf(context)).toBe(
      `8 of the shortcut profiles you made could not be read, so they are not listed. The text that could not be read is kept aside. ${EXPORT_IT}`,
    );

    const records = logs.snapshot();
    expect(
      records
        .filter((record) => record.message.startsWith('A stored shortcut profile'))
        .map((record) => record.fields),
    ).toEqual(
      outOfShape.map((_, at) => ({
        position: 3 + at,
        firstProblem: 'shortcut-profile.identifier-out-of-shape',
      })),
    );
    const logged = JSON.stringify(records.map(({ message, fields }) => [message, fields]));
    for (const told of ['gnp', 'a/b', 'a\\nb', 'xxxxxxxx', 'a--b', 'Hostile']) {
      expect(logged).not.toContain(told);
    }

    change(context);
    expect(setAside(raw)).toEqual([stored]);
    expect(raw.read(PROFILES)).not.toContain('Hostile');
    expect(raw.read(PROFILES)).toContain('Theirs');
  });

  it('writes nothing over the text while there is no room to set it aside, and sets it aside with the first change after room is made', () => {
    const raw = storageHolding(NOT_JSON);
    const quota = quotaFor(raw);
    const { context, storage } = buildShellContext(quota.storage);

    expect(noticeOf(context)).toBe(
      `The shortcut profiles you made could not be read, so the default shortcuts are in force. Changes to your shortcuts cannot be kept until there is room. The text that could not be read is left where it is, and there is no room to set it aside. ${TRIES_AGAIN} ${EXPORT_IT}`,
    );

    change(context);
    expect(raw.read(PROFILES)).toBe(NOT_JSON);
    expect(storage.get().unsaved).toEqual(['shortcuts']);
    const told = context.interaction.get().announcement?.text;
    expect(told).toBe(
      `Changes to your shortcuts cannot be kept until there is room to set aside the shortcut profiles that could not be read. ${TRIES_AGAIN}`,
    );
    // Said over the change just made: the fact, and no advice, and no change
    // said to be saved in the breath that says it is not kept.
    expect(told).not.toContain(ADVICE);
    expect(told).not.toContain('is saved');
    expect(noticeOf(context)).not.toContain(ADVICE);

    quota.full = false;
    change(context, ALSO_FREE, 'view.theme-light');

    expect(setAside(raw)).toEqual([NOT_JSON]);
    expect(raw.read(PROFILES)).toContain('My shortcuts');
    expect(storage.get().unsaved).toEqual([]);
    expect(noticeOf(context)).toBe(
      `The shortcut profiles you made could not be read, so the default shortcuts are in force. The text that could not be read is kept aside. ${EXPORT_IT}`,
    );
    expect(context.interaction.get().announcement?.text).toBe(
      'There is room now to set aside the shortcut profiles that could not be read, so changes to your shortcuts are kept again.',
    );

    // Both changes are kept: the one made while there was no room too.
    const later = buildShellContext(raw).context;
    const { profile } = later.shortcuts.get();
    expect(profile.displayName).toBe('My shortcuts');
    expect(bindingsFor(profile, commandId('settings.open')).map(shortcutKey)).toEqual([
      shortcutKey(FREE),
    ]);
    expect(bindingsFor(profile, commandId('view.theme-light')).map(shortcutKey)).toEqual([
      shortcutKey(ALSO_FREE),
    ]);
    expect(later.shortcuts.get().recovery).toBeUndefined();
  });
});

describe('the notice about the stored shortcut profiles', () => {
  it('can be dismissed, and dismissing it destroys nothing', () => {
    const raw = storageHolding(NOT_JSON);
    const quota = quotaFor(raw);
    const { context } = buildShellContext(quota.storage);
    const run = busFor(context);

    expect(run('shortcuts.dismiss-notice').kind).toBe('applied');
    expect(context.shortcuts.get().recovery).toBeUndefined();
    expect(context.interaction.get().announcement?.text).toBe(
      'The notice about your shortcut profiles is dismissed.',
    );
    expect(raw.read(PROFILES)).toBe(NOT_JSON);

    // Still held where it was found, and set aside once there is room.
    change(context);
    expect(raw.read(PROFILES)).toBe(NOT_JSON);
    quota.full = false;
    change(context, ALSO_FREE);
    expect(setAside(raw)).toEqual([NOT_JSON]);

    // Put away, it stays away.
    expect(context.shortcuts.get().recovery).toBeUndefined();

    // Dismissed after the text is set aside, it leaves what was set aside as
    // it was, through the next change as well.
    const kept = storageHolding(NOT_JSON);
    const later = buildShellContext(kept).context;
    change(later);
    expect(setAside(kept)).toEqual([NOT_JSON]);
    expect(busFor(later)('shortcuts.dismiss-notice').kind).toBe('applied');
    expect(setAside(kept)).toEqual([NOT_JSON]);
    change(later, ALSO_FREE);
    expect(setAside(kept)).toEqual([NOT_JSON]);
  });

  it('says the text waits for room after the notice is dismissed, until it is set aside', () => {
    // The advice on making room goes with nothing the user does but making
    // it, so it is held apart from the notice the user can dismiss.
    const raw = storageHolding(NOT_JSON);
    const quota = quotaFor(raw);
    const { context } = buildShellContext(quota.storage);
    expect(context.shortcuts.get().waitsForRoom).toBe(true);

    expect(context.shortcuts.acknowledgeRecovery()).toBeUndefined();
    change(context);
    expect(context.shortcuts.get().recovery).toBeUndefined();
    expect(context.shortcuts.get().waitsForRoom).toBe(true);

    quota.full = false;
    change(context, ALSO_FREE);
    expect(context.shortcuts.get().waitsForRoom).toBe(false);
    expect(buildShellContext(storageHolding(NOT_JSON)).context.shortcuts.get().waitsForRoom).toBe(
      false,
    );
  });

  it("is dismissed in the palette by the name the status bar's button has", () => {
    const dismissal = shellCommands(DESCRIPTORS).find(
      (one) => one.id === commandId('shortcuts.dismiss-notice'),
    );

    expect(dismissal?.label).toBe('Dismiss the notice about your shortcut profiles');
  });

  it('refuses to dismiss a notice that is not showing, and says there is none', () => {
    const { context } = buildShellContext();
    const run = busFor(context);

    expect(context.shortcuts.acknowledgeRecovery()).toBe(
      'There is no notice about your shortcut profiles.',
    );
    const result = run('shortcuts.dismiss-notice');
    expect(result.kind === 'refused' ? result.failures[0].summary : undefined).toBe(
      'There is no notice about your shortcut profiles.',
    );
  });
});

describe('the names and identifiers of the profiles the user made', () => {
  it('holds the profile AudioGubbins ships under an identifier in the shape a stored one is held to', () => {
    // Out of that shape, a profile stored under the shipped one's identifier
    // would be refused rather than numbered beside it.
    const { context } = buildShellContext(ephemeralStorage());
    const { available, profile: shipped } = context.shortcuts.get();
    expect(available.map((one) => one.id)).toEqual([DEFAULT_PROFILE_ID]);

    const stored = available.map((one) => ({ id: one.id, text: exportProfile(one) }));
    expect(
      restoreProfiles(stored, shipped).map(({ restored }) =>
        restored.ok ? restored.value.id : restored.failures[0].code,
      ),
    ).toEqual([`${DEFAULT_PROFILE_ID}-2`]);
  });

  it('numbers the copy each change to the defaults makes, so no two share a name or an identifier', () => {
    // Every copy of the defaults was "My shortcuts", two entries the settings
    // list and "The … shortcuts are in force" could not tell apart.
    const { context } = buildShellContext(ephemeralStorage());
    change(context);
    const first = context.shortcuts.get().profile;
    expect(context.shortcuts.switchTo(DEFAULT_PROFILE_ID)).toBeUndefined();
    change(context);
    const second = context.shortcuts.get().profile;

    expect([first.displayName, second.displayName]).toEqual(['My shortcuts', 'My shortcuts 2']);
    expect(second.id).not.toBe(first.id);
    expect(context.shortcuts.get().available).toHaveLength(3);
  });

  it('refuses a typed name another profile has, compared as a reader hears it, and changes nothing', () => {
    const { context } = buildShellContext(ephemeralStorage());
    expect(context.shortcuts.duplicate('Mine')).toBeUndefined();
    expect(context.shortcuts.switchTo(DEFAULT_PROFILE_ID)).toBeUndefined();
    const before = context.shortcuts.get();

    expect(context.shortcuts.duplicate('  MINE ')).toBe(
      'There is already a profile called "Mine". Choose another name.',
    );
    expect(context.shortcuts.get().profile.id).toBe(before.profile.id);
    expect(context.shortcuts.get().available).toEqual(before.available);
  });

  it('names a copy of a profile the user made after it, where nobody chose a name', () => {
    const { context } = buildShellContext(ephemeralStorage());
    expect(context.shortcuts.duplicate('Mine')).toBeUndefined();
    const mine = context.shortcuts.get().profile.id;

    expect(context.shortcuts.duplicate()).toBeUndefined();
    expect(context.shortcuts.get().profile.displayName).toBe('Mine copy');
    expect(context.shortcuts.switchTo(mine)).toBeUndefined();
    expect(context.shortcuts.duplicate()).toBeUndefined();
    expect(context.shortcuts.get().profile.displayName).toBe('Mine copy 2');
  });

  it("loads stored profiles that share a name or an identifier, the built-in one's included, and keeps each", () => {
    // Stored work is never refused for a name another profile has, and one
    // stored under an identifier another holds took its place: the one before
    // it was lost at the next write, and one under the built-in identifier sat
    // behind the built-in profile.
    const entry = (id: string) => ({
      id,
      text: exportProfile({ id, displayName: 'Twin', builtIn: false, bindings: [] }),
    });
    const raw = storageHolding(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
        selectedId: 'twin',
        profiles: [entry('twin'), entry('twin'), entry(DEFAULT_PROFILE_ID)],
      }),
    );
    const { context } = buildShellContext(raw);

    const { available, recovery } = context.shortcuts.get();
    expect(recovery).toBeUndefined();
    expect(available.map((one) => one.id)).toEqual([
      DEFAULT_PROFILE_ID,
      'twin',
      'twin-2',
      `${DEFAULT_PROFILE_ID}-2`,
    ]);
    expect(available.filter((one) => one.displayName === 'Twin')).toHaveLength(3);

    change(context);
    const stored: unknown = JSON.parse(raw.read(PROFILES) ?? '');
    expect(stored).toMatchObject({
      profiles: [{ id: 'twin' }, { id: 'twin-2' }, { id: 'default-2' }],
    });
  });

  it(
    'loads stored profiles under one identifier in time that grows with their number, not its square',
    { timeout: LONGEST_COST_TEST_MS },
    () => {
      // Given the identifiers held anew for each profile read, or searched one
      // by one, the time grows with the square of the number stored, and a
      // stored list of thousands holds the start. Held by the processor time,
      // so no way of holding them escapes it: four times as many profiles cost
      // about three and a quarter to four and three quarters times as much,
      // about ten times with those held searched one by one, and some sixteen
      // with each count started from two. That last takes seconds a reading,
      // within the time a test of cost is allowed.
      const text = exportProfile({ id: 'twin', displayName: 'Twin', builtIn: false, bindings: [] });
      const load = (count: number) => {
        const stored = JSON.stringify({
          schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
          selectedId: 'twin',
          profiles: Array.from({ length: count }, () => ({ id: 'twin', text })),
        });
        return () => buildShellContext(storageHolding(stored)).context.shortcuts.get().available;
      };

      expect(load(1000)()).toHaveLength(1001);
      expect(relativeCost(load(12_000), load(3000))).toBeLessThan(6.5);
    },
  );

  it('loads thousands of stored profiles under one identifier, each under its own, in order', () => {
    const count = 3000;
    const text = exportProfile({ id: 'twin', displayName: 'Twin', builtIn: false, bindings: [] });
    const raw = storageHolding(
      JSON.stringify({
        schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
        selectedId: 'twin',
        profiles: Array.from({ length: count }, () => ({ id: 'twin', text })),
      }),
    );
    const { context } = buildShellContext(raw);

    const { available, recovery } = context.shortcuts.get();
    expect(recovery).toBeUndefined();
    expect(available.map((one) => one.id)).toEqual([
      DEFAULT_PROFILE_ID,
      'twin',
      ...Array.from({ length: count - 1 }, (_, index) => `twin-${String(index + 2)}`),
    ]);
  });
});
