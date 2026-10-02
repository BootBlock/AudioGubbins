import { describe, expect, it } from 'vitest';

import { commandId, type ExecutionResult } from '@audiogubbins/commands';

import { wholeNotice } from '../state/recovery-notices.js';
import { textsSetAside } from '../state/set-aside-texts.js';
import type { KeyValueStorage } from '../state/state-storage.js';
import { busOfShellCommands } from '../testing/command-availability.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { buildShellContext } from '../testing/shell-context.js';
import type { ShellContext } from './shell-context.js';

/**
 * The stored text AudioGubbins could not read, offered to export and discard.
 *
 * Kept and never offered, that text was the user's in name only: set aside,
 * nothing read it, and left where it was found for want of room, it withheld
 * its store's writes until a discard nobody could make.
 */

const MOUNTED = 'audiogubbins.workspace';
const MOUNTED_SET_ASIDE = 'audiogubbins.workspace.unreadable';
const COLLECTION = 'audiogubbins.workspaces';
const COLLECTION_SET_ASIDE = 'audiogubbins.workspaces.unreadable';
const PROFILES = 'audiogubbins.shortcuts';
const PROFILES_SET_ASIDE = 'audiogubbins.shortcuts.unreadable';

/** Text that is not JSON, where the collection should be. */
const NOT_JSON = '[{"id": "mine",';

/** Text that is not JSON, where the mounted layout should be. */
const LAYOUT_NOT_JSON = '{"schemaVersion": 1, "groups": [';

/** Text that is not JSON, where the profiles should be. */
const PROFILES_NOT_JSON = '{"schemaVersion":1,"selectedId":"mine","profiles":[';

/** Storage holding each key given its text. */
function holding(entries: Readonly<Record<string, string>>): ReturnType<typeof ephemeralStorage> {
  const raw = ephemeralStorage();
  for (const [key, text] of Object.entries(entries)) raw.write(key, text);
  return raw;
}

/** Storage over `raw` that refuses whatever is written under `keys`, as at the quota. */
function refusing(raw: KeyValueStorage, ...keys: readonly string[]): KeyValueStorage {
  return {
    ...raw,
    write: (key, value) => {
      if (keys.includes(key)) throw new DOMException('Full.', 'QuotaExceededError');
      raw.write(key, value);
    },
  };
}

/** Runs a shell command in `context`. */
function runIn(context: ShellContext) {
  const bus = busOfShellCommands();
  return (id: string, args?: Readonly<Record<string, string>>): ExecutionResult<ShellContext> =>
    bus.execute(context, {
      commandId: commandId(id),
      ...(args === undefined ? {} : { arguments: args }),
    });
}

/** Why a command refused, or `undefined` where it did not. */
function refusalOf(result: ExecutionResult<ShellContext>): string | undefined {
  return result.kind === 'refused' ? result.failures[0].summary : undefined;
}

/** What the last command said. */
function said(context: ShellContext): string | undefined {
  return context.interaction.get().announcement?.text;
}

/** One text as the exported file holds it. */
interface ExportedText {
  readonly about: string;
  readonly key: string;
  readonly where: string;
  readonly text: string;
}

/** The texts of the one file exported. */
function exportedTexts(files: ReturnType<typeof buildShellContext>['files']): ExportedText[] {
  expect(files.saved).toHaveLength(1);
  const parsed = JSON.parse(files.saved[0]?.text ?? '{}') as {
    readonly format: string;
    readonly texts: ExportedText[];
  };
  expect(parsed.format).toBe('audiogubbins.unread-text');
  return parsed.texts;
}

