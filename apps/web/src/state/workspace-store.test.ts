import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commandId, createCommandBus, createCommandRegistry } from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { buildPresets, createLayoutStore, type LayoutStore } from '@audiogubbins/workspace';
import type * as WorkspacePackage from '@audiogubbins/workspace';

import { shellCommands } from '../commands/shell-commands.js';
import type { ShellContext } from '../commands/shell-context.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { wholeNotice } from './recovery-notices.js';
import { textsSetAside } from './set-aside-texts.js';
import type { WorkspaceLayout } from '@audiogubbins/workspace';
import { keptInCollection } from './workspace-store.js';

/**
 * Each question of a layout store that looks a layout up by its identifier, in
 * the order the workspace store asks them: every layout store the file makes
 * is the package's own, with those questions counted as they are asked.
 */
const lookups = vi.hoisted(() => ({ asked: [] as string[] }));

vi.mock('@audiogubbins/workspace', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspacePackage>();
  return {
    ...actual,
    createLayoutStore: (...made: Parameters<typeof actual.createLayoutStore>): LayoutStore => {
      const store = actual.createLayoutStore(...made);
      /** The question named, counted as it is asked. */
      const counted = <Answer>(name: string, ask: () => Answer): Answer => {
        lookups.asked.push(name);
        return ask();
      };
      return {
        ...store,
        get: (id) => counted('get', () => store.get(id)),
        removable: (id) => counted('removable', () => store.removable(id)),
        resettable: (id) => counted('resettable', () => store.resettable(id)),
      };
    },
  };
});

beforeEach(() => {
  lookups.asked = [];
});

/** Storage holding a mounted layout that is not JSON at all. */
function unreadableWorkspace() {
  const raw = ephemeralStorage();
  raw.write('audiogubbins.workspace', '{"schemaVersion": 1, "groups": [');
  return raw;
}

/** Runs shell commands against a context. */
function busFor(context: ShellContext) {
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  const bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
  return (id: string) => bus.execute(context, { commandId: commandId(id) });
}

/** Where every notice of the workspace's says its text can be exported or discarded. */
const EXPORT_IT = 'The Workspaces settings can export what could not be read, or discard it.';

/** What the user is told, one notice per thing that could not be read, as the status bar shows it. */
function notices(context: ShellContext): readonly string[] {
  return context.workspace.get().recoveries.map((one) => wholeNotice(one.notice));
}

describe('writing the workspace', () => {
  it.each(['audiogubbins.workspace', 'audiogubbins.workspaces'])(
    'reports the workspace as unsaved when %s is refused',
    (refused) => {
      // The layout and the collection are one part to the user. Written in two
      // calls, a refused first write was cleared by a kept second one, and the
      // status bar said nothing was wrong. Each key is refused in turn, since
      // refusing only the one written first would pass a store that writes in
      // two calls in the other order.
      const raw = ephemeralStorage();
      const refusing = {
        ...raw,
        write: (key: string, value: string) => {
          if (key === refused) throw new Error('The quota is full.');
          raw.write(key, value);
        },
      };
      const { context, storage } = buildShellContext(refusing);

      busFor(context)('workspace.save-as');

      expect(storage.get().unsaved).toContain('workspace');
    },
  );
});

