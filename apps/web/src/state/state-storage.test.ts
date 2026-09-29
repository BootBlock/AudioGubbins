import { describe, expect, it } from 'vitest';

import { commandId, createCommandBus, createCommandRegistry } from '@audiogubbins/commands';
import {
  LogSeverity,
  createDiagnosticCentre,
  createLogStore,
  type LogStore,
} from '@audiogubbins/diagnostics';
import { ContrastLevel } from '@audiogubbins/design-system';

import { shellCommands } from '../commands/shell-commands.js';
import type { ShellContext } from '../commands/shell-context.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { textsSetAside } from './set-aside-texts.js';
import {
  PersistedPart,
  createStateStorage,
  describeUnsaved,
  type KeyValueStorage,
} from './state-storage.js';

/**
 * A change the user made that storage would not keep.
 *
 * A store's write failure is said as well as logged: caught, logged and left
 * unsaid, it would cost a user in private browsing or with a full quota every
 * setting, workspace and shortcut profile at the next visit, with no sign that
 * anything had gone wrong.
 */

/** Storage that refuses every write, as a full quota or private browsing does. */
function refusingStorage(): KeyValueStorage & { refusing: boolean } {
  const kept = ephemeralStorage();
  const storage = {
    refusing: true,
    read: kept.read,
    write(key: string, value: string) {
      if (storage.refusing) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      kept.write(key, value);
    },
    remove: kept.remove,
  };
  return storage;
}

function verboseLogs(): {
  readonly logs: LogStore;
  readonly logger: ReturnType<ReturnType<typeof createDiagnosticCentre>['loggerFor']>;
} {
  const logs = createLogStore();
  return {
    logs,
    logger: createDiagnosticCentre(
      logs,
      { now: () => 0 },
      { defaultSeverity: LogSeverity.Trace, categoryOverrides: {} },
    ).loggerFor('shell'),
  };
}

/** What the notice adds where the browser threw an error that says nothing of why. */
const NO_CAUSE = 'The browser did not say why. AudioGubbins tries again with your next change.';

/** What the notice adds where the browser's storage for the site is full. */
const FULL =
  "The browser's storage for this site is full. Deleting workspaces or shortcut profiles you no longer need makes room, as does exporting and then discarding any text that could not be read, in the Workspaces and Shortcuts settings. AudioGubbins tries again with your next change.";

/** What the notice adds where the browser refuses the site any storage. */
const REFUSED =
  "The browser is refusing this site any storage, as it does where its settings block site data or a private window keeps none. Allowing this site to keep data, in the browser's settings, lets AudioGubbins save again; it tries with your next change.";

/** Storage whose every write throws `error`, as a browser throws it. */
function throwing(error: unknown): KeyValueStorage {
  return {
    ...ephemeralStorage(),
    write: () => {
      throw error;
    },
  };
}

