import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  searchCommands,
  type ExecutionResult,
  type CommandBus,
  type CommandId,
  type CommandInvocation,
  type CommandRegistry,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { PanelKinds, panelsIn, type WorkspaceArrangement } from '@audiogubbins/workspace';

import { shellMenus } from '../shell/menus.js';
import { Workspaces } from '../shell/settings/workspaces.js';
import { DESCRIPTORS, buildShellContext, withoutNaming } from '../testing/shell-context.js';
import { shellCommands } from './shell-commands.js';
import type { ShellContext } from './shell-context.js';

/**
 * Every workspace operation REQ-UX-058 states with `shall`.
 *
 * Create, save, duplicate, rename, reset, delete and switch rapidly. Each is a
 * command as well as an operation of the store: without the commands, five of
 * the six presets could never be loaded, and a user who ran Save As once could
 * not return to any preset without clearing their storage.
 */

let context: ShellContext;
let bus: CommandBus<ShellContext>;
let registry: CommandRegistry<ShellContext>;

beforeEach(() => {
  context = buildShellContext().context;

  registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);

  bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
});

/** Runs a command, optionally naming what it acts on. */
function run(id: string, args?: Readonly<Record<string, string>>) {
  return bus.execute(context, {
    commandId: commandId(id),
    ...(args === undefined ? {} : { arguments: args }),
  });
}

/**
 * Why a command refused, or `undefined` when it did not.
 *
 * Read from the outcome rather than from the announcement. A command that
 * announced a refusal and reported success to the bus would pass tests that
 * read the announcement, so these tests ask the outcome and the announcement is
 * what the interface does with it.
 */
function refusalOf(result: ExecutionResult<ShellContext>): string | undefined {
  return result.kind === 'refused' ? result.failures[0].summary : undefined;
}

describe('switching workspace', () => {
  it('switches to the layout the caller named', () => {
    // Without this, five of the six presets could never be loaded at all.
    run('workspace.switch-to', { layoutId: 'recording' });

    expect(context.workspace.get().layout.id).toBe('recording');
  });

  it('moves to the next one when no layout is named', () => {
    // Target resolution: a shortcut and the palette name nothing, and "switch
    // rapidly between layouts" means pressing one key repeatedly.
    const first = context.workspace.get().layout.id;
    run('workspace.switch-to');

    expect(context.workspace.get().layout.id).not.toBe(first);
  });

  it('wraps round the end rather than stopping', () => {
    const count = context.workspace.get().available.length;
    for (let press = 0; press < count; press += 1) run('workspace.switch-to');

    expect(context.workspace.get().layout.id).toBe('editing');
  });

  it('says why it will not switch to the one already in use', () => {
    expect(refusalOf(run('workspace.switch-to', { layoutId: 'editing' }))).toContain(
      'already in use',
    );
  });

  it('says so when the named layout does not exist', () => {
    expect(refusalOf(run('workspace.switch-to', { layoutId: 'no-such-workspace' }))).toContain(
      'no workspace',
    );
    expect(context.workspace.get().layout.id).toBe('editing');
  });

  it('is offered by every preset in turn, so none is unreachable', () => {
    const reached = new Set<string>();
    for (const layout of context.workspace.get().available) {
      run('workspace.switch-to', { layoutId: layout.id });
      reached.add(context.workspace.get().layout.id);
    }

    expect(reached.size).toBe(context.workspace.get().available.length);
  });
});

