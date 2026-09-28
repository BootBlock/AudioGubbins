import { beforeEach, describe, expect, it } from 'vitest';

import {
  KeyboardConvention,
  commandId,
  commandForShortcut,
  createCommandBus,
  createCommandRegistry,
  type ExecutionResult,
  exportProfile,
  shortcut,
  shortcutKey,
  type CommandBus,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { keyPress } from '@audiogubbins/input';
import { SCHEMA_VERSIONS } from '@audiogubbins/version';
import { keyEventOf } from '@audiogubbins/input/testing';

import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { DESCRIPTORS, buildShellContext, withoutNaming } from '../testing/shell-context.js';
import type { RecordedTextFiles } from '../testing/text-files.js';
import { DEFAULT_PROFILE_ID } from '../state/default-shortcuts.js';
import { shellCommands } from './shell-commands.js';
import type { ShellContext } from './shell-context.js';

/**
 * Remapping shortcuts (REQ-UX-066).
 *
 * "Users must be able to fully remap shortcuts." The operations are tested in
 * the command package on their own; these hold the shell commands that call
 * them, without which nothing a user did could remap a shortcut.
 */

let context: ShellContext;
let files: RecordedTextFiles;
let bus: CommandBus<ShellContext>;
let storage: ReturnType<typeof ephemeralStorage>;

/** Builds the shell over the given storage, as a reload would. */
function start(convention: KeyboardConvention = KeyboardConvention.Windows): void {
  const built = buildShellContext(storage, convention);
  context = built.context;
  files = built.files;

  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
}

beforeEach(() => {
  storage = ephemeralStorage();
  start();
});

function run(id: string, args?: Readonly<Record<string, string>>) {
  return bus.execute(context, {
    commandId: commandId(id),
    ...(args === undefined ? {} : { arguments: args }),
  });
}

/** Ctrl+Alt+B, which nothing in the default profile uses. */
const FREE = shortcut(keyPress('KeyB', { control: true, alt: true }));

/**
 * Why a command refused, or `undefined` when it did not.
 *
 * Read from the outcome rather than from the announcement. A command that
 * announced a refusal and reported success to the bus would pass tests that
 * read the announcement, so these tests ask the outcome, and the announcement
 * is what the interface does with it.
 */
function refusalOf(result: ExecutionResult<ShellContext>): string | undefined {
  return result.kind === 'refused' ? result.failures[0].summary : undefined;
}

describe('changing a shortcut', () => {
  it('binds a command to the combination the user chose', () => {
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });

    expect(commandForShortcut(context.shortcuts.get().profile, FREE)).toBe(
      commandId('settings.open'),
    );
  });

  it('copies the built-in profile rather than refusing', () => {
    // "Duplicate it first" is an answer for whoever wrote the store, not for
    // someone who has just pressed a key combination.
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });

    const { profile, available } = context.shortcuts.get();
    expect(profile.builtIn).toBe(false);
    expect(available.some((one) => one.id === DEFAULT_PROFILE_ID)).toBe(true);
  });

  it('replaces what the command was bound to, rather than adding beside it', () => {
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });

    const bound = context.shortcuts
      .get()
      .profile.bindings.filter((binding) => binding.commandId === commandId('settings.open'));
    expect(bound).toHaveLength(1);
  });

  it('refuses a combination the browser takes first, says why, and changes nothing', () => {
    const outcome = run('shortcuts.rebind', {
      commandId: 'settings.open',
      shortcut: shortcutKey(shortcut(keyPress('KeyW', { control: true }))),
    });

    expect(refusalOf(outcome)).toBe(
      'Ctrl+W cannot be used: The browser closes the tab or the window with it. Choose another.',
    );

    // Still the built-in profile. A refusal that copied it anyway would leave
    // the user in a profile they never asked for, with nothing in it changed.
    expect(context.shortcuts.get().profile.builtIn).toBe(true);
    expect(context.shortcuts.get().available).toHaveLength(1);
  });

  it("refuses a combination the browser takes on this keyboard, though it is the command's already", () => {
    // Answered "already its shortcut" first, it hid that the browser takes the
    // press on the keyboard the layout had since shown.
    const atComma = shortcutKey(shortcut(keyPress('Comma', { control: true })));
    run('shortcuts.rebind', { commandId: 'view.theme-dark', shortcut: atComma });
    // On Dvorak the key at comma types W.
    context.keyboardLayout.learn(keyEventOf('Comma', 'w'));

    const outcome = run('shortcuts.rebind', { commandId: 'view.theme-dark', shortcut: atComma });

    expect(refusalOf(outcome)).toBe(
      'Ctrl+W cannot be used: The browser closes the tab or the window with it. Choose another.',
    );
  });

  it('refuses to delete the built-in profile without advice it cannot follow', () => {
    // It said to reset to the defaults, which the built-in profile is: while it
    // is in force, the reset is unavailable too.
    expect(refusalOf(run('shortcuts.delete'))).toBe('The built-in profile cannot be deleted.');
    expect(refusalOf(run('shortcuts.reset'))).toBe('The default shortcuts are already in force.');
  });

  it('reports a conflict the user created, so they can see which command lost', () => {
    const palette = context.shortcuts
      .get()
      .profile.bindings.find((binding) => binding.commandId === commandId('view.command-palette'));
    expect(palette).toBeDefined();

    run('shortcuts.rebind', {
      commandId: 'settings.open',
      shortcut: shortcutKey(palette?.shortcut ?? FREE),
    });

    expect(context.shortcuts.get().conflicts).toHaveLength(1);
  });

  it('removes a shortcut', () => {
    run('shortcuts.unbind', { commandId: 'settings.open' });

    expect(
      context.shortcuts
        .get()
        .profile.bindings.some((binding) => binding.commandId === commandId('settings.open')),
    ).toBe(false);
  });

  it('refuses an identifier no command could have, rather than throwing', () => {
    // The argument comes from wherever the invocation does, and `commandId`
    // throws on a malformed one: from a React event handler, where the failure
    // boundary cannot catch it.
    expect(
      refusalOf(run('shortcuts.rebind', { commandId: 'Not A Command', shortcut: 'Ctrl+J' })),
    ).toContain('no command');

    expect(refusalOf(run('shortcuts.unbind', { commandId: 'Not A Command' }))).toContain(
      'no command',
    );
  });

  it('refuses a shortcut written in a form it cannot read', () => {
    const outcome = run('shortcuts.rebind', {
      commandId: 'settings.open',
      shortcut: 'not a shortcut',
    });

    expect(refusalOf(outcome)).toBe(
      'Press 1 is not written as modifiers, a plus sign and a key code.',
    );
    expect(context.shortcuts.get().profile.builtIn).toBe(true);
  });
});