describe('exporting text that could not be read', () => {
  it('offers text set aside in an earlier session, with no notice and long before the quota', () => {
    // The lists only grew and had no reader: nothing offered them before the
    // room they took withheld a write.
    const raw = holding({
      [COLLECTION_SET_ASIDE]: JSON.stringify(['first damaged', 'second damaged']),
      [PROFILES_SET_ASIDE]: JSON.stringify(['profiles damaged']),
    });
    const { context, files } = buildShellContext(raw);

    expect(context.workspace.get().recoveries).toEqual([]);
    expect(context.workspace.get().unread).toEqual([
      { about: 'collection', setAside: 2, leftInPlace: 0 },
    ]);
    expect(context.shortcuts.get().unread).toEqual([
      { about: 'profiles', setAside: 1, leftInPlace: 0 },
    ]);

    expect(runIn(context)('settings.export-unread-text').kind).toBe('applied');

    expect(files.saved[0]?.filename).toBe('audiogubbins-unread-text.json');
    expect(exportedTexts(files)).toEqual([
      { about: 'collection', key: COLLECTION_SET_ASIDE, where: 'set aside', text: 'first damaged' },
      {
        about: 'collection',
        key: COLLECTION_SET_ASIDE,
        where: 'set aside',
        text: 'second damaged',
      },
      { about: 'profiles', key: PROFILES_SET_ASIDE, where: 'set aside', text: 'profiles damaged' },
    ]);
    expect(said(context)).toBe(
      'The text that could not be read was saved as "audiogubbins-unread-text.json".',
    );
    // An export takes nothing away.
    expect(textsSetAside(raw.read(COLLECTION_SET_ASIDE))).toEqual([
      'first damaged',
      'second damaged',
    ]);
  });

  it('exports text left where it was found for want of room, under the key it is stored under', () => {
    const raw = holding({ [MOUNTED]: LAYOUT_NOT_JSON });
    const { context, files } = buildShellContext(refusing(raw, MOUNTED_SET_ASIDE));

    expect(context.workspace.get().unread).toEqual([
      { about: 'layout', setAside: 0, leftInPlace: 1 },
    ]);
    runIn(context)('settings.export-unread-text', { about: 'layout' });

    expect(exportedTexts(files)).toEqual([
      { about: 'layout', key: MOUNTED, where: 'left where it was found', text: LAYOUT_NOT_JSON },
    ]);
  });

  it('exports what one thing named holds, an entry under an identifier out of shape among it', () => {
    // An identifier out of the shape one is derived in is left out of the
    // profiles, and its text set aside with them, so it is exported whole.
    const outOfShape = JSON.stringify({
      schemaVersion: 1,
      selectedId: 'Bad/Name',
      profiles: [{ id: 'Bad/Name', text: '{}' }],
    });
    const raw = holding({
      [PROFILES]: outOfShape,
      [COLLECTION_SET_ASIDE]: JSON.stringify(['not asked for']),
    });
    const { context, files } = buildShellContext(raw);

    runIn(context)('settings.export-unread-text', { about: 'profiles' });

    expect(exportedTexts(files)).toEqual([
      { about: 'profiles', key: PROFILES_SET_ASIDE, where: 'set aside', text: outOfShape },
    ]);
  });

  it('refuses where there is nothing, or nothing about the thing named, and says so', () => {
    const { context, files } = buildShellContext(
      holding({ [COLLECTION_SET_ASIDE]: JSON.stringify(['damaged']) }),
    );
    const run = runIn(context);

    expect(refusalOf(run('settings.export-unread-text', { about: 'profiles' }))).toBe(
      'There is no text about your shortcut profiles that could not be read.',
    );
    expect(refusalOf(run('settings.export-unread-text', { about: 'everything' }))).toBe(
      'There is no text that could not be read about anything called "everything".',
    );
    expect(files.saved).toEqual([]);

    const empty = buildShellContext().context;
    expect(
      busOfShellCommands().availability(empty, commandId('settings.export-unread-text')),
    ).toEqual({ available: false, reason: 'There is no text that could not be read.' });
  });

  it('says why where the browser will not save the file', () => {
    const built = buildShellContext(holding({ [COLLECTION_SET_ASIDE]: JSON.stringify(['x']) }));
    const context = {
      ...built.context,
      files: { save: () => 'The browser would not save the file.' },
    };

    expect(refusalOf(runIn(context)('settings.export-unread-text'))).toBe(
      'The browser would not save the file.',
    );
  });
});