describe('making a workspace of your own', () => {
  it('saves the arrangement under a name the caller chose', () => {
    run('workspace.save-as', { displayName: 'Mixing' });

    expect(context.workspace.get().layout.displayName).toBe('Mixing');
    expect(context.workspace.get().layout.builtIn).toBe(false);
  });

  it('derives the identifier from the name rather than from a counter', () => {
    // A counter over the list length produced an identifier that collided with
    // a layout the list no longer held.
    run('workspace.save-as', { displayName: 'Mixing' });

    expect(context.workspace.get().layout.id).toBe('mixing');
  });

  it('gives a workspace its own identifier where the one its name derives is taken', () => {
    // The first keeps the identifier its name gave it when it is renamed, so
    // a second saved under that name derives an identifier that is taken.
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.rename', { displayName: 'Mastering' });
    run('workspace.save-as', { displayName: 'Mixing' });

    const ids = context.workspace.get().available.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(context.workspace.get().layout.id).toBe('mixing-2');
  });

  it('names a workspace saved with no name after the first free number, and says which', () => {
    // Counted from the list, the name could be one a workspace already had.
    run('workspace.save-as');
    expect(context.interaction.get().announcement?.text).toBe(
      'Saved this arrangement as “My workspace”.',
    );

    run('workspace.save-as');
    expect(context.workspace.get().layout.displayName).toBe('My workspace 2');
    expect(context.interaction.get().announcement?.text).toBe(
      'Saved this arrangement as “My workspace 2”.',
    );
  });

  it('refuses a name another workspace has, from Save as, Duplicate and Rename alike', () => {
    // Two workspaces of one name were two entries the menu, the settings and
    // "Switched to …" could not tell apart. A screen reader says the two
    // alike, so a name differing only in case is the same name.
    const IN_USE = 'There is already a workspace called “Mixing”. Choose another name.';
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.save-as', { displayName: 'Mastering' });
    const before = context.workspace.get().available;

    expect(refusalOf(run('workspace.save-as', { displayName: 'mixing' }))).toBe(IN_USE);
    expect(
      refusalOf(run('workspace.duplicate', { layoutId: 'editing', displayName: 'MIXING' })),
    ).toBe(IN_USE);
    expect(refusalOf(run('workspace.rename', { displayName: 'Mixing' }))).toBe(IN_USE);

    // A built-in workspace is listed with its mark, so a name typed with the
    // mark would be listed as the preset is.
    const MARKED = 'There is already a workspace called “Editing (built in)”. Choose another name.';
    expect(refusalOf(run('workspace.save-as', { displayName: 'Editing (built in)' }))).toBe(MARKED);
    expect(
      refusalOf(
        run('workspace.duplicate', { layoutId: 'editing', displayName: 'editing (Built In)' }),
      ),
    ).toBe(MARKED);
    expect(refusalOf(run('workspace.rename', { displayName: 'Editing (built in)' }))).toBe(MARKED);
    expect(context.workspace.get().available).toEqual(before);
  });

  it('duplicates a built-in workspace, which is how one becomes editable', () => {
    run('workspace.duplicate', { layoutId: 'editing', displayName: 'Editing, mine' });

    expect(context.workspace.get().layout.displayName).toBe('Editing, mine');
    expect(context.workspace.get().layout.builtIn).toBe(false);
    expect(context.workspace.get().available.some((one) => one.id === 'editing')).toBe(true);
  });

  it('names a copy nobody named as a copy of what it copies, from the menu, the palette and the settings alike', () => {
    // The menu and the palette run the command with no target, and the
    // settings with the chosen workspace, and each copy is named by the one
    // rule. Each route copies the workspace on screen, so each copy after the
    // first is a copy of a copy, numbered in the series of the name it is a
    // copy of rather than called "Editing copy copy".
    const execute = (id: CommandId, args?: CommandInvocation['arguments']) =>
      bus.execute(context, { commandId: id, ...(args === undefined ? {} : { arguments: args }) });
    const onScreen = (): string => context.workspace.get().layout.displayName;

    const fromTheMenu = shellMenus({
      registry,
      context,
      profile: context.shortcuts.get().profile,
      convention: context.convention,
      layout: context.keyboardLayout.get(),
      descriptors: DESCRIPTORS,
      workspace: context.workspace.get(),
      run: (id, args) => {
        execute(id, args);
      },
    })
      .flatMap((menu) => menu.groups.flatMap((group) => group.items))
      .find((item) => item.key === 'workspace.duplicate');
    if (fromTheMenu === undefined) throw new Error('no menu entry duplicates a workspace');
    fromTheMenu.onSelect();
    expect(onScreen()).toBe('Editing copy');

    // The palette runs what a search finds by its identifier alone.
    const fromThePalette = searchCommands(registry.all(), 'Duplicate this workspace', {
      context,
      profile: context.shortcuts.get().profile,
      convention: context.convention,
      layout: context.keyboardLayout.get(),
    }).find((result) => result.command.id === commandId('workspace.duplicate'));
    if (fromThePalette === undefined) throw new Error('the palette offers no duplicate');
    execute(fromThePalette.command.id);
    expect(onScreen()).toBe('Editing copy 2');

    // The settings copy the chosen workspace, with no name typed here.
    const { layout, available } = context.workspace.get();
    render(
      createElement(Workspaces, {
        layout,
        available,
        deleted: [],
        unread: [],
        run: (id, args) => execute(commandId(id), args).kind !== 'refused',
        unavailableReason: () => undefined,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(onScreen()).toBe('Editing copy 3');
  });

  it('names the workspace the store answers with, whatever is mounted afterwards', () => {
    // Read from the workspace mounted after the operation, a sentence is
    // right only while the store mounts what it makes or changes.
    const answer = { ...context.workspace.get().layout, displayName: 'Answered', builtIn: false };
    const before = { ...answer, displayName: 'Before' };
    context = {
      ...context,
      workspace: {
        ...context.workspace,
        renamingProblem: () => undefined,
        removalProblem: () => undefined,
        resetProblem: () => undefined,
        saveAs: () => answer,
        duplicate: () => answer,
        rename: () => ({ before, after: answer }),
        resetBuiltIn: () => answer,
        remove: () => answer,
      },
    };
    const said = (id: string, args?: Readonly<Record<string, string>>) => {
      run(id, args);
      return context.interaction.get().announcement?.text;
    };

    expect(said('workspace.save-as')).toBe('Saved this arrangement as “Answered”.');
    expect(said('workspace.duplicate')).toBe('Copied it as “Answered”.');
    expect(said('workspace.rename', { displayName: 'Answered' })).toBe(
      '“Before” is now called “Answered”.',
    );
    expect(said('workspace.reset')).toBe('“Answered” is back to how it ships.');
    expect(said('workspace.delete')).toBe(
      '“Answered” is deleted. Restore a deleted workspace brings it back until AudioGubbins closes.',
    );
    expect(context.workspace.get().layout.displayName).toBe('Editing');
  });

  it('numbers a second copy nobody named, so no two copies share a name, and says which', () => {
    // Every copy of one workspace was "<name> copy", and the list, the menu
    // and "Switched to …" could not tell them apart.
    run('workspace.duplicate', { layoutId: 'editing' });
    run('workspace.duplicate', { layoutId: 'editing' });

    expect(context.workspace.get().layout.displayName).toBe('Editing copy 2');
    expect(context.interaction.get().announcement?.text).toBe('Copied it as “Editing copy 2”.');
    const names = context.workspace.get().available.map((one) => one.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('duplicates nothing, and says so, for a workspace that is not there, named or not', () => {
    const before = context.workspace.get();

    expect(refusalOf(run('workspace.duplicate', { layoutId: 'absent' }))).toBe(
      'There is no workspace with the identifier "absent".',
    );
    expect(refusalOf(run('workspace.duplicate', { layoutId: 'absent', displayName: 'Mine' }))).toBe(
      'There is no workspace with the identifier "absent".',
    );
    expect(context.workspace.get().available).toEqual(before.available);
    expect(context.workspace.get().layout).toBe(before.layout);
  });

  it('refuses to copy a workspace under a name past the bound, and copies nothing', () => {
    const before = context.workspace.get().available.length;

    const outcome = run('workspace.duplicate', {
      layoutId: 'editing',
      displayName: 'w'.repeat(121),
    });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.failures[0].summary).toBe(
        "A workspace's name can be at most 120 characters long.",
      );
    }
    expect(context.workspace.get().available).toHaveLength(before);
  });

  it('renames a workspace to the name typed without the space around it, and says that name', () => {
    run('workspace.save-as', { displayName: 'Mixing' });

    run('workspace.rename', { displayName: '  Mastering ' });

    expect(context.workspace.get().layout.displayName).toBe('Mastering');
    expect(context.interaction.get().announcement?.text).toBe(
      '“Mixing” is now called “Mastering”.',
    );
  });

  it('says a workspace is already called the name typed, with or without space around it', () => {
    run('workspace.save-as', { displayName: 'Mixing' });

    for (const displayName of ['Mixing', ' Mixing ']) {
      expect(run('workspace.rename', { displayName })).toEqual({
        kind: 'unchanged',
        code: 'workspace.already-named',
        reason: 'That workspace is already called “Mixing”.',
      });
    }
  });

  it('refuses to rename a built-in workspace, and says what to do instead', () => {
    const outcome = run('workspace.rename', { displayName: 'Mine' });

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.failures[0].summary).toBe(
        'A built-in workspace keeps its name. Duplicate it first.',
      );
    }
  });

  it('refuses to rename a built-in workspace to the name it has, rather than finding nothing to do', () => {
    // A built-in workspace cannot be renamed at all; told it was already called
    // that, the user heard nothing, since nothing to do is not said.
    run('workspace.save-as', { displayName: 'Mine' });

    const outcome = run('workspace.rename', { layoutId: 'editing', displayName: 'Editing' });

    expect(refusalOf(outcome)).toBe('A built-in workspace keeps its name. Duplicate it first.');
  });

  it('deletes a workspace the user made and moves them somewhere real', () => {
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.delete');

    expect(context.workspace.get().available.some((one) => one.id === 'mixing')).toBe(false);
    expect(context.workspace.get().layout.builtIn).toBe(true);
  });

  it('refuses to delete a built-in workspace, and says what to do instead', () => {
    // Reset is the way back only once the workspace has changed: as it ships,
    // it was told to reset beside a Reset that could not be used.
    const asItShips = run('workspace.delete');
    expect(asItShips.kind).toBe('refused');
    if (asItShips.kind === 'refused') {
      expect(asItShips.failures[0].summary).toBe(
        'A built-in workspace cannot be deleted. This one is already as it ships.',
      );
    }

    run('workspace.move-panel-left');
    const changed = run('workspace.delete');
    if (changed.kind === 'refused') {
      expect(changed.failures[0].summary).toContain('Reset it instead');
    }
    expect(changed.kind).toBe('refused');
  });

  it('lets the user back to a preset after they have saved one of their own', () => {
    // The trap: after one Save As, Reset refused because the layout was no
    // longer built-in and advised deleting it, and there was no delete command.
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.delete');
    run('workspace.switch-to', { layoutId: 'editing' });

    expect(context.workspace.get().layout.id).toBe('editing');
    expect(context.workspace.get().layout.builtIn).toBe(true);
  });
});

describe('naming a workspace where the browser cannot compare names', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const UNAVAILABLE =
    'Naming workspaces and shortcut profiles is unavailable in this browser; the Capabilities panel says why.';

  it('starts, probes the capability missing, and refuses to save as or copy by it, switching as ever', async () => {
    // A browser that resolves another collation starts, where a check made as
    // the text package loads keeps the page blank with nothing said.
    const RealCollator = Intl.Collator;
    vi.spyOn(Intl, 'Collator').mockImplementation(
      class extends RealCollator {
        constructor(_locales?: Intl.LocalesArgument, options?: Intl.CollatorOptions) {
          super('tr', options);
        }
      },
    );
    vi.resetModules();
    const [{ buildShellContext: build, DESCRIPTORS: descriptors }, shell, commands, probing] =
      await Promise.all([
        import('../testing/shell-context.js'),
        import('./shell-commands.js'),
        import('@audiogubbins/commands'),
        import('@audiogubbins/capabilities'),
      ]);

    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('shell');
    const refused = {
      ...build().context,
      capabilities: probing.createCapabilityRegistry(probing.detectBrowserEnvironment(), logger),
    };
    expect(refused.capabilities.missing().map((state) => state.key)).toContain(
      probing.CapabilityKey.NameComparison,
    );

    const commandsHeld = commands.createCommandRegistry<ShellContext>();
    for (const command of shell.shellCommands(descriptors)) commandsHeld.register(command);
    const runRefused = (id: string, args?: Readonly<Record<string, string>>) =>
      commands
        .createCommandBus(
          commandsHeld,
          createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
        )
        .execute(refused, {
          commandId: commands.commandId(id),
          ...(args === undefined ? {} : { arguments: args }),
        });
    const before = refused.workspace.get().available;

    expect(refusalOf(runRefused('workspace.save-as'))).toBe(UNAVAILABLE);
    expect(refusalOf(runRefused('workspace.save-as', { displayName: 'Mixing' }))).toBe(UNAVAILABLE);
    expect(refusalOf(runRefused('workspace.duplicate'))).toBe(UNAVAILABLE);
    expect(refusalOf(runRefused('workspace.duplicate', { displayName: 'Mine' }))).toBe(UNAVAILABLE);
    expect(refusalOf(runRefused('workspace.switch-to', { layoutId: 'recording' }))).toBeUndefined();
    expect(refused.workspace.get().available).toEqual(before);
    expect(refused.workspace.get().layout.id).toBe('recording');
  });

  it('refuses to save as, copy or rename a workspace the user made, pointing at the capability', () => {
    run('workspace.save-as', { displayName: 'Mixing' });
    const without = withoutNaming(context);
    const runWithout = (id: string, args?: Readonly<Record<string, string>>) =>
      bus.execute(without, {
        commandId: commandId(id),
        ...(args === undefined ? {} : { arguments: args }),
      });

    for (const id of ['workspace.save-as', 'workspace.duplicate', 'workspace.rename']) {
      expect(bus.availability(without, commandId(id)), id).toEqual({
        available: false,
        reason: UNAVAILABLE,
      });
    }
    expect(refusalOf(runWithout('workspace.rename', { displayName: 'Mastering' }))).toBe(
      UNAVAILABLE,
    );
    expect(context.workspace.get().layout.displayName).toBe('Mixing');
  });

  it('refuses to rename a built-in workspace for what it is, and advises a copy only where one can be made', () => {
    // Told to duplicate it first, the reader was sent to a Duplicate that
    // said it could not run.
    expect(context.workspace.get().layout).toMatchObject({ id: 'editing', builtIn: true });
    const without = withoutNaming(context);
    const rename = commandId('workspace.rename');
    const renamed = (where: ShellContext) =>
      refusalOf(
        bus.execute(where, {
          commandId: rename,
          arguments: { layoutId: 'editing', displayName: 'Mine' },
        }),
      );
    expect(bus.availability(without, commandId('workspace.duplicate')).available).toBe(false);

    expect(bus.availability(without, rename)).toEqual({
      available: false,
      reason: 'A built-in workspace keeps its name.',
    });
    expect(renamed(without)).toBe('A built-in workspace keeps its name.');

    // Where Duplicate can make a copy, the reason advises one, from the menu
    // and from the command alike.
    expect(bus.availability(context, rename)).toEqual({
      available: false,
      reason: 'A built-in workspace keeps its name. Duplicate it first.',
    });
    expect(renamed(context)).toBe('A built-in workspace keeps its name. Duplicate it first.');
  });
});

describe('what a menu entry says, against what the command says', () => {
  it('gives the reason the command would give, for every workspace operation a built-in refuses', () => {
    // The menus re-derived these rules in sentences of their own, and the
    // delete entry said to reset a built-in workspace while the store's
    // refusal said to duplicate it.
    for (const id of ['workspace.rename', 'workspace.delete']) {
      const menu = bus.availability(context, commandId(id));
      const command = registry.get(commandId(id));
      const direct = command?.run(context, {
        commandId: commandId(id),
        arguments: { displayName: 'Anything' },
      });

      expect(menu.available).toBe(false);
      expect(direct?.kind).toBe('refused');
      if (!menu.available && direct?.kind === 'refused') {
        expect(direct.failures[0].summary).toBe(menu.reason);
      }
    }
  });
});

describe('opening a panel', () => {
  it('has a command for every panel this build has', () => {
    for (const descriptor of DESCRIPTORS.values()) {
      expect(registry.get(commandId(`workspace.show-${descriptor.kind}`))).toBeDefined();
    }
  });

  it('opens the capability surface, which no preset contains', () => {
    // REQ-EXEC-216 requires unsupported capabilities to be explained. The panel
    // did all of that and no preset held it and no command opened it.
    run(`workspace.show-${PanelKinds.Capabilities}`);

    expect(
      panelsIn(context.workspace.get().layout).some(
        (panel) => panel.kind === PanelKinds.Capabilities,
      ),
    ).toBe(true);
  });

  it('opens a panel the user closed, so closing one is not a one-way door', () => {
    const closed = context.workspace.get().layout.activePanelId;
    expect(closed).toBeDefined();

    const kind = panelsIn(context.workspace.get().layout).find(
      (panel) => panel.id === closed,
    )?.kind;
    run('workspace.close-panel');
    expect(panelsIn(context.workspace.get().layout).some((panel) => panel.id === closed)).toBe(
      false,
    );

    run(`workspace.show-${String(kind)}`);

    expect(panelsIn(context.workspace.get().layout).some((panel) => panel.kind === kind)).toBe(
      true,
    );
  });

  it('brings an open panel forward rather than opening a second one', () => {
    run(`workspace.show-${PanelKinds.Inspector}`);
    run(`workspace.show-${PanelKinds.Capabilities}`);
    run(`workspace.show-${PanelKinds.Inspector}`);

    const inspectors = panelsIn(context.workspace.get().layout).filter(
      (panel) => panel.kind === PanelKinds.Inspector,
    );
    expect(inspectors).toHaveLength(1);
    expect(context.workspace.get().layout.activePanelId).toBe(inspectors[0]?.id);
  });

  it('refuses the panel the user is already looking at', () => {
    run(`workspace.show-${PanelKinds.Capabilities}`);
    const outcome = run(`workspace.show-${PanelKinds.Capabilities}`);

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') {
      expect(outcome.failures[0].summary).toContain('already open');
    }
  });
});