describe('keeping a profile', () => {
  it('survives a reload', () => {
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });
    start();

    expect(commandForShortcut(context.shortcuts.get().profile, FREE)).toBe(
      commandId('settings.open'),
    );
  });

  it('logs a stored profile it cannot read by its place in the list, not its identifier', () => {
    // A profile the user made is identified by the name they typed, and the
    // log goes into a diagnostic bundle by default.
    storage.write(
      'audiogubbins.shortcuts',
      JSON.stringify({
        schemaVersion: 1,
        selectedId: 'jane-smith-s-keys',
        profiles: [
          {
            id: 'jane-smith-s-keys',
            text: '{"schemaVersion":1,"displayName":"x","bindings":[{"command":"settings.open","presses":["Q+KeyZ"]}]}',
          },
        ],
      }),
    );
    const { logs } = buildShellContext(storage, KeyboardConvention.Windows);

    const [warning] = logs
      .snapshot()
      .filter((record) => record.message.startsWith('A stored shortcut profile'));
    expect(warning?.fields).toEqual({
      position: 1,
      firstProblem: 'shortcut-profile.unknown-modifier',
    });
  });

  it('logs a stored version written as text as no version at all', () => {
    storage.write(
      'audiogubbins.shortcuts',
      JSON.stringify({ schemaVersion: 'Jane Smith', selectedId: 'x', profiles: [] }),
    );
    const { logs } = buildShellContext(storage, KeyboardConvention.Windows);

    const [warning] = logs
      .snapshot()
      .filter((record) => record.message.startsWith('The stored shortcut profiles'));
    expect(warning?.fields['found']).toBe(-1);
  });

  it('refuses to copy a profile under a name its next read would refuse, and keeps one within it', () => {
    // A name of any length was stored and put in force, and the next load
    // left the profile out as a name too long to read.
    const before = context.shortcuts.get();

    expect(context.shortcuts.duplicate('a'.repeat(121))).toBe(
      "A profile's name can be at most 120 characters long.",
    );
    expect(context.shortcuts.get().profile.id).toBe(before.profile.id);
    expect(context.shortcuts.get().available).toHaveLength(before.available.length);

    expect(context.shortcuts.duplicate('a'.repeat(120))).toBeUndefined();
    start();
    expect(context.shortcuts.get().profile.displayName).toBe('a'.repeat(120));
  });

  it('returns to the defaults', () => {
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });
    run('shortcuts.reset');

    expect(context.shortcuts.get().profile.id).toBe(DEFAULT_PROFILE_ID);
  });

  it('deletes a profile the user made and returns to the defaults', () => {
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });
    run('shortcuts.delete');

    expect(context.shortcuts.get().profile.id).toBe(DEFAULT_PROFILE_ID);
    expect(context.shortcuts.get().available).toHaveLength(1);
  });

  it('switches between profiles', () => {
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });
    const mine = context.shortcuts.get().profile.id;

    run('shortcuts.switch-to', { profileId: DEFAULT_PROFILE_ID });
    expect(context.shortcuts.get().profile.id).toBe(DEFAULT_PROFILE_ID);

    run('shortcuts.switch-to', { profileId: mine });
    expect(context.shortcuts.get().profile.id).toBe(mine);
  });
});