describe('a workspace rearranged', () => {
  /** The layout on screen with its first group given half the room. */
  function halved(context: ShellContext) {
    const { layout } = context.workspace.get();
    const [first, ...rest] = layout.groups;
    if (first === undefined) throw new Error('the layout has no groups');
    return { ...layout, groups: [{ ...first, proportion: 0.5 }, ...rest] };
  }

  it('keeps a built-in one on screen and stored, and never in the saved collection', () => {
    // The preset stays as it ships, so there is always one to go back to, and
    // the arrangement is still there after a reload.
    const raw = ephemeralStorage();
    const { context } = buildShellContext(raw);
    const shipped = context.workspace.get().layout;
    expect(shipped.builtIn).toBe(true);

    context.workspace.rearranged(halved(context));
    context.workspace.openPanel('capabilities');

    const { layout, available } = context.workspace.get();
    expect(layout.groups[0]?.proportion).toBe(0.5);
    expect(available.find((one) => one.id === shipped.id)).toEqual(shipped);
    expect(raw.read('audiogubbins.workspace')).toContain('"proportion":0.5');
    expect(JSON.parse(raw.read('audiogubbins.workspaces') ?? 'null')).toEqual([]);
    expect(buildShellContext(raw).context.workspace.get().layout.groups[0]?.proportion).toBe(0.5);
  });

  it('keeps one the user made in the saved collection', () => {
    // Read by name, since another workspace saved has the same proportion.
    const raw = ephemeralStorage();
    const { context } = buildShellContext(raw);
    context.workspace.saveAs('Other');
    context.workspace.rearranged(halved(context));
    context.workspace.switchTo('editing');
    context.workspace.saveAs('Mine');
    expect(context.workspace.get().layout.groups[0]?.proportion).not.toBe(0.5);

    context.workspace.rearranged(halved(context));

    const saved = context.workspace.get().available.find((one) => one.displayName === 'Mine');
    expect(saved?.groups[0]?.proportion).toBe(0.5);
    const stored: readonly WorkspaceLayout[] = JSON.parse(
      raw.read('audiogubbins.workspaces') ?? '[]',
    );
    const mine = stored.find((one) => one.displayName === 'Mine');
    expect(mine?.groups[0]?.proportion).toBe(0.5);
  });

  it('keeps the arrangement on screen, the newer, across a reload and a switch away and back', () => {
    // The collection refused and the layout's own key kept, the key holds the
    // newer arrangement and name. Listed as the collection holds it, the older
    // is written over it by the switch away, and the switch back shows it.
    const raw = ephemeralStorage();
    buildShellContext(raw).context.workspace.saveAs('Mine');
    const refusing = {
      ...raw,
      write: (key: string, value: string) => {
        if (key === 'audiogubbins.workspaces') throw new Error('The quota is full.');
        raw.write(key, value);
      },
    };
    const held = buildShellContext(refusing).context;
    held.workspace.rearranged(halved(held));
    held.workspace.rename(held.workspace.get().layout.id, 'Mine, renamed');

    const { context } = buildShellContext(raw);
    const { id } = context.workspace.get().layout;
    context.workspace.switchTo('editing');
    context.workspace.switchTo(id);

    const { layout, available } = context.workspace.get();
    expect(layout.groups[0]?.proportion).toBe(0.5);
    expect(layout.displayName).toBe('Mine, renamed');
    expect(available.map((one) => one.displayName)).not.toContain('Mine');
  });

  it('keeps a mounted one that claims to be built in under an identifier no preset has', () => {
    // Taken at its claim, it is a layout the store does not hold, and every
    // change to the workspace on screen throws.
    const made = buildShellContext().context;
    made.workspace.saveAs('Claimed');
    const claimed = { ...made.workspace.get().layout, id: 'x', builtIn: true };
    const raw = ephemeralStorage();
    raw.write('audiogubbins.workspace', JSON.stringify(claimed));
    const { context } = buildShellContext(raw);

    expect(() => {
      context.workspace.rearranged(halved(context));
      context.workspace.openPanel('capabilities');
    }).not.toThrow();

    expect(context.workspace.get().layout).toMatchObject({ id: 'x', builtIn: false });
    const stored: readonly WorkspaceLayout[] = JSON.parse(
      raw.read('audiogubbins.workspaces') ?? '[]',
    );
    const kept = stored.find((one) => one.id === 'x');
    expect(kept?.groups[0]?.proportion).toBe(0.5);
    expect(kept?.groups.flatMap((group) => group.panels).map((panel) => panel.kind)).toContain(
      'capabilities',
    );
  });

  it('throws where the store refuses the workspace on screen for anything but being built in', () => {
    // A refusal no stored text can bring about is a mistake of the code's,
    // and kept quiet, the change would be mounted and never saved.
    const presets = buildPresets(new Set(DESCRIPTORS.keys()));
    const preset = presets[0];
    if (preset === undefined) throw new Error('no preset was built');
    const layout = { ...preset, id: 'mine', builtIn: false };
    const answering = (refusal: ReturnType<LayoutStore['save']>): LayoutStore => ({
      ...createLayoutStore(presets),
      save: () => refusal,
    });

    expect(keptInCollection(answering(undefined), layout)).toBe(true);
    expect(keptInCollection(answering({ kind: 'built-in', text: 'Built in.' }), layout)).toBe(
      false,
    );
    expect(() => keptInCollection(answering({ kind: 'refused', text: 'No.' }), layout)).toThrow(
      'The workspace on screen was refused by the store holding it: No.',
    );
  });

  it('keeps it in its own place where storage holds another under its identifier', () => {
    // Storage holding two workspaces under one identifier, the one on screen
    // the second: matched by the identifier alone, it was the first, and the
    // rearrangement was saved over the first workspace.
    const made = buildShellContext();
    made.context.workspace.saveAs('First');
    const first = made.context.workspace.get().layout;
    made.context.workspace.saveAs('Second');
    const second = { ...made.context.workspace.get().layout, id: first.id };
    const raw = ephemeralStorage();
    raw.write('audiogubbins.workspaces', JSON.stringify([first, second]));
    raw.write('audiogubbins.workspace', JSON.stringify(second));

    const { context } = buildShellContext(raw);
    expect(context.workspace.get().layout.displayName).toBe('Second');
    expect(context.workspace.get().layout.id).not.toBe(first.id);
    context.workspace.rearranged(halved(context));

    const saved: readonly WorkspaceLayout[] = JSON.parse(
      raw.read('audiogubbins.workspaces') ?? '[]',
    );
    expect(saved.map((one) => one.displayName)).toEqual(['First', 'Second']);
    expect(saved[0]).toEqual(first);
    expect(saved[1]?.groups[0]?.proportion).toBe(0.5);
    expect(new Set(saved.map((one) => one.id)).size).toBe(2);
  });
});

describe('a workspace renamed', () => {
  it('writes nothing, and changes nothing on screen, for the name it has, typed with or without space around it', () => {
    const raw = ephemeralStorage();
    let writes = 0;
    const counting = {
      ...raw,
      write: (key: string, value: string) => {
        writes += 1;
        raw.write(key, value);
      },
    };
    const { context } = buildShellContext(counting);
    context.workspace.saveAs('Mine');
    const { id } = context.workspace.get().layout;
    const before = context.workspace.get();
    writes = 0;

    for (const typed of ['Mine', ' Mine ']) {
      const renamed = context.workspace.rename(id, typed);
      expect(typeof renamed !== 'string' && renamed.after === renamed.before).toBe(true);
    }
    expect(writes).toBe(0);
    expect(context.workspace.get()).toBe(before);

    // And the count is of every write: a name that changes is written.
    expect(context.workspace.rename(id, 'Yours')).not.toBeTypeOf('string');
    expect(writes).toBeGreaterThan(0);
    expect(context.workspace.get().layout.displayName).toBe('Yours');
  });
});

describe('a workspace deleted or reset', () => {
  it('deletes and resets a workspace after one lookup', () => {
    // The check that finds the layout answers the act bound to it, so the act
    // is made on what the check found, and nothing looks the layout up again.
    const { context } = buildShellContext();
    const shipped = context.workspace.get().layout;
    context.workspace.openPanel('capabilities');

    lookups.asked = [];
    expect(context.workspace.resetBuiltIn(shipped.id)).toEqual(shipped);
    expect(lookups.asked).toEqual(['resettable']);

    const made = context.workspace.saveAs('Deleted next');
    if (typeof made === 'string') throw new Error(made);
    lookups.asked = [];
    expect(context.workspace.remove(made.id)).toEqual(made);
    expect(lookups.asked).toEqual(['removable']);
    expect(context.workspace.get().available).not.toContainEqual(made);
  });
});