describe('moving and sizing a panel without a pointer', () => {
  /** The region the active panel is in. */
  function regionOfActive(): string | undefined {
    const layout = context.workspace.get().layout;
    return layout.groups.find((group) =>
      group.panels.some((panel) => panel.id === layout.activePanelId),
    )?.region;
  }

  it('moves the panel the user is working in to each region', () => {
    // The engine moves a panel with the browser's drag-and-drop, which a
    // keyboard cannot reach and a touch screen never produces.
    for (const region of ['left', 'right', 'bottom', 'floating', 'centre']) {
      expect(run(`workspace.move-panel-${region}`).kind).toBe('applied');
      expect(regionOfActive()).toBe(region);
    }
  });

  it('gives the panel more room and less, and stops where a panel stops being usable', () => {
    run('workspace.move-panel-left');

    const roomOf = (): number | undefined => {
      const layout = context.workspace.get().layout;
      return layout.groups.find((group) =>
        group.panels.some((panel) => panel.id === layout.activePanelId),
      )?.proportion;
    };

    const before = roomOf() ?? 0;
    expect(run('workspace.grow-panel').kind).toBe('applied');
    expect(roomOf()).toBeGreaterThan(before);

    expect(run('workspace.shrink-panel').kind).toBe('applied');
    expect(roomOf()).toBeCloseTo(before, 10);

    for (let press = 0; press < 20; press += 1) run('workspace.shrink-panel');
    expect(refusalOf(run('workspace.shrink-panel'))).toContain('as small as it goes');
  });

  it('sizes a floating panel too, rather than telling the user to drag its edges', () => {
    // Dragging an edge is the pointer gesture these commands exist to replace.
    run('workspace.move-panel-floating');

    expect(run('workspace.grow-panel').kind).toBe('applied');
    expect(context.interaction.get().announcement?.text).toBe('The Editor panel has more room.');
  });

  it('says where the panel went, for the user who could not watch it move', () => {
    // These commands exist for the users who cannot drag, and they said
    // nothing when they worked: a screen-reader user heard the palette close
    // and then silence.
    const said = (): string | undefined => context.interaction.get().announcement?.text;

    run('workspace.move-panel-bottom');
    expect(said()).toBe('The Editor panel is now along the bottom.');

    run('workspace.move-panel-floating');
    expect(said()).toBe('The Editor panel is now floating.');

    run('workspace.move-panel-left');
    expect(said()).toBe('The Editor panel is now on the left.');

    run('workspace.shrink-panel');
    expect(said()).toBe('The Editor panel has less room.');
  });

  it('greys an entry with its reason before the user chooses it', () => {
    // Every arrangement command checked only that a panel was active, so the
    // menu offered a move and then refused it.
    run('workspace.move-panel-bottom');

    const availability = bus.availability(context, commandId('workspace.move-panel-bottom'));
    expect(availability).toEqual({
      available: false,
      reason: 'That panel is already along the bottom.',
    });
  });

  it('nudges a floating panel, says which way it went, and stops it against each edge', () => {
    // The engine moves a floating group by dragging its header, which is a
    // pointer gesture with no alternative: a panel could be floated, resized
    // and re-docked from the keyboard, and moved only by dragging (WCAG
    // 2.5.7).
    run('workspace.move-panel-floating');
    const placement = (): { x: number; y: number } | undefined => {
      const group = context.workspace.get().layout.groups.find((one) => one.region === 'floating');
      return group?.placement;
    };

    const before = placement();
    expect(before).toBeDefined();

    expect(run('workspace.nudge-panel-left').kind).toBe('applied');
    expect(placement()?.x).toBeLessThan(before?.x ?? 0);
    // Which way, not only that something moved. One step is a twentieth of the
    // workspace, so crossing it is about twenty presses, and a reader who
    // cannot see the panel was told twenty times that it had moved.
    expect(context.interaction.get().announcement?.text).toBe('The Editor panel has moved left.');

    expect(run('workspace.nudge-panel-up').kind).toBe('applied');
    expect(placement()?.y).toBeLessThan(before?.y ?? 0);
    expect(context.interaction.get().announcement?.text).toBe('The Editor panel has moved up.');

    // Against the near edge it stops, and says so rather than reporting a move.
    for (let step = 0; step < 40; step += 1) run('workspace.nudge-panel-left');
    // Against the edge, to the rounding that adding a twentieth forty times
    // leaves behind, which the store's own comparison already treats as none.
    expect(placement()?.x ?? 1).toBeCloseTo(0, 9);
    expect(refusalOf(run('workspace.nudge-panel-left'))).toBe(
      'That panel is already against that edge.',
    );

    // And against the far edge, which is the other half of the clamp and is
    // driven nowhere else: the group's far side stops at the workspace's, not
    // its near side at the far edge.
    const size = context.workspace
      .get()
      .layout.groups.find((one) => one.region === 'floating')?.placement;
    for (let step = 0; step < 60; step += 1) run('workspace.nudge-panel-right');
    expect(placement()?.x ?? 0).toBeCloseTo(1 - (size?.width ?? 0), 9);
    expect(refusalOf(run('workspace.nudge-panel-right'))).toBe(
      'That panel is already against that edge.',
    );

    for (let step = 0; step < 60; step += 1) run('workspace.nudge-panel-down');
    expect(placement()?.y ?? 0).toBeCloseTo(1 - (size?.height ?? 0), 9);
    expect(refusalOf(run('workspace.nudge-panel-down'))).toBe(
      'That panel is already against that edge.',
    );
  });

  it('refuses to nudge a docked panel, and says which commands move it', () => {
    expect(refusalOf(run('workspace.nudge-panel-left'))).toBe(
      'Only a floating panel can be nudged. Use the commands that move this panel to a side.',
    );
  });

  it('moves a panel along its group tabs, which the engine offers only to a drag', () => {
    // The engine reorders tabs by dragging one over another.
    run('workspace.move-panel-left');
    const order = (): readonly string[] =>
      context.workspace
        .get()
        .layout.groups.find((one) => one.region === 'left')
        ?.panels.map((panel) => panel.id) ?? [];

    const moved = order();
    expect(moved.length).toBeGreaterThan(1);
    expect(moved.at(-1)).toBe(context.workspace.get().layout.activePanelId);

    expect(run('workspace.move-tab-earlier').kind).toBe('applied');
    expect(order()[0]).toBe(context.workspace.get().layout.activePanelId);
    expect(context.interaction.get().announcement?.text).toBe(
      'The Editor panel has moved earlier in its group.',
    );

    expect(refusalOf(run('workspace.move-tab-earlier'))).toBe(
      'That panel is already first in its group.',
    );

    expect(run('workspace.move-tab-later').kind).toBe('applied');
    expect(order().at(-1)).toBe(context.workspace.get().layout.activePanelId);
    expect(refusalOf(run('workspace.move-tab-later'))).toBe(
      'That panel is already last in its group.',
    );
  });

  it('refuses to reorder a panel that is alone in its group', () => {
    expect(refusalOf(run('workspace.move-tab-earlier'))).toBe(
      'That panel is the only one in its group.',
    );
  });

  it('refuses to float the last docked panel', () => {
    // Floating every panel in turn used to be allowed, and left a workspace
    // with nothing docked for the floating panels to be measured against.
    /** Makes a panel the one the user is working in, as a click in the dock does. */
    const focus = (id: string): void => {
      const { groups } = context.workspace.get().layout;
      run('workspace.rearrange', { arrangement: JSON.stringify({ groups, activePanelId: id }) });
    };

    const ids = panelsIn(context.workspace.get().layout).map((panel) => panel.id);
    const outcomes = ids.map((id) => {
      focus(id);
      return refusalOf(run('workspace.move-panel-floating')) ?? 'applied';
    });

    expect(outcomes.slice(0, -1).every((one) => one === 'applied')).toBe(true);
    expect(outcomes.at(-1)).toBe(
      'That is the last docked panel, and floating it would leave nothing for the others to float over.',
    );
    expect(context.workspace.get().layout.groups.some((group) => group.region !== 'floating')).toBe(
      true,
    );
  });

  it('refuses to close when no panel is active, rather than reporting a close', () => {
    // The body returned nothing here, which the bus records as a close that
    // happened. The bus's availability check stops the menu reaching it; a
    // replayed invocation run against the command reaches it directly.
    const arrangement = { groups: context.workspace.get().layout.groups };
    run('workspace.rearrange', { arrangement: JSON.stringify(arrangement) });
    expect(context.workspace.get().layout.activePanelId).toBeUndefined();

    const command = registry.get(commandId('workspace.close-panel'));
    const outcome = command?.run(context, { commandId: commandId('workspace.close-panel') });

    expect(outcome?.kind).toBe('refused');
    if (outcome?.kind === 'refused') {
      expect(outcome.failures[0].summary).toBe('No panel is active.');
    }
  });

  it('mounts the workspace again, so the engine draws the panel where it now is', () => {
    // A move changes the arrangement the dock was mounted with, and the dock
    // builds its arrangement once. Without the remount the store and the screen
    // would disagree until something else forced one.
    const before = context.workspace.get().revision;
    run('workspace.move-panel-bottom');

    expect(context.workspace.get().revision).toBeGreaterThan(before);
  });
});