describe('carrying a profile between machines', () => {
  it('exports the profile in force as a file', () => {
    run('shortcuts.export');

    expect(files.saved).toHaveLength(1);
    expect(files.saved[0]?.filename).toContain('.json');
    expect(files.saved[0]?.text).toBe(exportProfile(context.shortcuts.get().profile));
  });

  it('saves a profile with a long name in any script under a file name within 255 bytes, and says it whole, in quotation marks', () => {
    // Named after an identifier of 240 bytes, the file's name would be 268
    // bytes, past what a file system gives a name, and the browser would save
    // it under another name than the one announced.
    expect(context.shortcuts.duplicate('Ж'.repeat(120))).toBeUndefined();
    run('shortcuts.export');

    const filename = files.saved[0]?.filename ?? '';
    expect(filename).toBe(`${'ж'.repeat(113)}.audiogubbins-shortcuts.json`);
    expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(255);
    expect(context.interaction.get().announcement?.text).toBe(
      `The shortcuts were saved as "${'ж'.repeat(113)}.audiogubbins-shortcuts.json".`,
    );
  });

  it("says the file name of the built-in profile's second copy whole, its ending included", () => {
    expect(context.shortcuts.duplicate()).toBeUndefined();
    run('shortcuts.switch-to', { profileId: DEFAULT_PROFILE_ID });
    expect(context.shortcuts.duplicate()).toBeUndefined();
    run('shortcuts.export');

    expect(files.saved[0]?.filename).toBe('my-shortcuts-2.audiogubbins-shortcuts.json');
    expect(context.interaction.get().announcement?.text).toBe(
      'The shortcuts were saved as "my-shortcuts-2.audiogubbins-shortcuts.json".',
    );
  });

  it('says so when the browser will not save the file', () => {
    // REQ-PRIV-161 requires an export failure to stay local and actionable.
    context = { ...context, files: { save: () => 'The browser would not save the file.' } };
    expect(refusalOf(run('shortcuts.export'))).toContain('would not save');
  });

  it('imports an exported profile and puts it in force', () => {
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });
    const text = context.shortcuts.exported();

    storage = ephemeralStorage();
    start();
    run('shortcuts.import', { text });

    expect(commandForShortcut(context.shortcuts.get().profile, FREE)).toBe(
      commandId('settings.open'),
    );
  });

  it('imports a profile whose name another profile has under the first free number, and says so', () => {
    expect(context.shortcuts.duplicate('Mine')).toBeUndefined();
    const before = context.shortcuts.get();
    const text = exportProfile({ ...before.profile, displayName: ' mine' });

    expect(refusalOf(run('shortcuts.import', { text }))).toBeUndefined();
    const imported = context.shortcuts.get().profile;
    expect(imported.displayName).toBe('mine 2');
    expect(context.interaction.get().announcement?.text).toBe(
      'There is already a profile called "Mine", so the one imported is called "mine 2". Its shortcuts are in force.',
    );
    expect(context.shortcuts.get().available).toEqual([...before.available, imported]);
  });

  it('imports a profile under its name without the space around it, numbered where that is in use', () => {
    expect(context.shortcuts.duplicate('Mine')).toBeUndefined();
    const mine = context.shortcuts.get().profile;

    // Taken as it stands where no profile has it, and said with no namesake.
    const unheld = exportProfile({ ...mine, displayName: '  Theirs ' });
    expect(refusalOf(run('shortcuts.import', { text: unheld }))).toBeUndefined();
    expect(context.shortcuts.get().profile.displayName).toBe('Theirs');
    expect(context.interaction.get().announcement?.text).toBe(
      'The "Theirs" shortcuts are in force.',
    );

    const text = exportProfile({ ...mine, displayName: 'Mine ' });
    expect(refusalOf(run('shortcuts.import', { text }))).toBeUndefined();
    expect(context.shortcuts.get().profile.displayName).toBe('Mine 2');
  });

  it("imports its own export and the built-in profile's on the machine they were exported on", () => {
    // Refused for the name a profile held here has, neither could be carried
    // back without editing the file.
    const shipped = context.shortcuts.exported();
    expect(refusalOf(run('shortcuts.import', { text: shipped }))).toBeUndefined();
    expect(context.shortcuts.get().profile.displayName).toBe('AudioGubbins default 2');
    expect(context.shortcuts.get().profile.builtIn).toBe(false);

    expect(context.shortcuts.duplicate('Mine')).toBeUndefined();
    const own = context.shortcuts.exported();
    expect(refusalOf(run('shortcuts.import', { text: own }))).toBeUndefined();
    expect(context.shortcuts.get().profile.displayName).toBe('Mine 2');
    expect(context.shortcuts.get().available.map((one) => one.displayName)).toEqual([
      'AudioGubbins default',
      'AudioGubbins default 2',
      'Mine',
      'Mine 2',
    ]);
  });

  it('says both why an import is numbered and what the browser takes of it', () => {
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'AudioGubbins default',
      bindings: [{ command: 'view.theme-light', presses: ['C+KeyT'] }],
    });

    expect(refusalOf(run('shortcuts.import', { text }))).toBeUndefined();
    expect(context.interaction.get().announcement?.text).toBe(
      'There is already a profile called "AudioGubbins default", so the one imported is called "AudioGubbins default 2". Its shortcuts are in force. The browser or the system takes one of them on this keyboard; the Shortcuts settings say which.',
    );
  });

  it('imports a profile beside the one whose identifier its name derives, and keeps both', () => {
    expect(context.shortcuts.duplicate('Mine')).toBeUndefined();
    const mine = context.shortcuts.get().profile;
    const text = exportProfile({ ...mine, displayName: 'Mine!' });

    expect(refusalOf(run('shortcuts.import', { text }))).toBeUndefined();
    const imported = context.shortcuts.get().profile;
    expect(imported.id).not.toBe(mine.id);
    expect(context.shortcuts.get().available).toContainEqual(mine);
    expect(context.shortcuts.get().available).toContainEqual(imported);
  });

  it('refuses a file that is not a profile, and says why', () => {
    expect(refusalOf(run('shortcuts.import', { text: 'not json' }))).toContain(
      'not a shortcut profile',
    );
    expect(context.shortcuts.get().profile.id).toBe(DEFAULT_PROFILE_ID);
  });

  it('refuses a profile for every reason it finds, not only the first', () => {
    // The validator found both bad bindings and the store passed on one, so
    // the user heard one reason, mended it, and was refused again.
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSIONS.shortcutProfile,
      displayName: 'Two mistakes',
      bindings: [
        { command: 'settings.open', presses: ['C+'] },
        { command: 'view.theme-dark', presses: ['CX+KeyO'] },
      ],
    });

    const outcome = run('shortcuts.import', { text });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') expect(outcome.failures).toHaveLength(2);
  });
});