describe('discarding text that could not be read', () => {
  it('discards what is set aside, puts away its notice, and says so', () => {
    const raw = holding({ [COLLECTION]: NOT_JSON });
    const { context } = buildShellContext(raw);
    expect(textsSetAside(raw.read(COLLECTION_SET_ASIDE))).toEqual([NOT_JSON]);
    expect(context.workspace.get().recoveries.map((one) => one.part)).toEqual(['collection']);

    expect(runIn(context)('settings.discard-unread-text', { about: 'collection' }).kind).toBe(
      'applied',
    );

    expect(raw.read(COLLECTION_SET_ASIDE)).toBeNull();
    expect(context.workspace.get().recoveries).toEqual([]);
    expect(context.workspace.get().unread).toEqual([]);
    expect(said(context)).toBe(
      'The text about your saved workspaces that could not be read is discarded.',
    );
  });

  it('discards only the thing named, and leaves the notice of another', () => {
    const raw = holding({ [COLLECTION]: NOT_JSON, [MOUNTED]: LAYOUT_NOT_JSON });
    const { context } = buildShellContext(raw);

    runIn(context)('settings.discard-unread-text', { about: 'layout' });

    expect(raw.read(MOUNTED_SET_ASIDE)).toBeNull();
    expect(textsSetAside(raw.read(COLLECTION_SET_ASIDE))).toEqual([NOT_JSON]);
    expect(context.workspace.get().recoveries.map((one) => one.part)).toEqual(['collection']);
  });

  it('lets go of text held in place, so the workspace on screen is kept again, and says it', () => {
    // Held in place, the text withheld every write of the workspace on
    // screen until a discard nobody could make.
    const raw = holding({ [MOUNTED]: LAYOUT_NOT_JSON });
    const { context, storage } = buildShellContext(refusing(raw, MOUNTED_SET_ASIDE));
    const run = runIn(context);
    run('workspace.move-panel-left');
    expect(storage.get().unsaved).toEqual(['workspace']);
    expect(context.workspace.get().waitsForRoom).toBe(true);
    const heard: string[] = [];
    context.interaction.subscribe(() => {
      heard.push(said(context) ?? '');
    });

    run('settings.discard-unread-text', { about: 'layout' });

    const onScreen: unknown = JSON.parse(raw.read(MOUNTED) ?? 'null');
    expect(onScreen).toEqual(context.workspace.get().layout);
    expect(storage.get().unsaved).toEqual([]);
    expect(context.workspace.get().waitsForRoom).toBe(false);
    expect(context.workspace.get().unread).toEqual([]);
    // Said as the discard's doing, and by nothing else: no room was made.
    expect(heard.join(' ')).not.toContain('There is room now');
    expect(said(context)).toBe(
      'The text about the workspace on screen that could not be read is discarded. The workspace on screen is kept again.',
    );
  });

  it('lets go of the collection and its copy held in place, so the workspaces saved are kept again', () => {
    const raw = holding({ [COLLECTION]: NOT_JSON, 'audiogubbins.workspaces.recovered': '[{"x"' });
    const { context, storage } = buildShellContext(refusing(raw, COLLECTION_SET_ASIDE));
    const run = runIn(context);
    run('workspace.save-as', { displayName: 'Kept once discarded' });
    expect(raw.read(COLLECTION)).toBe(NOT_JSON);

    run('settings.discard-unread-text', { about: 'collection' });

    expect(raw.read(COLLECTION)).toContain('Kept once discarded');
    expect(storage.get().unsaved).toEqual([]);
    expect(said(context)).toBe(
      'The text about your saved workspaces that could not be read is discarded. The workspaces you save are kept again.',
    );
  });

  it('lets go of the profiles held in place, so changes to the shortcuts are kept again', () => {
    const raw = holding({ [PROFILES]: PROFILES_NOT_JSON });
    const { context, storage } = buildShellContext(refusing(raw, PROFILES_SET_ASIDE));
    const run = runIn(context);
    run('shortcuts.unbind', { commandId: 'view.command-palette' });
    expect(raw.read(PROFILES)).toBe(PROFILES_NOT_JSON);

    run('settings.discard-unread-text', { about: 'profiles' });

    expect(raw.read(PROFILES)).not.toBe(PROFILES_NOT_JSON);
    expect(storage.get().unsaved).toEqual([]);
    expect(context.shortcuts.get()).toMatchObject({
      recovery: undefined,
      waitsForRoom: false,
      unread: [],
    });
    expect(said(context)).toBe(
      'The text about your shortcut profiles that could not be read is discarded. Changes to your shortcuts are kept again.',
    );
  });

  it('refuses with nothing named, anything unknown named, or nothing to discard', () => {
    const { context } = buildShellContext(
      holding({ [COLLECTION_SET_ASIDE]: JSON.stringify(['damaged']) }),
    );
    const run = runIn(context);

    // Never all at once: a discard cannot be undone.
    expect(refusalOf(run('settings.discard-unread-text'))).toBe(
      'Choose what to discard in the Workspaces or Shortcuts settings.',
    );
    expect(refusalOf(run('settings.discard-unread-text', { about: 'all' }))).toBe(
      'There is no text that could not be read about anything called "all".',
    );
    expect(refusalOf(run('settings.discard-unread-text', { about: 'profiles' }))).toBe(
      'There is no text about your shortcut profiles that could not be read.',
    );
    expect(refusalOf(run('settings.discard-unread-text', { about: 'layout' }))).toBe(
      'There is no text about the workspace on screen that could not be read.',
    );
    expect(context.workspace.get().unread).toHaveLength(1);
  });

  it('keeps the text, and says so, where the browser will not discard it', () => {
    const raw = holding({ [COLLECTION]: NOT_JSON });
    const { context } = buildShellContext({
      ...raw,
      remove: () => {
        throw new DOMException('Blocked.', 'SecurityError');
      },
    });

    expect(refusalOf(runIn(context)('settings.discard-unread-text', { about: 'collection' }))).toBe(
      'The browser would not discard the text about your saved workspaces that could not be read, so it is kept.',
    );
    expect(textsSetAside(raw.read(COLLECTION_SET_ASIDE))).toEqual([NOT_JSON]);
    expect(context.workspace.get().recoveries).toHaveLength(1);
  });
});