describe('a stored workspace that cannot be read', () => {
  it('says it could not be read, rather than that it was not a layout', () => {
    // The store parsed the text itself and, on failure, returned its own
    // sentence through the channel meant for a parsed value. That sentence then
    // failed validation, so the user was told "The stored layout is not a
    // layout." and the store's message was thrown away.
    const { context } = buildShellContext(unreadableWorkspace());

    expect(notices(context)).toEqual([
      `The stored workspace could not be read. The text that could not be read is kept aside. ${EXPORT_IT}`,
    ]);
  });

  it('falls back to a preset the user can work in', () => {
    const { context } = buildShellContext(unreadableWorkspace());
    expect(context.workspace.get().layout.builtIn).toBe(true);
  });
});

describe('the workspaces the user saved, when the file holding them is damaged', () => {
  const COLLECTION = 'audiogubbins.workspaces';
  const SET_ASIDE = 'audiogubbins.workspaces.unreadable';
  const MOUNTED = 'audiogubbins.workspace';
  const MOUNTED_SET_ASIDE = 'audiogubbins.workspace.unreadable';
  const DIVERTED = 'audiogubbins.workspaces.recovered';

  /** Text that is not JSON, where the collection should be. */
  const NOT_JSON = '[{"id": "mine",';

  /** Storage whose collection of saved workspaces is not JSON. */
  function unreadableCollection() {
    const raw = ephemeralStorage();
    raw.write(COLLECTION, NOT_JSON);
    return raw;
  }

  /** A workspace this build can read, made the way a user makes one. */
  function readableWorkspace(displayName: string) {
    const first = buildShellContext();
    first.context.workspace.saveAs(displayName);
    return first.context.workspace.get().layout;
  }

  /** Storage whose collection holds one readable workspace and one damaged entry. */
  function partlyDamagedCollection() {
    const raw = ephemeralStorage();
    raw.write(COLLECTION, JSON.stringify([readableWorkspace('Keeper'), 42]));
    return raw;
  }

  /** The texts set aside, in the order they were. */
  const setAside = (raw: ReturnType<typeof ephemeralStorage>): readonly string[] =>
    textsSetAside(raw.read(SET_ASIDE));

  /** Storage that refuses the one key the damaged text is set aside under. */
  function refusingTheSetAside(raw: ReturnType<typeof ephemeralStorage>) {
    return {
      ...raw,
      write: (key: string, value: string) => {
        if (key === SET_ASIDE) throw new Error('The quota is full.');
        raw.write(key, value);
      },
    };
  }

  const listed = (context: ShellContext): readonly string[] =>
    context.workspace.get().available.map((one) => one.displayName);

  /** What AudioGubbins says it does while there is no room to set text aside. */
  const TRIES_AGAIN =
    'AudioGubbins tries again each time you change a workspace, and at the next start.';

  /** The start of the advice on making room, which the status bar shows apart. */
  const ADVICE = 'To make room without losing anything';

  /**
   * Storage at its quota for the keys named until room is made: a write of
   * one of them is refused while `full` holds, and kept once it does not.
   */
  function quotaFor(raw: ReturnType<typeof ephemeralStorage>, ...keys: readonly string[]) {
    const quota = {
      full: true,
      storage: {
        ...raw,
        write: (key: string, value: string) => {
          if (quota.full && keys.includes(key)) throw new Error('The quota is full.');
          raw.write(key, value);
        },
      },
    };
    return quota;
  }

  /** The kinds of panel open in the workspace on screen. */
  const openKinds = (context: ShellContext): readonly string[] =>
    context.workspace
      .get()
      .layout.groups.flatMap((group) => group.panels)
      .map((panel) => panel.kind);

  it('says so, rather than starting the user with nothing and no explanation', () => {
    // It was read as an empty list: every workspace the user had made vanished
    // with no notice and no log record.
    const { context } = buildShellContext(unreadableCollection());

    expect(notices(context).join(' ')).toContain('could not be read');
  });

  it('sets the damaged text aside before anything is written over it', () => {
    // The next change wrote an empty list over it, so nothing could be
    // recovered from it afterwards.
    const raw = unreadableCollection();
    const { context } = buildShellContext(raw);

    context.workspace.openPanel('capabilities');

    expect(setAside(raw)).toEqual([NOT_JSON]);
    expect(notices(context).join(' ')).toContain('kept aside');
  });

  it('keeps a workspace saved while the notice stands, whether the file was wholly or partly damaged', () => {
    // A partly damaged file's writes went beside it and were never read back,
    // so a workspace saved while its notice stood was announced as saved,
    // listed, and gone at the next load.
    for (const damaged of [unreadableCollection, partlyDamagedCollection]) {
      const raw = damaged();
      buildShellContext(raw).context.workspace.saveAs('Made during the notice');

      const { context } = buildShellContext(raw);

      expect(listed(context)).toContain('Made during the notice');
    }
  });

  it('keeps what the user deletes deleted, across a reload', () => {
    const raw = partlyDamagedCollection();
    const first = buildShellContext(raw).context;
    first.workspace.saveAs('Kept beside it');
    first.workspace.remove('keeper');

    // The one kept as well as the one deleted: by absence alone, a reload that
    // dropped every saved workspace would pass.
    const after = listed(buildShellContext(raw).context);
    expect(after).not.toContain('Keeper');
    expect(after).toContain('Kept beside it');
  });

  it('keeps the workspaces it can read when only some are damaged, and says how many are not', () => {
    const { context } = buildShellContext(partlyDamagedCollection());

    expect(notices(context).join(' ')).toContain(
      'One of the workspaces you saved could not be read',
    );
    expect(listed(context)).toContain('Keeper');
  });

  it('keeps no field of a saved workspace that the reading does not check', () => {
    // Kept as stored, a field nothing checks is written back with every write
    // of the collection, and reaches whatever reads the workspace next.
    const raw = ephemeralStorage();
    const kept = readableWorkspace('Keeper');
    raw.write(COLLECTION, JSON.stringify([{ ...kept, note: 'unchecked' }]));

    const { context } = buildShellContext(raw);
    const listedKeeper = context.workspace.get().available.find((one) => one.id === kept.id);
    expect(listedKeeper).toStrictEqual(kept);

    context.workspace.saveAs('Other');
    expect(raw.read(COLLECTION)).not.toContain('unchecked');
  });

  it('leaves out a stored workspace whose name is over the bound, says so, and keeps its text', () => {
    // Refused rather than cut, as every other rule sets a stored layout aside:
    // the name is drawn and said as a typed one is, and another page on this
    // address can write it.
    const long = { ...readableWorkspace('Keeper'), id: 'long', displayName: 'w'.repeat(121) };
    const stored = JSON.stringify([readableWorkspace('Keeper'), long]);
    const raw = ephemeralStorage();
    raw.write(COLLECTION, stored);

    const { context } = buildShellContext(raw);

    expect(notices(context)).toEqual([
      `One of the workspaces you saved could not be read, so it is not listed. The text that could not be read is kept aside. ${EXPORT_IT}`,
    ]);
    expect(listed(context)).toContain('Keeper');
    expect(listed(context)).not.toContain(long.displayName);
    expect(setAside(raw)).toEqual([stored]);
  });

  it('says how many it could not read when every entry is damaged', () => {
    const raw = ephemeralStorage();
    raw.write(COLLECTION, JSON.stringify([{ id: 'mine' }, 42]));

    const { context } = buildShellContext(raw);

    expect(notices(context).join(' ')).toContain('2 of the workspaces');
  });

  it('holds the damaged text in place when it cannot be set aside, and writes beside it', () => {
    // A browser at its quota refuses the copy as readily as anything else.
    for (const damaged of [unreadableCollection, partlyDamagedCollection]) {
      const raw = damaged();
      const before = raw.read(COLLECTION);
      const first = buildShellContext(refusingTheSetAside(raw)).context;
      first.workspace.saveAs('Made while held');

      expect(raw.read(COLLECTION)).toBe(before);
      expect(notices(first).join(' ')).toContain('left where it is');
      expect(listed(buildShellContext(refusingTheSetAside(raw)).context)).toContain(
        'Made while held',
      );
    }
  });

  it('removes the copy written beside the damaged text once the collection is back in its place', () => {
    // It was never removed, so a later damage brought back workspaces the user
    // had deleted since and hid the ones saved in between.
    const raw = unreadableCollection();
    buildShellContext(refusingTheSetAside(raw)).context.workspace.saveAs('Made while held');
    expect(raw.read(DIVERTED)).not.toBeNull();

    // Removed in the write after one that put the collection back was kept,
    // so the copy is never the only place its workspaces are.
    const second = buildShellContext(raw).context;
    second.workspace.saveAs('Made once set aside');
    expect(raw.read(DIVERTED)).not.toBeNull();
    second.workspace.openPanel('capabilities');

    expect(raw.read(DIVERTED)).toBeNull();
    expect(raw.read(COLLECTION)).toContain('Made while held');
    expect(raw.read(COLLECTION)).toContain('Made once set aside');
  });

  /** Storage that refuses to write the keys named, and nothing else. */
  function refusing(raw: ReturnType<typeof ephemeralStorage>, ...keys: readonly string[]) {
    return {
      ...raw,
      write: (key: string, value: string) => {
        if (keys.includes(key)) throw new Error('The quota is full.');
        raw.write(key, value);
      },
    };
  }

  /** Storage that refuses to set aside a list holding the text named. */
  function refusingToSetAside(raw: ReturnType<typeof ephemeralStorage>, text: string) {
    return {
      ...raw,
      write: (key: string, value: string) => {
        if (key === SET_ASIDE && textsSetAside(value).includes(text)) {
          throw new Error('The quota is full.');
        }
        raw.write(key, value);
      },
    };
  }

  it('keeps the copy written beside the collection when the write that would replace it is refused', () => {
    // The copy was removed in the same write as the collection's, and a
    // removal is not refused at the quota, so it went while the collection
    // stayed damaged, and the workspaces it held went with it.
    const raw = unreadableCollection();
    buildShellContext(refusing(raw, SET_ASIDE)).context.workspace.saveAs('Made while held');

    buildShellContext(refusing(raw, COLLECTION)).context.workspace.openPanel('capabilities');

    expect(raw.read(DIVERTED)).toContain('Made while held');
    expect(listed(buildShellContext(raw).context)).toContain('Made while held');
  });

  it('sets a damaged copy aside before anything is written over it', () => {
    // A damaged copy was reported and then deleted, or overwritten while the
    // collection was held, with its text kept nowhere.
    const damagedCopy = '[{"broken"';
    for (const storage of [
      (raw: ReturnType<typeof ephemeralStorage>) => raw,
      (raw: ReturnType<typeof ephemeralStorage>) => refusingToSetAside(raw, NOT_JSON),
    ]) {
      const raw = unreadableCollection();
      raw.write(DIVERTED, damagedCopy);

      const { context } = buildShellContext(storage(raw));
      context.workspace.saveAs('Made after both');

      expect(setAside(raw)).toContain(damagedCopy);
      expect(notices(context).join(' ')).toContain('What could not be read of them is kept aside.');
    }
  });

  it('sets a damaged copy aside in a later session, before removing it, once the collection is whole', () => {
    // Beside a whole collection the copy was not read, and the first write
    // removed it with its text set aside nowhere.
    const damagedCopy = '[{"broken"';
    const raw = unreadableCollection();
    raw.write(DIVERTED, damagedCopy);
    buildShellContext(refusingToSetAside(raw, damagedCopy)).context.workspace.saveAs('Made');
    expect(raw.read(DIVERTED)).toBe(damagedCopy);

    // Still refused: it stays where it is, and the user is told.
    const refused = buildShellContext(refusingToSetAside(raw, damagedCopy)).context;
    refused.workspace.openPanel('capabilities');
    refused.workspace.openPanel('diagnostics');
    expect(raw.read(DIVERTED)).toBe(damagedCopy);
    expect(notices(refused).join(' ')).toContain('earlier session could not be read');
    expect(notices(refused).join(' ')).toContain('left where it is');

    // Allowed: set aside first, and only then removed.
    const allowed = buildShellContext(raw).context;
    allowed.workspace.openPanel('capabilities');
    allowed.workspace.openPanel('diagnostics');
    expect(setAside(raw)).toContain(damagedCopy);
    expect(raw.read(DIVERTED)).toBeNull();
  });

  it('removes a copy made stale by a kept write of the collection, whatever else was refused', () => {
    // Told whether the whole write was kept, a refused layout key kept the
    // copy, which was older than the collection written beside it, and a later
    // damage brought it back as the newest.
    const raw = unreadableCollection();
    buildShellContext(refusingTheSetAside(raw)).context.workspace.saveAs('Made while held');

    const second = buildShellContext(refusing(raw, 'audiogubbins.workspace')).context;
    second.workspace.saveAs('Made after');
    second.workspace.openPanel('capabilities');

    expect(raw.read(DIVERTED)).toBeNull();
    expect(raw.read(COLLECTION)).toContain('Made after');
  });

  it('lists a copy the collection does not hold, and removes it only once it is written', () => {
    // Beside a collection this build reads whole, the copy was taken for older:
    // dropped from the list, and then set aside where nothing reads it. Whether
    // a collection is whole depends on the panels a build knows, so the copy
    // holds what the user saved while the collection's own text was held in
    // place, and those workspaces are theirs.
    const raw = ephemeralStorage();
    raw.write(COLLECTION, JSON.stringify([]));
    const newer = JSON.stringify([readableWorkspace('Made in another build')]);
    raw.write(DIVERTED, newer);

    const { context } = buildShellContext(raw);
    expect(listed(context)).toContain('Made in another build');
    expect(setAside(raw)).toEqual([]);

    context.workspace.openPanel('capabilities');
    expect(raw.read(COLLECTION)).toContain('Made in another build');
    // Kept in step with the collection until it can go: left as it was, it was
    // a copy older than the collection, and a workspace deleted in that write
    // came back from it at the next start.
    expect(raw.read(DIVERTED)).toBe(raw.read(COLLECTION));

    context.workspace.openPanel('diagnostics');
    expect(raw.read(DIVERTED)).toBeNull();
    expect(listed(buildShellContext(raw).context)).toContain('Made in another build');
  });

  it('does not bring back a workspace deleted while the copy beside it was still there', () => {
    // The copy was left as it was for the one write before it could be removed,
    // so it was older than the collection for that write, and a deletion made
    // in it was undone by the merge at the next start.
    const raw = ephemeralStorage();
    raw.write(COLLECTION, JSON.stringify([]));
    raw.write(DIVERTED, JSON.stringify([readableWorkspace('Made in another build')]));

    const first = buildShellContext(raw).context;
    expect(listed(first)).toContain('Made in another build');
    const deleted = first.workspace
      .get()
      .available.find((one) => one.displayName === 'Made in another build');
    first.workspace.remove(deleted?.id ?? 'missing');

    expect(listed(buildShellContext(raw).context)).not.toContain('Made in another build');
  });

  it("lists the copy's version of a workspace both name, and sets the collection's aside", () => {
    // The copy is written apart from the collection only while the
    // collection's text is held in place, so it is the newer. Kept by the
    // collection's entry, a workspace renamed while the collection was held
    // came back under its old name, and nothing said the rename was lost.
    const original = readableWorkspace('Before the rename');
    const older = JSON.stringify([original]);
    const raw = ephemeralStorage();
    raw.write(COLLECTION, older);
    raw.write(DIVERTED, JSON.stringify([{ ...original, displayName: 'After the rename' }]));

    const { context } = buildShellContext(raw);

    expect(listed(context)).toContain('After the rename');
    expect(listed(context)).not.toContain('Before the rename');
    expect(setAside(raw)).toEqual([older]);
  });

  it('lists every workspace of a copy beside the collection, two under one identifier the collection also holds', () => {
    // Each entry of the copy is a workspace the user saved, whichever
    // identifier it shares: merged by identifier alone, one would be in no
    // list, and would go with the copy once the collection is written.
    const original = readableWorkspace('In the collection');
    const older = JSON.stringify([original]);
    const both = ['First of the copy', 'Second of the copy'];
    const raw = ephemeralStorage();
    raw.write(COLLECTION, older);
    raw.write(DIVERTED, JSON.stringify(both.map((displayName) => ({ ...original, displayName }))));

    const { context } = buildShellContext(raw);
    const ids = context.workspace
      .get()
      .available.filter((one) => both.includes(one.displayName))
      .map((one) => one.id);
    expect(listed(context)).toEqual(expect.arrayContaining(both));
    expect(listed(context)).not.toContain('In the collection');
    expect(ids).toContain(original.id);
    expect(new Set(ids).size).toBe(2);
    expect(setAside(raw)).toEqual([older]);

    context.workspace.openPanel('capabilities');
    context.workspace.openPanel('diagnostics');
    expect(raw.read(DIVERTED)).toBeNull();
    expect(listed(buildShellContext(raw).context)).toEqual(expect.arrayContaining(both));
  });

  it("lists a copy's workspace once beside a collection that holds its identifier twice", () => {
    // The copy's entry takes the place of the first of the collection's under
    // its identifier; the second is a workspace of its own, and stays listed.
    const original = readableWorkspace('First in the collection');
    const raw = ephemeralStorage();
    raw.write(
      COLLECTION,
      JSON.stringify([original, { ...original, displayName: 'Second in the collection' }]),
    );
    raw.write(DIVERTED, JSON.stringify([{ ...original, displayName: 'In the copy' }]));

    const shown = listed(buildShellContext(raw).context);

    expect(shown.filter((one) => one === 'In the copy')).toHaveLength(1);
    expect(shown).toContain('Second in the collection');
    expect(shown).not.toContain('First in the collection');
  });

  it('lists the first of a copy in place of the first of the collection under one identifier, and every other entry of either', () => {
    // Only the first of each is the one workspace in two versions; the second
    // of the collection's and the second of the copy's are each a workspace of
    // its own, so both are listed, and one version alone is set aside.
    const original = readableWorkspace('First in the collection');
    const older = JSON.stringify([
      original,
      { ...original, displayName: 'Second in the collection' },
    ]);
    const raw = ephemeralStorage();
    raw.write(COLLECTION, older);
    raw.write(
      DIVERTED,
      JSON.stringify(
        ['First in the copy', 'Second in the copy'].map((displayName) => ({
          ...original,
          displayName,
        })),
      ),
    );

    const { context, logs } = buildShellContext(raw);

    expect(
      context.workspace
        .get()
        .available.filter((one) => !one.builtIn)
        .map((one) => one.displayName),
    ).toEqual(['First in the copy', 'Second in the collection', 'Second in the copy']);
    expect(setAside(raw)).toEqual([older]);
    expect(
      logs
        .snapshot()
        .filter(
          (record) =>
            record.message === 'A newer copy of the workspaces replaces some of those saved.',
        )
        .map((record) => record.fields),
    ).toEqual([{ replaced: 1 }]);
  });

  it('lists again a workspace that was mounted while its collection could not be written', () => {
    // The layout's own key was kept and the collection's refused, so the
    // workspace came back on screen and could not be found in the list.
    const raw = ephemeralStorage();
    buildShellContext(refusing(raw, COLLECTION)).context.workspace.saveAs('Kept on screen');

    const { context } = buildShellContext(raw);

    expect(context.workspace.get().layout.displayName).toBe('Kept on screen');
    expect(listed(context)).toContain('Kept on screen');
  });

  it('sets aside the text of a mounted workspace it cannot use, before writing over it', () => {
    // The mounted layout's key is written with the next change, and this one
    // was mounted while its collection could not be written, so it is listed
    // nowhere else: refused on its next read, it was gone with that write.
    const raw = ephemeralStorage();
    buildShellContext(refusing(raw, COLLECTION)).context.workspace.saveAs('Kept on screen');
    const stored = JSON.parse(raw.read(MOUNTED) ?? '{}') as Record<string, unknown>;
    const damaged = JSON.stringify({ ...stored, displayName: 'w'.repeat(121) });
    raw.write(MOUNTED, damaged);

    const { context } = buildShellContext(raw);
    context.workspace.openPanel('capabilities');

    expect(textsSetAside(raw.read(MOUNTED_SET_ASIDE))).toEqual([damaged]);
    expect(notices(context)).toEqual([
      `The stored layout's name is longer than 120 characters. The text that could not be read is kept aside. ${EXPORT_IT}`,
    ]);
  });

  it('leaves the text of a mounted workspace it cannot use where it is, where there is no room to set it aside', () => {
    const raw = unreadableWorkspace();
    const damaged = raw.read(MOUNTED);
    const held = {
      ...raw,
      write: (key: string, value: string) => {
        if (key === MOUNTED_SET_ASIDE) throw new Error('The quota is full.');
        raw.write(key, value);
      },
    };

    const { context, storage } = buildShellContext(held);
    context.workspace.openPanel('capabilities');

    expect(raw.read(MOUNTED)).toBe(damaged);
    expect(notices(context)).toEqual([
      `The stored workspace could not be read. The workspace on screen cannot be kept until there is room. The text that could not be read is left where it is, and there is no room to set it aside. ${TRIES_AGAIN} ${EXPORT_IT}`,
    ]);
    // Written nowhere, the workspace on screen is listed as not being kept,
    // and said so when the change is not kept: the collection written beside
    // it is kept, and is said to be.
    expect(storage.get().unsaved).toContain('workspace');
    expect(context.interaction.get().announcement?.text).toBe(
      `The workspace on screen cannot be kept until there is room to set aside the one that could not be read, though the workspaces you save are. ${TRIES_AGAIN}`,
    );
  });

  it('says neither the workspace on screen nor those saved are kept when there is no room for any damaged text', () => {
    // One part's sentence never speaks for the other: the collection's says
    // the workspace on screen is kept, and here its key is written with
    // nothing.
    const damagedCopy = '[{"broken"';
    const raw = unreadableCollection();
    raw.write(DIVERTED, damagedCopy);
    raw.write(MOUNTED, '{"schemaVersion": 1, "groups": [');

    const { context, storage } = buildShellContext(refusing(raw, SET_ASIDE, MOUNTED_SET_ASIDE));
    context.workspace.saveAs('Nowhere to go');

    // What AudioGubbins does meanwhile is said once, in the second notice.
    expect(notices(context)).toEqual([
      `The stored workspace could not be read. The workspace on screen cannot be kept until there is room. The text that could not be read is left where it is, and there is no room to set it aside. ${EXPORT_IT}`,
      `The workspaces you saved could not be read, so only the built-in ones and any you have saved since are listed. The workspaces you save now cannot be kept until there is room. The text that could not be read is left where it is, and there is no room to set it aside. ${TRIES_AGAIN} Some of the workspaces you saved since could not be read either, so they are not listed. What could not be read of them is left where it is. ${EXPORT_IT}`,
    ]);

    const told = context.interaction.get().announcement?.text;
    expect(told).toBe(
      `Neither the workspace on screen nor the workspaces you save can be kept until there is room to set aside what could not be read. ${TRIES_AGAIN}`,
    );
    expect(told).not.toContain('the workspace on screen is');
    // Said over the change just made: the fact, and no advice, and no change
    // said to be saved in the breath that says it is not kept.
    expect(told).not.toContain(ADVICE);
    expect(told).not.toContain('is saved');
    expect(notices(context).join(' ')).not.toContain(ADVICE);
    expect(context.workspace.get().waitsForRoom).toBe(true);
    expect(storage.get().unsaved).toEqual(['workspace']);
    expect(raw.read(MOUNTED)).toBe('{"schemaVersion": 1, "groups": [');
    expect(raw.read(COLLECTION)).toBe(NOT_JSON);
    expect(raw.read(DIVERTED)).toBe(damagedCopy);
  });

  it('names only the part not kept when the other is kept', () => {
    // The collection's text and its copy have no room, and the mounted layout's
    // text is set aside, so the workspace on screen is written and kept.
    const damagedCopy = '[{"broken"';
    const raw = unreadableCollection();
    raw.write(DIVERTED, damagedCopy);
    raw.write(MOUNTED, '{"schemaVersion": 1, "groups": [');

    const { context } = buildShellContext(refusing(raw, SET_ASIDE));
    context.workspace.openPanel('capabilities');

    expect(context.interaction.get().announcement?.text).toBe(
      `The workspaces you save cannot be kept until there is room to set aside what could not be read, though the workspace on screen is. ${TRIES_AGAIN}`,
    );
    expect(raw.read(MOUNTED)).toContain('capabilities');
  });

  it('says only what a write keeps again while the other part is still not kept', () => {
    const raw = unreadableCollection();
    raw.write(DIVERTED, '[{"broken"');
    raw.write(MOUNTED, '{"schemaVersion": 1, "groups": [');
    const quota = quotaFor(refusing(raw, SET_ASIDE), MOUNTED_SET_ASIDE);

    const { context, storage } = buildShellContext(quota.storage);
    context.workspace.openPanel('capabilities');
    quota.full = false;
    context.workspace.openPanel('diagnostics');

    expect(context.interaction.get().announcement?.text).toBe(
      'There is room now to set aside the workspace that could not be read, so the workspace on screen is kept again.',
    );
    expect(raw.read(MOUNTED)).toContain('diagnostics');
    expect(storage.get().unsaved).toEqual(['workspace']);
  });

  it('sets aside the text of a mounted workspace once there is room, and keeps the workspace on screen from then on', () => {
    // Tried only at the start, the set-aside would cost a user who made room
    // and carried on the arrangement at the next load.
    const raw = unreadableWorkspace();
    const damaged = raw.read(MOUNTED);
    const quota = quotaFor(raw, MOUNTED_SET_ASIDE);

    const { context, storage } = buildShellContext(quota.storage);
    context.workspace.openPanel('capabilities');
    expect(raw.read(MOUNTED)).toBe(damaged);
    expect(storage.get().unsaved).toEqual(['workspace']);

    quota.full = false;
    context.workspace.openPanel('diagnostics');

    expect(textsSetAside(raw.read(MOUNTED_SET_ASIDE))).toEqual([damaged]);
    expect(raw.read(MOUNTED)).toContain('diagnostics');
    expect(notices(context)).toEqual([
      `The stored workspace could not be read. The text that could not be read is kept aside. ${EXPORT_IT}`,
    ]);
    expect(context.interaction.get().announcement?.text).toBe(
      'There is room now to set aside the workspace that could not be read, so the workspace on screen is kept again.',
    );
    expect(storage.get().unsaved).toEqual([]);

    const later = buildShellContext(raw).context;
    expect(openKinds(later)).toEqual(expect.arrayContaining(['capabilities', 'diagnostics']));
    expect(notices(later)).toEqual([]);
  });

  it('sets aside the text of the collection once there is room, and keeps the workspaces saved from then on', () => {
    const damagedCopy = '[{"broken"';
    const raw = unreadableCollection();
    raw.write(DIVERTED, damagedCopy);
    const quota = quotaFor(raw, SET_ASIDE);

    const { context, storage } = buildShellContext(quota.storage);
    context.workspace.saveAs('Nowhere to go');
    expect(raw.read(COLLECTION)).toBe(NOT_JSON);
    expect(storage.get().unsaved).toEqual(['workspace']);

    quota.full = false;
    context.workspace.saveAs('Kept once there is room');

    expect(setAside(raw)).toEqual([NOT_JSON, damagedCopy]);
    expect(raw.read(COLLECTION)).toContain('Nowhere to go');
    expect(raw.read(COLLECTION)).toContain('Kept once there is room');
    expect(notices(context)).toEqual([
      `The workspaces you saved could not be read, so only the built-in ones and any you have saved since are listed. The text that could not be read is kept aside. Some of the workspaces you saved since could not be read either, so they are not listed. What could not be read of them is kept aside. ${EXPORT_IT}`,
    ]);
    expect(context.interaction.get().announcement?.text).toBe(
      'There is room now to set aside the workspaces that could not be read, so the workspaces you save are kept again.',
    );
    expect(storage.get().unsaved).toEqual([]);

    const later = buildShellContext(raw).context;
    expect(listed(later)).toEqual(
      expect.arrayContaining(['Nowhere to go', 'Kept once there is room']),
    );
    expect(notices(later)).toEqual([]);
  });

  it('sets aside a collection held in place once there is room, and removes the copy beside it only after that', () => {
    // Nothing was withheld, the collection was written beside its text, so
    // the notice changes and nothing is announced.
    const raw = unreadableCollection();
    const quota = quotaFor(raw, SET_ASIDE);
    const { context } = buildShellContext(quota.storage);
    context.workspace.saveAs('Made while held');
    expect(raw.read(DIVERTED)).toContain('Made while held');

    quota.full = false;
    context.workspace.openPanel('capabilities');

    expect(setAside(raw)).toEqual([NOT_JSON]);
    expect(raw.read(COLLECTION)).toContain('Made while held');
    // Kept in step for the write that first puts the collection back, and
    // removed only in the one after it.
    expect(raw.read(DIVERTED)).toBe(raw.read(COLLECTION));
    expect(notices(context).join(' ')).toContain('The text that could not be read is kept aside.');
    expect(context.interaction.get().announcement).toBeUndefined();

    context.workspace.openPanel('diagnostics');
    expect(raw.read(DIVERTED)).toBeNull();
    expect(listed(buildShellContext(raw).context)).toContain('Made while held');
  });

  it('adds a later damaged text to the one set aside before, replacing nothing', () => {
    // A later damage replaced the text set aside before it.
    const raw = unreadableCollection();
    buildShellContext(raw).context.workspace.openPanel('capabilities');
    raw.write(COLLECTION, '[{"damaged again"');
    buildShellContext(raw);
    buildShellContext(raw);

    expect(setAside(raw)).toEqual([NOT_JSON, '[{"damaged again"']);
  });

  it('writes the collection nowhere when every place it could go holds unread text', () => {
    const damagedCopy = '[{"broken"';
    const raw = unreadableCollection();
    raw.write(DIVERTED, damagedCopy);

    const { context, storage } = buildShellContext(refusing(raw, SET_ASIDE));
    context.workspace.saveAs('Nowhere to go');

    expect(raw.read(COLLECTION)).toBe(NOT_JSON);
    expect(raw.read(DIVERTED)).toBe(damagedCopy);
    expect(notices(context).join(' ')).toContain(
      'The workspaces you save now cannot be kept until there is room.',
    );
    // The advice on making room is the status bar's, shown while this holds,
    // and not said again in the notice.
    expect(context.workspace.get().waitsForRoom).toBe(true);
    expect(notices(context).join(' ')).not.toContain(ADVICE);

    // Written nowhere, it was announced as saved and the status bar said
    // nothing: the part is listed as not being kept.
    expect(storage.get().unsaved).toContain('workspace');
    // And said as what it is: the arrangement on screen was written beside it
    // and kept, and was told it would not survive a reload.
    expect(context.interaction.get().announcement?.text).toBe(
      `The workspaces you save cannot be kept until there is room to set aside what could not be read, though the workspace on screen is. ${TRIES_AGAIN}`,
    );
  });

  it('says text waits for room after its notice is dismissed, until it is set aside', () => {
    // The advice on making room goes with nothing the user does but making
    // it, so it is held apart from the notice the user can dismiss.
    const raw = unreadableWorkspace();
    const quota = quotaFor(raw, MOUNTED_SET_ASIDE);
    const { context } = buildShellContext(quota.storage);
    expect(context.workspace.get().waitsForRoom).toBe(true);

    expect(context.workspace.acknowledgeRecovery('layout')).toBeUndefined();
    context.workspace.openPanel('capabilities');
    expect(notices(context)).toEqual([]);
    expect(context.workspace.get().waitsForRoom).toBe(true);

    quota.full = false;
    context.workspace.openPanel('diagnostics');
    expect(context.workspace.get().waitsForRoom).toBe(false);
  });

  it('says no text waits for room where it could be set aside, or is kept beside it', () => {
    expect(buildShellContext(unreadableCollection()).context.workspace.get().waitsForRoom).toBe(
      false,
    );
    // Held in place, with what is saved kept beside it, it costs nothing.
    const beside = buildShellContext(refusingTheSetAside(unreadableCollection())).context;
    expect(beside.workspace.get().waitsForRoom).toBe(false);
  });

  it('logs each text it sets aside once there is room, by the name of the text', () => {
    // Filed as a part, the copy beside the collection was logged as one, with
    // the parts it is not.
    const raw = unreadableCollection();
    raw.write(DIVERTED, '[{"broken"');
    const quota = quotaFor(raw, SET_ASIDE);
    const { context, logs } = buildShellContext(quota.storage);

    quota.full = false;
    context.workspace.saveAs('Kept once there is room');

    expect(
      logs
        .snapshot()
        .filter((record) => record.message === 'Text that could not be read is set aside now.')
        .map((record) => record.fields),
    ).toEqual([{ text: 'collection' }, { text: 'copy' }]);
  });

  it('tries again at the next start, as the notice says, and keeps what is saved once there is room', () => {
    const damagedCopy = '[{"broken"';
    const raw = unreadableCollection();
    raw.write(DIVERTED, damagedCopy);
    buildShellContext(refusing(raw, SET_ASIDE)).context.workspace.saveAs('Nowhere to go');

    const { context, storage } = buildShellContext(raw);
    expect(setAside(raw)).toEqual([NOT_JSON, damagedCopy]);
    context.workspace.saveAs('Kept at the next start');

    expect(storage.get().unsaved).toEqual([]);
    expect(listed(buildShellContext(raw).context)).toContain('Kept at the next start');
  });

  it('says a refused set-aside in the notice, not as a change that was not saved', () => {
    // Reported as unsaved, it told a user who had changed nothing that their
    // changes would not survive a reload, beside a notice saying the opposite.
    const { context, storage } = buildShellContext(refusing(unreadableCollection(), SET_ASIDE));

    expect(storage.get().unsaved).toEqual([]);
    // And said in the notice, as the title says, not only kept off the list.
    expect(notices(context).join(' ')).toContain(
      'The text that could not be read is left where it is, and what you save is kept beside it.',
    );
  });

  it('says so when the copy written beside it could not all be read either', () => {
    const raw = unreadableCollection();
    raw.write(DIVERTED, '[{"broken"');

    const { context } = buildShellContext(refusingTheSetAside(raw));

    expect(notices(context).join(' ')).toContain(
      'Some of the workspaces you saved since could not be read either',
    );
  });

  it('tells the user about both when the layout and the collection are damaged', () => {
    // One sentence was kept and the layout's won, so the user was never told
    // their saved workspaces could not be read; dismissing it then let the
    // next change write over them.
    const raw = unreadableCollection();
    raw.write('audiogubbins.workspace', '{"schemaVersion": 1, "groups": [');

    const { context } = buildShellContext(raw);

    expect(
      context.workspace
        .get()
        .recoveries.map((one) => one.part)
        .sort(),
    ).toEqual(['collection', 'layout']);

    context.workspace.acknowledgeRecovery('layout');
    context.workspace.openPanel('capabilities');

    expect(setAside(raw)).toEqual([NOT_JSON]);
  });

  it('refuses to dismiss a notice that is not showing, rather than saying it did', () => {
    const { context } = buildShellContext(unreadableWorkspace());

    expect(context.workspace.acknowledgeRecovery('collection')).toBe(
      'There is no notice about your saved workspaces.',
    );
    expect(notices(context)).toHaveLength(1);
  });
});

describe('dismissing the recovery notice', () => {
  it('puts the notice away when the user dismisses it', () => {
    // The store had the operation and nothing called it, so the notice stayed
    // in the status bar for the rest of the session.
    const { context } = buildShellContext(unreadableWorkspace());
    const run = busFor(context);

    const result = run('workspace.dismiss-notice');

    expect(result.kind).toBe('applied');
    expect(context.workspace.get().recoveries).toEqual([]);
  });

  it('is unavailable, and says why, when there is no notice', () => {
    const { context } = buildShellContext();
    const run = busFor(context);

    const result = run('workspace.dismiss-notice');

    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.failures[0].summary).toBe('There is no workspace notice to dismiss.');
    }
  });

  it('keeps the recovered layout when the notice is dismissed', () => {
    const { context } = buildShellContext(unreadableWorkspace());
    const before = context.workspace.get().layout;

    busFor(context)('workspace.dismiss-notice');

    expect(context.workspace.get().layout).toBe(before);
  });
});