describe('rearranging the panels', () => {
  /** The arrangement on screen, with its first group given a new proportion. */
  function resized(): string {
    const { groups, activePanelId } = context.workspace.get().layout;
    const [first, ...rest] = groups;
    if (first === undefined) throw new Error('the layout has no groups');

    return JSON.stringify({
      groups: [{ ...first, proportion: 0.5 }, ...rest],
      ...(activePanelId === undefined ? {} : { activePanelId }),
    });
  }

  it('stores the arrangement the dock reported, through the command bus', () => {
    // The dock wrote to the store directly: the one change the interface made
    // without a command, so a macro could not replay it and nothing checked it.
    const outcome = run('workspace.rearrange', { arrangement: resized() });

    expect(outcome.kind).toBe('applied');
    expect(context.workspace.get().layout.groups[0]?.proportion).toBe(0.5);
  });

  it('answers that it found nothing to do for the arrangement already in use', () => {
    // Not a refusal: the dock puts itself back after one, so a report that
    // moved nothing would rebuild it, and every panel's own state with it.
    const before = context.workspace.get();
    const { groups, activePanelId } = before.layout;

    const outcome = run('workspace.rearrange', {
      arrangement: JSON.stringify({
        groups,
        ...(activePanelId === undefined ? {} : { activePanelId }),
      }),
    });

    // Exactly, not by containment: the code is what a log records, and the
    // reason is the sentence the user hears.
    expect(outcome).toEqual({
      kind: 'unchanged',
      code: 'panels.already-arranged',
      reason: 'The panels are already arranged that way.',
    });
    expect(context.workspace.get().revision).toBe(before.revision);
  });

  /**
   * An arrangement as the dock writes it: the centre's groups first, and each
   * group's fields in the order the dock reads them in.
   */
  function asTheDockWrites(arrangement: WorkspaceArrangement, activePanelId?: string): string {
    const groups = [...arrangement.groups]
      .sort((one, other) => Number(other.region === 'centre') - Number(one.region === 'centre'))
      .map(({ region, panels, activePanelId: front, proportion }) => ({
        region,
        panels,
        activePanelId: front,
        proportion,
      }));
    const active = activePanelId ?? arrangement.activePanelId;
    return JSON.stringify({ groups, ...(active === undefined ? {} : { activePanelId: active }) });
  }

  it('answers the same for the arrangement in use written in the order the dock writes it', () => {
    // Compared as text, the dock's order made a report of nothing new a change.
    const before = context.workspace.get();

    const outcome = run('workspace.rearrange', { arrangement: asTheDockWrites(before.layout) });

    expect(outcome.kind).toBe('unchanged');
    expect(context.workspace.get().revision).toBe(before.revision);
  });

  it('offers no reset once the dock has reported the workspace as it ships', () => {
    // A tab clicked and clicked back: the second report is the workspace as it
    // ships, in the dock's order, and was taken for a change to reset.
    const shipped = context.workspace.get().layout;
    const other = shipped.groups
      .flatMap((group) => group.panels)
      .find((panel) => panel.id !== shipped.activePanelId);
    if (other === undefined) throw new Error('the layout has one panel');

    expect(
      run('workspace.rearrange', { arrangement: asTheDockWrites(shipped, other.id) }).kind,
    ).toBe('applied');
    expect(run('workspace.rearrange', { arrangement: asTheDockWrites(shipped) }).kind).toBe(
      'applied',
    );

    expect(refusalOf(run('workspace.reset'))).toBe(
      `“${shipped.displayName}” is already as it ships.`,
    );
  });

  it('keeps a rename the dock has not heard about', () => {
    // The dock is mounted once and is never told the workspace was renamed, so
    // it goes on reporting the name it was mounted with. When that name
    // travelled with the arrangement, a drag after a rename either undid the
    // rename or was refused as another workspace's, and every later drag with
    // it: the user's arrangement stopped being stored at all.
    run('workspace.save-as', { displayName: 'Mine' });
    run('workspace.rename', { displayName: 'Mine, renamed' });

    const outcome = run('workspace.rearrange', { arrangement: resized() });

    expect(outcome.kind).toBe('applied');
    expect(context.workspace.get().layout.displayName).toBe('Mine, renamed');
    expect(context.workspace.get().layout.groups[0]?.proportion).toBe(0.5);
  });

  it('refuses text that is not an arrangement, and changes nothing', () => {
    const before = context.workspace.get().layout;

    expect(refusalOf(run('workspace.rearrange', { arrangement: 'not json' }))).toBe(
      'That arrangement could not be read.',
    );

    expect(
      refusalOf(run('workspace.rearrange', { arrangement: JSON.stringify({ groups: [] }) })),
    ).toBe('That is not an arrangement this workspace can show.');

    expect(
      refusalOf(
        run('workspace.rearrange', { arrangement: JSON.stringify({ groups: 'all of them' }) }),
      ),
    ).toBe('That is not an arrangement this workspace can show.');

    expect(context.workspace.get().layout).toBe(before);
  });

  it('refuses a drag that floats the last docked group, and changes nothing', () => {
    // The dock puts itself back when its own report is refused; the command
    // changes nothing, so a refused macro does not rebuild the dock.
    const before = context.workspace.get();
    const floated = before.layout.groups.map((group) => ({
      ...group,
      region: 'floating',
      placement: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
    }));

    expect(
      refusalOf(run('workspace.rearrange', { arrangement: JSON.stringify({ groups: floated }) })),
    ).toBe('That would leave nothing docked for the floating panels to float over.');

    expect(context.workspace.get().layout).toBe(before.layout);
    expect(context.workspace.get().revision).toBe(before.revision);
  });

  it('arranges the workspace on screen, whatever identity the caller sends', () => {
    // The identity is not the caller's to give: an arrangement has nowhere to
    // name a workspace, so a replayed one that names another moves the panels,
    // and the workspace stays itself.
    const before = context.workspace.get().layout;
    const { groups } = before;
    const [first, ...rest] = groups;
    if (first === undefined) throw new Error('the layout has no groups');

    const outcome = run('workspace.rearrange', {
      arrangement: JSON.stringify({
        id: 'recording',
        displayName: 'Recording',
        builtIn: false,
        groups: [{ ...first, proportion: 0.42 }, ...rest],
      }),
    });

    expect(outcome.kind).toBe('applied');

    const after = context.workspace.get().layout;
    expect(after.id).toBe(before.id);
    expect(after.displayName).toBe(before.displayName);
    expect(after.builtIn).toBe(before.builtIn);
    expect(after.groups[0]?.proportion).toBe(0.42);
  });

  it('points a keyboard or touch user at the commands that move a panel', () => {
    expect(refusalOf(run('workspace.rearrange'))).toContain('"Move this panel to the left"');
  });

  it('is not offered in the palette, where nothing the user types can supply it', () => {
    // It matched a search for "move" beside the commands that move a panel
    // from the keyboard, and a user who chose it was told to drag.
    const found = (query: string) =>
      searchCommands(registry.all(), query, {
        context,
        profile: context.shortcuts.get().profile,
        convention: context.convention,
        layout: context.keyboardLayout.get(),
      }).map((result) => result.command.id);

    expect(found('rearrange')).not.toContain(commandId('workspace.rearrange'));
    expect(found('move')).toContain(commandId('workspace.move-panel-left'));
    expect(registry.get(commandId('workspace.rearrange'))).toBeDefined();
  });
});