describe('a browser that cannot compare names', () => {
  const UNAVAILABLE =
    'Naming workspaces and shortcut profiles is unavailable in this browser; the Capabilities panel says why.';

  it('refuses to import, or to change the built-in shortcuts, pointing at the capability', () => {
    const without = withoutNaming(context);
    const exported = exportProfile({ ...context.shortcuts.get().profile, displayName: 'Mine' });
    const runWithout = (id: string, args: Readonly<Record<string, string>>) =>
      bus.execute(without, { commandId: commandId(id), arguments: args });

    expect(refusalOf(runWithout('shortcuts.import', { text: exported }))).toBe(UNAVAILABLE);
    expect(
      refusalOf(
        runWithout('shortcuts.rebind', {
          commandId: 'settings.open',
          shortcut: shortcutKey(FREE),
        }),
      ),
    ).toBe(UNAVAILABLE);
    expect(refusalOf(runWithout('shortcuts.unbind', { commandId: 'settings.open' }))).toBe(
      UNAVAILABLE,
    );
    expect(context.shortcuts.get().profile.builtIn).toBe(true);
  });

  it('changes a profile the user made as ever, which names nothing', () => {
    run('shortcuts.rebind', { commandId: 'settings.open', shortcut: shortcutKey(FREE) });
    expect(context.shortcuts.get().profile.builtIn).toBe(false);

    const without = withoutNaming(context);
    expect(
      refusalOf(
        bus.execute(without, {
          commandId: commandId('shortcuts.unbind'),
          arguments: { commandId: 'settings.open' },
        }),
      ),
    ).toBeUndefined();
  });
});

describe('the platform', () => {
  it('builds the profile in force for Apple hardware with Command', () => {
    start(KeyboardConvention.Apple);
    const presses = context.shortcuts.get().profile.bindings.flatMap((b) => b.shortcut.presses);

    expect(presses.some((press) => press.meta)).toBe(true);
    expect(presses.some((press) => press.control)).toBe(false);
  });
});