describe('state storage', () => {
  it('tells the user once when a part starts failing, and lists it', () => {
    const { logger } = verboseLogs();
    const told: string[] = [];
    const storage = createStateStorage(refusingStorage(), logger, (text) => told.push(text));

    storage.save(PersistedPart.Preferences, { a: '1' });
    storage.save(PersistedPart.Preferences, { a: '2' });

    expect(told).toEqual([
      `Your appearance settings could not be saved, so your changes will not survive a reload. ${FULL}`,
    ]);
    expect(storage.get().unsaved).toEqual([PersistedPart.Preferences]);
  });

  it.each([
    ['a full quota', new DOMException('Full.', 'QuotaExceededError'), 'full', FULL],
    [
      'the name Firefox gave a full quota',
      Object.assign(new Error('Full.'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' }),
      'full',
      FULL,
    ],
    [
      'storage the browser refuses',
      new DOMException('Blocked.', 'SecurityError'),
      'refused',
      REFUSED,
    ],
    ['an error that says neither', new Error('Something else.'), 'unknown', NO_CAUSE],
    ['something thrown that is not an error', 'a string', 'unknown', NO_CAUSE],
  ])(
    'says the cause and the remedy of %s, told and in the status bar',
    (_label, error, cause, said) => {
      // The notice said the change would not survive a reload, and neither why
      // nor what the user could do about it.
      const told: string[] = [];
      const storage = createStateStorage(throwing(error), verboseLogs().logger, (text) =>
        told.push(text),
      );

      storage.save(PersistedPart.Workspace, { a: '1' });

      expect(told).toEqual([
        `Your workspaces could not be saved, so your changes will not survive a reload. ${said}`,
      ]);
      expect(storage.get()).toEqual({ unsaved: [PersistedPart.Workspace], cause });
      expect(describeUnsaved(storage.get())).toBe(`Not being saved: workspaces. ${said}`);
    },
  );

  it('keeps the cause while any part is not kept, and drops it once every part is', () => {
    const raw = ephemeralStorage();
    let refusing = true;
    const storage = createStateStorage(
      {
        ...raw,
        write: (key, value) => {
          if (refusing) throw new DOMException('Full.', 'QuotaExceededError');
          raw.write(key, value);
        },
      },
      verboseLogs().logger,
      () => undefined,
    );

    storage.save(PersistedPart.Workspace, { a: '1' });
    storage.save(PersistedPart.Shortcuts, { b: '1' });
    refusing = false;
    storage.save(PersistedPart.Workspace, { a: '2' });
    expect(storage.get()).toEqual({ unsaved: [PersistedPart.Shortcuts], cause: 'full' });

    storage.save(PersistedPart.Shortcuts, { b: '2' });
    expect(storage.get()).toEqual({ unsaved: [], cause: undefined });
  });

  it('says no cause for a part its caller keeps back, which says why itself', () => {
    const told: string[] = [];
    const storage = createStateStorage(ephemeralStorage(), verboseLogs().logger, (text) =>
      told.push(text),
    );

    storage.save(
      PersistedPart.Workspace,
      { kept: '1' },
      { withheld: { reason: 'nowhere', told: 'Kept back.' } },
    );

    expect(told).toEqual(['Kept back.']);
    expect(storage.get()).toEqual({ unsaved: [PersistedPart.Workspace], cause: undefined });
    expect(describeUnsaved(storage.get())).toBe('Not being saved: workspaces');
  });

  it('says nothing to the user about a part AudioGubbins learned for itself', () => {
    // The keyboard layout is learned from the browser's map and from typing.
    // Told as a change of theirs, a user who had changed nothing heard an
    // urgent "your changes will not survive a reload" at the first key they
    // pressed, and the status bar listed it, with nothing they could do.
    const { logs, logger } = verboseLogs();
    const told: string[] = [];
    const storage = createStateStorage(refusingStorage(), logger, (text) => told.push(text));

    storage.save(PersistedPart.KeyboardLayout, { a: '1' });

    expect(told).toEqual([]);
    expect(storage.get().unsaved).toEqual([]);
    expect(logs.snapshot().map((record) => record.message)).toContain(
      'A change could not be stored, so it will not survive a reload.',
    );
  });

  it('records every failure in the log, not only the first', () => {
    const { logs, logger } = verboseLogs();
    const storage = createStateStorage(refusingStorage(), logger, () => undefined);

    storage.save(PersistedPart.Workspace, { a: '1' });
    storage.save(PersistedPart.Workspace, { a: '2' });

    const warnings = logs.snapshot().filter((record) => record.severity === LogSeverity.Warning);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.fields).toMatchObject({ part: PersistedPart.Workspace });
  });

  it('stops listing a part once a write to it succeeds again', () => {
    const { logger } = verboseLogs();
    const raw = refusingStorage();
    const storage = createStateStorage(raw, logger, () => undefined);
    storage.save(PersistedPart.Shortcuts, { a: '1' });

    raw.refusing = false;
    storage.save(PersistedPart.Shortcuts, { a: '2' });

    expect(storage.get().unsaved).toEqual([]);
    expect(raw.read('a')).toBe('2');
  });

  it('keeps the parts that are still failing when another recovers', () => {
    const { logger } = verboseLogs();
    const raw = refusingStorage();
    const storage = createStateStorage(raw, logger, () => undefined);
    storage.save(PersistedPart.Preferences, { p: '1' });
    storage.save(PersistedPart.Verbosity, { v: '1' });

    raw.refusing = false;
    storage.save(PersistedPart.Verbosity, { v: '2' });

    expect(storage.get().unsaved).toEqual([PersistedPart.Preferences]);
  });

  it('lists a part when one of its keys is refused and another is kept', () => {
    // The workspace part is written under two keys in one step. Written one at
    // a time, a refused first write was added to the list and a successful
    // second write took it off again inside the same event, so the status bar
    // never showed that the user's workspaces were not being kept.
    const { logger } = verboseLogs();
    const kept = ephemeralStorage();
    const told: string[] = [];
    const storage = createStateStorage(
      {
        read: kept.read,
        write(key: string, value: string) {
          if (key === 'refused') throw new DOMException('No.', 'QuotaExceededError');
          kept.write(key, value);
        },
        remove: kept.remove,
      },
      logger,
      (text) => told.push(text),
    );

    const refused = storage.save(PersistedPart.Workspace, { refused: '1', kept: '2' });

    // Which key, so a caller can make a later write depend on one key.
    expect(refused).toEqual(['refused']);
    expect(storage.get().unsaved).toEqual([PersistedPart.Workspace]);
    expect(told).toHaveLength(1);

    // The key that could be written was still written: one refused key is no
    // reason to abandon the others.
    expect(kept.read('kept')).toBe('2');
  });

  it('lists a part withheld by its caller as it lists a refused one, and tells the user once', () => {
    // A collection with nowhere to go was written nowhere, and the part was
    // taken off the list by the write of the key beside it.
    const { logger } = verboseLogs();
    const told: string[] = [];
    const storage = createStateStorage(ephemeralStorage(), logger, (text) => told.push(text));
    const withheld = { reason: 'nowhere to write', told: 'The list cannot be kept yet.' };

    expect(storage.save(PersistedPart.Workspace, { kept: '1' }, { withheld })).toEqual([]);
    storage.save(PersistedPart.Workspace, { kept: '2' }, { withheld });

    expect(storage.get().unsaved).toEqual([PersistedPart.Workspace]);
    // What the caller kept back, and not the whole part: the key written
    // beside it was kept, and would survive a reload.
    expect(told).toEqual(['The list cannot be kept yet.']);

    storage.save(PersistedPart.Workspace, { kept: '3' });
    expect(storage.get().unsaved).toEqual([]);
  });

  it('tells the user the whole part is lost when a key is refused beside what was withheld', () => {
    const { logger } = verboseLogs();
    const told: string[] = [];
    const raw = ephemeralStorage();
    const refusing = {
      ...raw,
      write: () => {
        throw new Error('The quota is full.');
      },
    };
    const storage = createStateStorage(refusing, logger, (text) => told.push(text));

    storage.save(
      PersistedPart.Workspace,
      { refused: '1' },
      { withheld: { reason: 'nowhere', told: 'Kept back.' } },
    );

    expect(told).toEqual([
      `Your workspaces could not be saved, so your changes will not survive a reload. ${NO_CAUSE}`,
    ]);
  });

  it('tells the user when a write keeps again what earlier writes kept back', () => {
    // A user told that something cannot be kept is told when it is kept
    // again, and the part leaves the list of what is not being kept.
    const { logger } = verboseLogs();
    const told: string[] = [];
    const storage = createStateStorage(ephemeralStorage(), logger, (text) => told.push(text));
    const withheld = { reason: 'nowhere to write', told: 'The list cannot be kept yet.' };

    storage.save(PersistedPart.Workspace, { kept: '1' }, { withheld });
    storage.save(PersistedPart.Workspace, { kept: '2' }, { resumed: 'The list is kept again.' });

    expect(told).toEqual(['The list cannot be kept yet.', 'The list is kept again.']);
    expect(storage.get().unsaved).toEqual([]);
  });

  it('says what a write keeps again and what it still keeps back in one announcement', () => {
    // Each announcement replaces the one before it, so two in a row would
    // say only the second.
    const { logger } = verboseLogs();
    const told: string[] = [];
    const storage = createStateStorage(ephemeralStorage(), logger, (text) => told.push(text));

    storage.save(
      PersistedPart.Workspace,
      { kept: '1' },
      {
        withheld: { reason: 'nowhere to write', told: 'The list cannot be kept yet.' },
        resumed: 'The arrangement is kept again.',
      },
    );

    expect(told).toEqual(['The arrangement is kept again. The list cannot be kept yet.']);
    expect(storage.get().unsaved).toEqual([PersistedPart.Workspace]);
  });

  it('does not say a write keeps anything again when a key of it is refused', () => {
    const { logger } = verboseLogs();
    const told: string[] = [];
    const raw = ephemeralStorage();
    const refusing = {
      ...raw,
      write: (key: string, value: string) => {
        if (key === 'refused') throw new Error('The quota is full.');
        raw.write(key, value);
      },
    };
    const storage = createStateStorage(refusing, logger, (text) => told.push(text));

    storage.save(
      PersistedPart.Workspace,
      { kept: '1', refused: '2' },
      { resumed: 'The list is kept again.' },
    );

    expect(told).toEqual([
      `Your workspaces could not be saved, so your changes will not survive a reload. ${NO_CAUSE}`,
    ]);
  });

  it('adds a text set aside to those set aside before, and adds each once', () => {
    // A later damage replaced the text set aside before it, which nobody had
    // read.
    const { logger } = verboseLogs();
    const raw = ephemeralStorage();
    const storage = createStateStorage(raw, logger, () => undefined);

    expect(storage.keepAside('aside', 'first')).toEqual({ kept: true, dropped: 0, count: 1 });
    expect(storage.keepAside('aside', 'second')).toEqual({ kept: true, dropped: 0, count: 2 });
    expect(storage.keepAside('aside', 'first')).toEqual({ kept: true, dropped: 0, count: 2 });

    expect(textsSetAside(raw.read('aside'))).toEqual(['first', 'second']);
  });

  it('drops the oldest texts to keep a list within its bound, and says how many it dropped', () => {
    // The lists only grew, one entry for each distinct damaged text, until
    // the room they took withheld every write.
    const { logs, logger } = verboseLogs();
    const raw = ephemeralStorage();
    const storage = createStateStorage(raw, logger, () => undefined);
    const [first, second, third] = ['a', 'b', 'c'].map((letter) => letter.repeat(200_000));
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('three texts were made');
    }

    storage.keepAside('aside', first);
    expect(storage.keepAside('aside', second)).toEqual({ kept: true, dropped: 0, count: 2 });
    expect(storage.keepAside('aside', third)).toEqual({ kept: true, dropped: 1, count: 2 });

    expect(textsSetAside(raw.read('aside'))).toEqual([second, third]);
    expect(raw.read('aside')?.length).toBeLessThanOrEqual(500_000);
    const dropping = logs
      .snapshot()
      .filter((record) => record.message.startsWith('Older text that could not be read'));
    expect(dropping.map((record) => record.fields)).toEqual([{ count: 1 }]);
  });

  it('sets aside a text larger than the bound alone, dropping every older one', () => {
    // Kept out, it would be left where it was found, and every write of its
    // store withheld until the user discarded it.
    const raw = ephemeralStorage();
    const storage = createStateStorage(raw, verboseLogs().logger, () => undefined);
    storage.keepAside('aside', 'small');
    storage.keepAside('aside', 'smaller');
    const large = 'x'.repeat(600_000);

    expect(storage.keepAside('aside', large)).toEqual({ kept: true, dropped: 2, count: 1 });
    expect(textsSetAside(raw.read('aside'))).toEqual([large]);
  });

  it('drops nothing where the write that would drop it is refused', () => {
    const raw = ephemeralStorage();
    raw.write('aside', JSON.stringify(['a'.repeat(300_000)]));
    const storage = createStateStorage(
      {
        ...raw,
        write: () => {
          throw new DOMException('Full.', 'QuotaExceededError');
        },
      },
      verboseLogs().logger,
      () => undefined,
    );

    expect(storage.keepAside('aside', 'b'.repeat(300_000))).toEqual({
      kept: false,
      dropped: 0,
      count: 1,
    });
    expect(textsSetAside(raw.read('aside'))).toEqual(['a'.repeat(300_000)]);
  });

  it('discards every text set aside under a key, and answers whether they are gone', () => {
    const { logs, logger } = verboseLogs();
    const raw = ephemeralStorage();
    const storage = createStateStorage(raw, logger, () => undefined);
    storage.keepAside('aside', 'first');

    expect(storage.discardAside('aside')).toBe(true);
    expect(raw.read('aside')).toBeNull();

    storage.keepAside('aside', 'second');
    const refusing = createStateStorage(
      {
        ...raw,
        remove: () => {
          throw new DOMException('Blocked.', 'SecurityError');
        },
      },
      logger,
      () => undefined,
    );
    expect(refusing.discardAside('aside')).toBe(false);
    expect(textsSetAside(raw.read('aside'))).toEqual(['second']);
    expect(logs.snapshot().map((record) => record.message)).toContain(
      'Text set aside could not be discarded.',
    );
  });

  it('keeps text it did not write under a set-aside key, when it adds another', () => {
    const { logger } = verboseLogs();
    const raw = ephemeralStorage();
    raw.write('aside', 'written before this was a list');
    const storage = createStateStorage(raw, logger, () => undefined);

    storage.keepAside('aside', 'next');

    expect(textsSetAside(raw.read('aside'))).toEqual(['written before this was a list', 'next']);
  });

  it('writes in words a user uses', () => {
    expect(
      describeUnsaved({
        unsaved: [PersistedPart.Workspace, PersistedPart.Shortcuts],
        cause: undefined,
      }),
    ).toBe('Not being saved: workspaces, shortcut profiles');
  });
});

describe('a store whose writes are refused', () => {
  it('keeps the change on screen, and tells the user it will not be kept', () => {
    const { context, storage } = buildShellContext(refusingStorage());
    const registry = createCommandRegistry<ShellContext>();
    for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
    const bus = createCommandBus(
      registry,
      createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
    );

    bus.execute(context, { commandId: commandId('view.high-contrast') });

    expect(context.preferences.get().contrast).toBe(ContrastLevel.High);
    expect(storage.get().unsaved).toEqual([PersistedPart.Preferences]);
    // The sentence alone. Whether it is said urgently is the composition
    // root's choice, which this context's own storage stands in for, so that
    // is held where the application is built.
    expect(context.interaction.get().announcement?.text).toBe(
      `Your appearance settings could not be saved, so your changes will not survive a reload. ${FULL}`,
    );
  });
});