describe('restoring a deleted workspace', () => {
  /** What the last command said. */
  const said = (): string | undefined => context.interaction.get().announcement?.text;

  /** The names of the workspaces the user made, as the list shows them. */
  const stored = (of: ShellContext): readonly string[] =>
    of.workspace
      .get()
      .available.filter((one) => !one.builtIn)
      .map((one) => one.displayName);

  it('puts back the one deleted, as it was, and on screen where it was when it was deleted', () => {
    // A deletion was one press with no way back.
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.move-panel-left');
    const before = context.workspace.get().layout;
    run('workspace.delete');
    expect(context.workspace.get().layout.id).not.toBe('mixing');

    expect(run('workspace.restore').kind).toBe('applied');

    expect(context.workspace.get().layout).toEqual(before);
    expect(stored(context)).toEqual(['Mixing']);
    expect(context.workspace.get().deleted).toEqual([]);
    expect(said()).toBe('“Mixing” is back, on screen again.');
  });

  it('puts back one deleted while another was on screen, and leaves the user where they are', () => {
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.save-as', { displayName: 'Mastering' });
    run('workspace.delete', { layoutId: 'mixing' });
    expect(context.workspace.get().layout.id).toBe('mastering');

    run('workspace.restore');

    expect(context.workspace.get().layout.id).toBe('mastering');
    expect(stored(context)).toEqual(['Mastering', 'Mixing']);
    expect(said()).toBe('“Mixing” is back.');
  });

  it('keeps what it puts back across a reload', () => {
    const { context: first, storage } = buildShellContext();
    context = first;
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.delete');
    run('workspace.restore');

    expect(storage.get().unsaved).toEqual([]);
    const raw = JSON.parse(storage.read('audiogubbins.workspaces') ?? '[]') as { id: string }[];
    expect(raw.map((one) => one.id)).toEqual(['mixing']);
  });

  it('puts back the newest first, or the one named, and each once', () => {
    run('workspace.save-as', { displayName: 'First' });
    run('workspace.save-as', { displayName: 'Second' });
    run('workspace.delete', { layoutId: 'first' });
    run('workspace.delete', { layoutId: 'second' });

    run('workspace.restore', { layoutId: 'first' });
    expect(stored(context)).toEqual(['First']);
    expect(context.workspace.get().deleted.map((one) => one.id)).toEqual(['second']);

    run('workspace.restore');
    expect(stored(context)).toEqual(['First', 'Second']);
    expect(refusalOf(run('workspace.restore'))).toBe(
      'No workspace has been deleted since AudioGubbins started.',
    );
  });

  it('numbers the name of one put back where a workspace saved since has it, and says so', () => {
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.delete');
    run('workspace.save-as', { displayName: 'Mixing' });

    run('workspace.restore');

    expect(stored(context)).toEqual(['Mixing', 'Mixing 2']);
    expect(said()).toBe(
      '“Mixing” is back, on screen again, as “Mixing 2”, since another workspace has its name now.',
    );
  });

  it('is unavailable, and says why, with nothing deleted, and refuses a workspace never deleted', () => {
    expect(bus.availability(context, commandId('workspace.restore'))).toEqual({
      available: false,
      reason: 'No workspace has been deleted since AudioGubbins started.',
    });

    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.delete');
    expect(refusalOf(run('workspace.restore', { layoutId: 'editing' }))).toBe(
      'No workspace deleted since AudioGubbins started had the identifier "editing".',
    );
    expect(stored(context)).toEqual([]);
  });

  it('puts back a workspace where this browser cannot compare names', () => {
    // Refused there, a workspace deleted by mistake would be kept from the
    // user for want of a comparison.
    run('workspace.save-as', { displayName: 'Mixing' });
    run('workspace.delete');
    context = withoutNaming(context);

    expect(run('workspace.restore').kind).toBe('applied');
    expect(stored(context)).toEqual(['Mixing']);
  });

  it('is offered in the Workspace menu beside Delete', () => {
    const menus = shellMenus({
      registry,
      context,
      profile: context.shortcuts.get().profile,
      convention: context.convention,
      layout: context.keyboardLayout.get(),
      descriptors: DESCRIPTORS,
      workspace: context.workspace.get(),
      run: () => undefined,
    });
    const labels = menus
      .flatMap((menu) => menu.groups)
      .flatMap((group) => group.items)
      .map((item) => item.label);

    expect(labels).toContain('Restore a deleted workspace');
  });
});