describe('the bound on each list set aside', () => {
  /** A text set aside in an earlier session, nearly as large as a list may be. */
  const LARGE = 'o'.repeat(499_990);

  it('says in the notice that the oldest text was dropped to make room for the new one', () => {
    const raw = holding({
      [COLLECTION_SET_ASIDE]: JSON.stringify([LARGE]),
      [COLLECTION]: NOT_JSON,
    });
    const { context } = buildShellContext(raw);

    expect(textsSetAside(raw.read(COLLECTION_SET_ASIDE))).toEqual([NOT_JSON]);
    const [notice] = context.workspace.get().recoveries;
    expect(notice === undefined ? '' : wholeNotice(notice.notice)).toContain(
      'The text that could not be read is kept aside. To make room for it, the oldest text set aside before it was dropped.',
    );
  });

  it('says what was dropped when a later write sets the text aside, though its notice was dismissed', () => {
    const raw = holding({
      [PROFILES_SET_ASIDE]: JSON.stringify([LARGE]),
      [PROFILES]: PROFILES_NOT_JSON,
    });
    const quota = { full: true };
    const { context } = buildShellContext({
      ...raw,
      write: (key, value) => {
        if (quota.full && key === PROFILES_SET_ASIDE) throw new Error('The quota is full.');
        raw.write(key, value);
      },
    });
    const run = runIn(context);
    run('shortcuts.dismiss-notice');
    // Every announcement, since the command says its own after the storage's.
    const heard: string[] = [];
    context.interaction.subscribe(() => {
      heard.push(said(context) ?? '');
    });

    quota.full = false;
    run('shortcuts.unbind', { commandId: 'view.command-palette' });

    expect(textsSetAside(raw.read(PROFILES_SET_ASIDE))).toEqual([PROFILES_NOT_JSON]);
    expect(heard.join(' ')).toContain(
      'To set aside the text of your shortcut profiles that could not be read, the oldest text set aside before it was dropped.',
    );
  });
});
