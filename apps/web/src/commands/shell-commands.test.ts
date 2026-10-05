import { beforeEach, describe, expect, it } from 'vitest';

import {
  KeyboardConvention,
  commandId,
  createCommandBus,
  createCommandRegistry,
  describeShortcut,
  findShortcutConflicts,
  isReservedByPlatform,
  resultCommandIds,
  searchCommands,
  shortcut,
  shortcutKey,
  type CommandBus,
  type CommandRegistry,
} from '@audiogubbins/commands';
import {
  ACCENT_HUES,
  ContrastLevel,
  Density,
  MotionLevel,
  ThemeMode,
} from '@audiogubbins/design-system';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { UNKNOWN_LAYOUT, keyPress, keyboardLayout, type KeyboardLayout } from '@audiogubbins/input';
import { DockRegion } from '@audiogubbins/workspace';

import { createStateStorage } from '../state/state-storage.js';
import { ephemeralStorage } from '../testing/ephemeral-storage.js';
import { createWorkspaceStore } from '../state/workspace-store.js';
import { AZERTY, DVORAK, GERMAN, NAMED_LAYOUTS, RUSSIAN } from '../testing/keyboard-layouts.js';
import { playbackSettled } from '../testing/audio-fakes.js';
import { holdPlatformFiles, windowWithAudio } from '../testing/project-audio.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import {
  DEFAULT_PROFILE_ID,
  defaultShortcutProfile,
  placeDefaults,
} from '../state/default-shortcuts.js';
import { backupCommands } from './backup-commands.js';
import { backupFolderCommands } from './backup-folder-commands.js';
import { compactionCommands } from './compaction-commands.js';
import { auditionCommands } from './audition-commands.js';
import { comparisonCommands } from './comparison-commands.js';
import { historyCommands } from './history-commands.js';
import { channelCommands } from './channel-commands.js';
import { clipboardCommands } from './clipboard-commands.js';
import { editCommands } from './edit-commands.js';
import { markerCommands } from './marker-commands.js';
import { regionBoundaryCommands } from './region-boundary-commands.js';
import { regionCommands } from './region-commands.js';
import { regionPropertyCommands } from './region-property-commands.js';
import { splitCommands } from './split-commands.js';
import { markerNudgeCommands } from './marker-nudge-commands.js';
import { ownershipCommands } from './ownership-commands.js';
import { deletionCommands } from './project-deletion-commands.js';
import { projectFileCommands } from './project-file-commands.js';
import { projectTransferCommands } from './project-transfer-commands.js';
import { audioImportCommands } from './audio-import-commands.js';
import { quickEditCommands } from './quick-edit-commands.js';
import { shellCommands } from './shell-commands.js';
import { sourceCommands } from './source-commands.js';
import { storageCommands } from './storage-commands.js';
import type { ShellContext } from './shell-context.js';

holdPlatformFiles();

describe('the shell command set', () => {
  const commands = shellCommands(DESCRIPTORS);

  it('gives every command a distinct identifier', () => {
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every command a British-English label', () => {
    for (const command of commands) {
      expect(command.label.length).toBeGreaterThan(2);
      expect(command.label).not.toMatch(/\b(color|customize|behavior|analyze)\b/i);
    }
  });

  it('marks no command undoable, since every change to content is the project\u2019s', () => {
    // A user pressing Undo after a mistaken edit must not find it switching
    // their theme back instead (REQ-EDIT-073). Markers, regions and edits are
    // the project's, so their commands run through its session and undo
    // reverses them in its history (ADR-0047, ADR-0051); nothing the shell
    // holds itself is undone.
    expect(commands.filter((command) => command.undoable).map((command) => command.id)).toEqual([]);
  });

  it('says only of the appearance commands that they change how the interface is drawn', () => {
    // Their shortcuts are the only ones that run while a modal dialogue is
    // open, so a command that acts on the page behind must never say so.
    const appearance = commands
      .filter((command) => command.changesAppearance === true)
      .map((command) => command.id);

    expect(appearance).toContain('view.brighten');
    expect(appearance).toContain('view.theme-dark');
    expect(appearance.filter((id) => !id.startsWith('view.'))).toEqual([]);
    expect(appearance).not.toContain('view.command-palette');
  });

  it('offers an accent command for every accent', () => {
    const accentCommands = commands.filter((command) => command.id.startsWith('view.accent-'));
    expect(accentCommands).toHaveLength(Object.keys(ACCENT_HUES).length);
  });
});

describe('running the shell commands', () => {
  let context: ShellContext;
  let bus: CommandBus<ShellContext>;
  let registry: CommandRegistry<ShellContext>;

  beforeEach(() => {
    const built = buildShellContext();
    context = built.context;

    registry = createCommandRegistry<ShellContext>();
    for (const command of shellCommands(DESCRIPTORS)) registry.register(command);

    bus = createCommandBus(
      registry,
      createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
    );
  });

  it('switches to the light theme', () => {
    bus.execute(context, { commandId: commandId('view.theme-light') });
    expect(context.preferences.get().mode).toBe(ThemeMode.Light);
  });

  it('follows the system theme', () => {
    bus.execute(context, { commandId: commandId('view.theme-system') });
    expect(context.preferences.get().mode).toBe(ThemeMode.System);
  });

  it('changes the accent colour', () => {
    bus.execute(context, { commandId: commandId('view.accent-teal') });
    expect(context.preferences.get().accent).toBe('teal');
  });

  it('refuses the accent that is already in use, and says so', () => {
    const result = bus.execute(context, { commandId: commandId('view.accent-blue') });

    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.failures[0].summary).toContain('already in use');
    }
  });

  it('brightens and darkens by one step', () => {
    bus.execute(context, { commandId: commandId('view.brighten') });
    expect(context.preferences.get().brightness).toBeCloseTo(0.1, 5);

    bus.execute(context, { commandId: commandId('view.darken') });
    expect(context.preferences.get().brightness).toBeCloseTo(0, 5);
  });

  it('refuses to brighten past the end of the range', () => {
    context.preferences.change({ brightness: 1 });
    const result = bus.execute(context, { commandId: commandId('view.brighten') });

    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') expect(result.failures[0].summary).toContain('brightest');
  });

  it('changes the density', () => {
    bus.execute(context, { commandId: commandId('view.density-compact') });
    expect(context.preferences.get().density).toBe(Density.Compact);
  });

  it('turns high contrast on and off', () => {
    bus.execute(context, { commandId: commandId('view.high-contrast') });
    expect(context.preferences.get().contrast).toBe(ContrastLevel.High);

    bus.execute(context, { commandId: commandId('view.standard-contrast') });
    expect(context.preferences.get().contrast).toBe(ContrastLevel.Standard);
  });

  it('sets a motion level', () => {
    bus.execute(context, { commandId: commandId('view.motion-minimal') });
    expect(context.preferences.get().motion).toBe(MotionLevel.Minimal);
  });

  it('returns to following the system animation setting', () => {
    bus.execute(context, { commandId: commandId('view.motion-minimal') });
    bus.execute(context, { commandId: commandId('view.motion-system') });

    // Absent rather than Full: that is what lets prefers-reduced-motion apply
    // again (REQ-UX-069).
    expect(context.preferences.get().motion).toBeUndefined();
  });

  it('names a level it is set to already by the word its entry is labelled with', () => {
    // "Already full" read as a statement about capacity.
    bus.execute(context, { commandId: commandId('view.motion-full') });
    const again = bus.execute(context, { commandId: commandId('view.motion-full') });

    expect(again.kind).toBe('refused');
    if (again.kind !== 'refused') return;
    expect(again.failures[0].summary).toBe('Animation is already set to Full.');
  });

  it('refuses to follow the system setting when it already does', () => {
    expect(bus.execute(context, { commandId: commandId('view.motion-system') }).kind).toBe(
      'refused',
    );
  });

  it('sets the brightness the slider was moved to', () => {
    // The slider was wired to two fixed-step commands, so a drag moved the
    // value one step and the thumb sprang back. The command that replaced them
    // had no test at all.
    bus.execute(context, {
      commandId: commandId('view.set-brightness'),
      arguments: { brightness: 0.4 },
    });

    expect(context.preferences.get().brightness).toBeCloseTo(0.4, 10);
  });

  it('keeps the brightness inside the range the control offers', () => {
    bus.execute(context, {
      commandId: commandId('view.set-brightness'),
      arguments: { brightness: 40 },
    });

    expect(context.preferences.get().brightness).toBe(1);
  });

  it('refuses a brightness it cannot read, rather than doing nothing quietly', () => {
    // An invocation may carry a string, which a macro or a replayed journal can
    // produce. It returned without a word and reported success.
    const before = context.preferences.get().brightness;
    const outcome = bus.execute(context, {
      commandId: commandId('view.set-brightness'),
      arguments: { brightness: 'quite bright' },
    });

    expect(outcome.kind).toBe('refused');
    expect(context.preferences.get().brightness).toBe(before);
  });

  it('opens the command palette', () => {
    bus.execute(context, { commandId: commandId('view.command-palette') });
    expect(context.interaction.get().paletteOpen).toBe(true);
  });

  it('opens settings', () => {
    bus.execute(context, { commandId: commandId('settings.open') });
    expect(context.interaction.get().settingsOpen).toBe(true);
  });

  it('closes each surface by command, as it opens it', () => {
    // Both were opened by a command and closed by a write to the store, so a
    // macro could open the palette and nothing could shut it (ADR-0013).
    bus.execute(context, { commandId: commandId('view.command-palette') });
    bus.execute(context, { commandId: commandId('view.close-command-palette') });
    expect(context.interaction.get().paletteOpen).toBe(false);

    bus.execute(context, { commandId: commandId('settings.open') });
    bus.execute(context, { commandId: commandId('settings.close') });
    expect(context.interaction.get().settingsOpen).toBe(false);
  });

  it('refuses to close a surface that is not open, and says so', () => {
    const palette = bus.execute(context, { commandId: commandId('view.close-command-palette') });
    expect(palette.kind).toBe('refused');
    if (palette.kind === 'refused') {
      expect(palette.failures[0].summary).toContain('not open');
    }

    const settings = bus.execute(context, { commandId: commandId('settings.close') });
    expect(settings.kind).toBe('refused');
    if (settings.kind === 'refused') {
      expect(settings.failures[0].summary).toContain('not open');
    }
  });

  it('starts and stops diagnostic mode, telling the user it stays local', () => {
    bus.execute(context, { commandId: commandId('help.start-diagnostic-mode') });

    expect(context.diagnostics.isDiagnosticModeActive()).toBe(true);
    expect(context.interaction.get().announcement?.text).toContain('this machine only');

    bus.execute(context, { commandId: commandId('help.stop-diagnostic-mode') });
    expect(context.diagnostics.isDiagnosticModeActive()).toBe(false);
  });

  it('refuses to stop diagnostic mode that is not running', () => {
    expect(bus.execute(context, { commandId: commandId('help.stop-diagnostic-mode') }).kind).toBe(
      'refused',
    );
  });

  it('refuses to clear a log that is already empty', () => {
    context.logs.clear();
    expect(bus.execute(context, { commandId: commandId('help.clear-logs') }).kind).toBe('refused');
  });

  it('clears the log when there is something to clear', () => {
    context.diagnostics.loggerFor('test').error('Something happened.');
    expect(context.logs.usage().recordCount).toBeGreaterThan(0);

    bus.execute(context, { commandId: commandId('help.clear-logs') });
    expect(context.logs.usage().recordCount).toBe(0);
  });

  it('saves the arrangement as a new workspace', () => {
    bus.execute(context, { commandId: commandId('workspace.save-as') });

    const { layout, available } = context.workspace.get();
    expect(layout.builtIn).toBe(false);
    expect(available.some((one) => one.id === layout.id)).toBe(true);
  });

  it('resets a built-in workspace', () => {
    // Changed first: reset in the arrangement it ships in, it has nothing to
    // put back, and is refused rather than recorded as applied.
    const shipped = context.workspace.get().layout;
    bus.execute(context, { commandId: commandId('workspace.close-panel') });
    expect(context.workspace.get().layout).not.toEqual(shipped);

    expect(bus.execute(context, { commandId: commandId('workspace.reset') }).kind).toBe('applied');
    expect(context.workspace.get().layout).toEqual(shipped);
    expect(bus.execute(context, { commandId: commandId('workspace.reset') }).kind).toBe('refused');
  });

  it('closes the panel the user is working in', () => {
    const before = context.workspace.get().layout;
    const active = before.activePanelId;
    expect(active).toBeDefined();

    const result = bus.execute(context, { commandId: commandId('workspace.close-panel') });
    expect(result.kind).toBe('applied');

    const after = context.workspace.get().layout;
    expect(after.groups.flatMap((group) => group.panels).map((panel) => panel.id)).not.toContain(
      active,
    );
    expect(context.interaction.get().announcement?.text).toBe('The Editor panel is closed.');
  });

  it('says a panel is closed when an arrangement drops it, as the close command does', () => {
    // The docking engine closes the panel whose tab has focus when Delete or
    // Backspace is pressed on it, and that arrives as an arrangement with a
    // panel missing. A screen-reader user lost the panel in silence, while
    // the same user choosing Close this panel was told.
    const before = context.workspace.get().layout;
    const dropped = before.groups[0]?.panels[0];
    expect(dropped).toBeDefined();

    const withoutIt = {
      ...before,
      groups: before.groups
        .map((group) => ({
          ...group,
          panels: group.panels.filter((panel) => panel.id !== dropped?.id),
        }))
        .filter((group) => group.panels.length > 0)
        .map((group) => ({
          ...group,
          activePanelId: group.panels.some((panel) => panel.id === group.activePanelId)
            ? group.activePanelId
            : (group.panels[0]?.id ?? ''),
        })),
    };

    const result = bus.execute(context, {
      commandId: commandId('workspace.rearrange'),
      arguments: { arrangement: JSON.stringify(withoutIt) },
    });
    expect(result.kind).toBe('applied');
    expect(context.interaction.get().announcement?.text).toContain('panel is closed.');
  });

  it('names two panels an arrangement drops in one sentence, not two half ones', () => {
    // Each name carried its own article, so an arrangement that dropped two
    // panels said "The Assets panel, The Logs panel are closed." The route is
    // the one the command's own comment names: a macro or a replayed journal
    // supplying an arrangement with more than one panel gone.
    const before = context.workspace.get().layout;
    const emptied = before.groups.filter(
      (group) => group.region === DockRegion.Left || group.region === DockRegion.Right,
    );
    expect(emptied.length).toBe(2);

    // The side groups, so the centre the layout requires is still there.
    const without = {
      ...before,
      groups: before.groups.filter((group) => !emptied.includes(group)),
    };

    const outcome = bus.execute(context, {
      commandId: commandId('workspace.rearrange'),
      arguments: { arrangement: JSON.stringify(without) },
    });
    expect(outcome.kind).toBe('applied');

    const said = context.interaction.get().announcement?.text ?? '';
    expect(said).toMatch(/^The .+ and .+ panels are closed\.$/);
    expect(said).not.toContain(', The ');
  });

  it('says nothing when an arrangement only moves the panels', () => {
    // A resize reports many arrangements in a second, and the user is watching.
    const before = context.workspace.get().layout;
    const widened = {
      ...before,
      groups: before.groups.map((group, index) =>
        index === 0 ? { ...group, proportion: Math.min(0.9, group.proportion + 0.05) } : group,
      ),
    };

    bus.execute(context, {
      commandId: commandId('workspace.rearrange'),
      arguments: { arrangement: JSON.stringify(widened) },
    });
    expect(context.interaction.get().announcement).toBeUndefined();
  });

  it('leaves the user an active panel to work in after a close', () => {
    bus.execute(context, { commandId: commandId('workspace.close-panel') });

    const { layout } = context.workspace.get();
    const remaining = layout.groups.flatMap((group) => group.panels).map((panel) => panel.id);

    // A layout pointing at a panel that is gone is how a command that acts on
    // "this panel" starts refusing for no visible reason.
    expect(layout.activePanelId).toBeDefined();
    expect(remaining).toContain(layout.activePanelId);
  });

  it('refuses to close the last panel, because nothing would be left to work in', () => {
    // Closed one at a time until one remains, which is the path a user takes.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const panels = context.workspace.get().layout.groups.flatMap((group) => group.panels).length;
      if (panels <= 1) break;
      bus.execute(context, { commandId: commandId('workspace.close-panel') });
    }

    const { layout } = context.workspace.get();
    expect(layout.groups.flatMap((group) => group.panels)).toHaveLength(1);

    const result = bus.execute(context, { commandId: commandId('workspace.close-panel') });
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') expect(result.failures[0].summary).toContain('only panel');
  });

  it('remembers a closed panel in a workspace the user owns', () => {
    bus.execute(context, { commandId: commandId('workspace.save-as') });
    const saved = context.workspace.get().layout.id;

    bus.execute(context, { commandId: commandId('workspace.close-panel') });
    const remaining = context.workspace.get().layout.groups.flatMap((group) => group.panels).length;

    const stored = context.workspace.get().available.find((one) => one.id === saved);
    expect(stored?.groups.flatMap((group) => group.panels)).toHaveLength(remaining);
  });

  it('keeps a workspace the user saved across a reload', () => {
    // The collection was never persisted: only the mounted layout was. A saved
    // workspace was therefore absent from the list on the next load, so it
    // could not be switched to, renamed or deleted, and the next save-as
    // computed the same identifier and collided with it.
    const logger = createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('shell');
    const storage = createStateStorage(ephemeralStorage(), logger, () => undefined);

    const first = createWorkspaceStore(DESCRIPTORS, storage, logger);
    first.saveAs('Mine');

    const second = createWorkspaceStore(DESCRIPTORS, storage, logger);

    expect(second.get().available.some((one) => one.id === 'mine')).toBe(true);
  });

  it('refuses to reset a workspace the user made, and says what to do instead', () => {
    bus.execute(context, { commandId: commandId('workspace.save-as') });
    const result = bus.execute(context, { commandId: commandId('workspace.reset') });

    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') expect(result.failures[0].summary).toContain('Delete');
  });
});

describe('the default shortcut profile', () => {
  const CONVENTIONS = [
    KeyboardConvention.Windows,
    KeyboardConvention.Apple,
    KeyboardConvention.Linux,
  ] as const;

  for (const convention of CONVENTIONS) {
    for (const [layoutName, layout] of NAMED_LAYOUTS) {
      it(`binds no press the browser takes first on ${convention}, on ${layoutName}`, () => {
        // Read as the browser reads each press, by what the layout types: at US
        // positions, on Dvorak the prefix was Ctrl+T and settings Ctrl+W.
        const placement = placeDefaults(convention, layout);
        const reserved = placement.profile.bindings.flatMap((binding) =>
          binding.shortcut.presses
            .filter((press) => isReservedByPlatform(shortcut(press), convention, layout))
            .map((press) => `${binding.commandId} ${press.key}`),
        );
        expect(reserved).toEqual([]);

        // An empty profile satisfies the line above without reading anything,
        // and on Apple hardware an unread Command layer empties it entirely:
        // the chord prefix has no place, so nothing behind it has one. So an
        // empty profile has to be empty for that reason and for no other.
        if (placement.profile.bindings.length === 0) {
          expect([layoutName, [...placement.waiting.keys()]]).toEqual([layoutName, []]);
          expect(placement.waitingForCommandLayer.size).toBeGreaterThan(0);
        }
      });
    }

    describe(`on ${convention}`, () => {
      const profile = defaultShortcutProfile(convention, UNKNOWN_LAYOUT);

      it('binds no press the browser takes first, at any step of a chord', () => {
        // A shortcut that appears in the menu and then does something else
        // entirely is worse than no shortcut (REQ-UX-066). Ctrl+Shift+Equal was
        // bound to Brighten and zoomed the page instead, and two chords ended
        // on Ctrl+W, which the browser keeps from the page, and Ctrl+L, which
        // is kept for the browser's address bar, whether or not a chord has
        // started. Each press is read on its own, so this does not rest on the
        // predicate reading every press of a chord.
        const reserved = profile.bindings.flatMap((binding) =>
          binding.shortcut.presses
            .filter((press) => isReservedByPlatform(shortcut(press), convention, UNKNOWN_LAYOUT))
            .map(
              (press) =>
                `${binding.commandId} ${describeShortcut(shortcut(press), convention, UNKNOWN_LAYOUT)}`,
            ),
        );
        expect(reserved).toEqual([]);
      });

      it('has no conflicts, including a short binding shadowing a chord', () => {
        expect(findShortcutConflicts(profile)).toEqual([]);
      });

      it('binds only commands the shell actually registers', () => {
        const known = new Set(shellCommands(DESCRIPTORS).map((command) => command.id));
        for (const binding of profile.bindings) {
          expect(known.has(binding.commandId)).toBe(true);
        }
      });

      it('needs no function key, which an Apple laptop and most Chromebooks reach only with Fn', () => {
        const functionKeys = profile.bindings.filter((binding) =>
          binding.shortcut.presses.some((press) => /^F\d+$/.test(press.key)),
        );
        expect(functionKeys.map((binding) => binding.commandId)).toEqual([]);
      });

      it('is marked built-in, so it cannot be edited in place', () => {
        expect(profile.builtIn).toBe(true);
      });
    });
  }

  it('puts each default on the key that types its character on the layout', () => {
    const on = (layout: KeyboardLayout, id: string) =>
      defaultShortcutProfile(KeyboardConvention.Windows, layout)
        .bindings.find((binding) => binding.commandId === id)
        ?.shortcut.presses.map((press) => press.key);

    // Dvorak types K at V, P at R, and a comma at W.
    expect(on(DVORAK, 'view.command-palette')).toEqual(['KeyV', 'KeyR']);
    expect(on(DVORAK, 'settings.open')).toEqual(['KeyW']);
    // AZERTY types a comma at M.
    expect(on(AZERTY, 'settings.open')).toEqual(['KeyM']);
    // German swaps Y and Z, and types the theme's letters where a US layout does.
    expect(on(GERMAN, 'view.theme-dark')).toEqual(['KeyK', 'KeyD']);
    // A Russian layout types no Latin letter, and the browser goes by position.
    expect(on(RUSSIAN, 'view.command-palette')).toEqual(['KeyK', 'KeyP']);
  });

  it('puts no default on a key that types a dead key, which no press can complete', () => {
    // Brightness sat on `=`, which a German or a Swiss layout types only with
    // Shift: the key a US layout types it on is the acute accent there, so the
    // second press of the chord arrived as a dead key and the shortcut could
    // never fire, while the menus showed it.
    const placed = defaultShortcutProfile(KeyboardConvention.Windows, GERMAN);
    const keys = placed.bindings.flatMap((binding) =>
      binding.shortcut.presses.map((press) => press.key),
    );

    expect(keys).not.toContain('Equal');
    expect(
      placed.bindings.map((binding) => binding.commandId).includes(commandId('view.brighten')),
    ).toBe(true);
  });

  it('places every default on each layout the profile is read on, with none left waiting', () => {
    // Each default is written as a letter, or as the comma: a layout that types
    // Latin letters types each with no modifier, and on the Russian layout each
    // goes to its US key, where the browser reads it. A character reached only
    // with Shift is outside the model, and a default written as one would wait
    // for a key nobody can press.
    //
    // Every convention, not the one that never asks the Command layer. A
    // default may wait for that reading, and only for that: read on Windows
    // alone, no Apple wait could ever have been seen here.
    const forTheLayer: string[] = [];
    for (const convention of CONVENTIONS) {
      for (const [name, layout] of NAMED_LAYOUTS) {
        const { waiting, waitingForCommandLayer } = placeDefaults(convention, layout);
        expect([convention, name, [...waiting.keys()]]).toEqual([convention, name, []]);

        if (waitingForCommandLayer.size > 0) {
          forTheLayer.push(`${convention}, ${name}: ${String(waitingForCommandLayer.size)}`);
        }
      }
    }

    // The other wait, which only the Apple conventions can have and which no
    // key press ends. Read on Windows alone, an Apple wait could never have
    // been seen here at all. A default waits where its character sits away
    // from its US key and no Command press has shown how the system reads the
    // layout: Dvorak moves every one of them, AZERTY moves the comma, the Z of
    // undo and redo and the editor's A, German moves the Z alone, and the two
    // settled readings of Dvorak place them all.
    expect(forTheLayer).toEqual(['apple, Dvorak: 13', 'apple, AZERTY: 4', 'apple, German: 2']);
  });

  it('leaves out a default whose key is not known yet, rather than put it on another', () => {
    // Known to type T, the key at K is not where K is: the prefix there would
    // be Ctrl+T, a new tab, so every chord waits until K is found. The single
    // presses, whose keys are not known to type anything else, are placed.
    const partly = keyboardLayout([['KeyK', 't']]);
    const bound = defaultShortcutProfile(KeyboardConvention.Windows, partly).bindings.map(
      (binding) => binding.commandId,
    );

    // The editor's defaults are keys pressed alone or with the usual
    // modifier, placed without the prefix, as are its edits.
    expect(bound.filter((id) => !id.startsWith('editor.'))).toEqual([
      commandId('settings.open'),
      commandId('edit.undo'),
      commandId('edit.redo'),
      commandId('edit.delete'),
      commandId('edit.cut'),
      commandId('edit.copy'),
      commandId('edit.paste'),
    ]);
  });

  it('writes each default by what the layout types, in the menus and the palette', () => {
    expect(
      describeShortcut(
        defaultShortcutProfile(KeyboardConvention.Windows, DVORAK).bindings.find(
          (binding) => binding.commandId === commandId('view.command-palette'),
        )?.shortcut ?? shortcut(keyPress('KeyA')),
        KeyboardConvention.Windows,
        DVORAK,
      ),
    ).toBe('Ctrl+K, Ctrl+P');
  });

  it('uses Command on Apple hardware, where the shipped profile used Control', () => {
    // The platform convention. A Mac user presses Command where a Windows user
    // presses Control, so a profile binding Control everywhere is wrong on
    // Apple hardware rather than merely written down oddly.
    const apple = defaultShortcutProfile(KeyboardConvention.Apple, UNKNOWN_LAYOUT);
    const presses = apple.bindings.flatMap((binding) => binding.shortcut.presses);

    expect(presses.some((press) => press.meta)).toBe(true);
    expect(presses.some((press) => press.control)).toBe(false);
  });

  it('uses Control everywhere else', () => {
    for (const convention of [KeyboardConvention.Windows, KeyboardConvention.Linux]) {
      const presses = defaultShortcutProfile(convention, UNKNOWN_LAYOUT).bindings.flatMap(
        (binding) => binding.shortcut.presses,
      );

      expect(presses.some((press) => press.control)).toBe(true);
      expect(presses.some((press) => press.meta)).toBe(false);
    }
  });
});

describe('finding the shell commands in the palette', () => {
  const commands = shellCommands(DESCRIPTORS);

  function options(context: ShellContext) {
    return {
      context,
      profile: defaultShortcutProfile(KeyboardConvention.Windows, UNKNOWN_LAYOUT),
      convention: KeyboardConvention.Windows,
      layout: UNKNOWN_LAYOUT,
    };
  }

  it('finds the palette by its own name', () => {
    const { context } = buildShellContext();
    const results = searchCommands(commands, 'palette', options(context));
    expect(resultCommandIds(results)).toContain(commandId('view.command-palette'));
  });

  it('finds the dark theme from a word that is not in its label', () => {
    // Only the dark theme has the word, so the first result is asserted: asked
    // only whether something was found, a search that matched "night" to any
    // command at all would pass. In the light theme, where the dark theme is a
    // command that can run: in the dark theme it is unavailable, and the
    // palette ranks a command that can run first by design.
    const { context } = buildShellContext();
    context.preferences.change({ mode: ThemeMode.Light });
    const results = searchCommands(commands, 'night', options(context));
    expect(results[0]?.command.id).toBe(commandId('view.theme-dark'));
  });

  it('shows the shortcut beside a command that has one', () => {
    const { context } = buildShellContext();
    const results = searchCommands(commands, 'command palette', options(context));
    expect(results[0]?.shortcutText).toBe('Ctrl+K, Ctrl+P');
  });

  it('greys a command that would change nothing, with its reason, before it is chosen', () => {
    // Choosing "Use the dark theme" in the dark theme ran, changed nothing, and
    // was recorded as applied.
    const { context } = buildShellContext();
    const registry = createCommandRegistry<ShellContext>();
    for (const command of commands) registry.register(command);
    const bus = createCommandBus(
      registry,
      createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
    );

    expect(bus.availability(context, commandId('view.theme-dark'))).toEqual({
      available: false,
      reason: 'The dark theme is already in use.',
    });
    expect(bus.execute(context, { commandId: commandId('view.density-comfortable') }).kind).toBe(
      'refused',
    );
    bus.execute(context, { commandId: commandId('view.command-palette') });
    expect(bus.execute(context, { commandId: commandId('view.command-palette') }).kind).toBe(
      'refused',
    );
    bus.execute(context, { commandId: commandId('settings.open') });
    expect(bus.execute(context, { commandId: commandId('settings.open') }).kind).toBe('refused');
  });

  /**
   * Commands that do something every time, so a second run that changes no
   * store is still a change: each writes a file the user asked for.
   */
  const REPEATABLE: ReadonlySet<string> = new Set([
    'shortcuts.export',
    'help.export-diagnostics',
    'settings.export-unread-text',
    // Full screen is the browser's to grant, outside every store, and asked
    // for again is asked again.
    'picture.full-screen',
  ]);

  /**
   * The project system's commands, whose work settles after they return, so a
   * second run here would read the stores before the first had changed them.
   * Each is run with its work awaited, over a storage in memory, in the
   * project command tests beside this one (`project-file-commands.test.ts` and
   * the rest), which is where a project to act on is, and each is refused
   * there where it would change nothing.
   */
  const PROJECT_SYSTEM: ReadonlySet<string> = new Set(
    [
      ...projectFileCommands(),
      ...deletionCommands(),
      ...projectTransferCommands(),
      ...audioImportCommands(),
      ...quickEditCommands(),
      ...backupCommands(),
      ...backupFolderCommands(),
      ...historyCommands(),
      ...comparisonCommands(),
      ...auditionCommands(),
      ...compactionCommands(),
      ...ownershipCommands(),
      ...storageCommands(),
      ...sourceCommands(),
      ...markerCommands(),
      ...markerNudgeCommands(),
      ...editCommands(),
      ...channelCommands(),
      ...regionCommands(),
      ...regionBoundaryCommands(),
      ...regionPropertyCommands(),
      ...splitCommands(),
      ...clipboardCommands(),
    ]
      .map((command): string => command.id)
      .filter((id) => id !== 'edit.copy' && id !== 'region.open')
      .concat('picture.mark-frame'),
  );

  /** What a command is given, as an invocation carries it. */
  type Arguments = Readonly<Record<string, string | number | boolean>>;

  /**
   * How to reach a state a command is available in, and what it is given.
   *
   * A command refused where the test starts, or one taking arguments run with
   * none, would be refused on both runs and assert nothing: the net would catch
   * only commands that take no arguments and are available at the start, and
   * one that takes an argument could record a change that did not happen
   * unseen.
   */
  interface Scenario {
    /** Which of a command's forms this is, where it takes more than one. */
    readonly form?: string;

    /** Brings about a state the command is available in. */
    readonly before?: (
      run: (id: string, args?: Arguments) => unknown,
      context: ShellContext,
    ) => void;

    /**
     * Whether that state is reached only once a Play has settled, as playback
     * is only once the session has answered it.
     */
    readonly settles?: true;

    /** The arguments the command is run with, both times, read from where the test stands. */
    readonly arguments?: (context: ShellContext) => Arguments;

    /** What storage to start from, when the state has to be read from it. */
    readonly storage?: () => ReturnType<typeof ephemeralStorage>;

    /**
     * Whether the command needs an asset of a project, whose markers it acts
     * on: the test then starts in a window whose project holds the loop,
     * marked, open in the editor.
     */
    readonly inProject?: true;
  }

  /** A first group given a new proportion, as the dock reports a dragged edge. */
  function resizedArrangement(context: ShellContext): string {
    const { groups, activePanelId } = context.workspace.get().layout;
    const [first, ...rest] = groups;
    if (first === undefined) throw new Error('the layout has no groups');
    const proportion = first.proportion === 0.5 ? 0.4 : 0.5;
    return JSON.stringify({
      groups: [{ ...first, proportion }, ...rest],
      ...(activePanelId === undefined ? {} : { activePanelId }),
    });
  }

  /** Shows the tone bursts, or `asset`, in the editor panel of the layout, and makes it the one in use. */
  function openEditor(context: ShellContext, asset = 'test:tone-bursts'): void {
    const found = context.assets.find(asset);
    if (found === undefined) throw new Error(`No asset ${asset}.`);
    context.editorViews.open('editor', found);
    context.editorViews.measured('editor', 1000, found.length);
    context.editorViews.focus('editor');
  }

  /** A scenario in an editor showing `asset`, reached then by `before`. */
  function inEditor(scenario: Scenario = {}, asset = 'test:tone-bursts'): Scenario {
    return {
      ...scenario,
      before: (run, context) => {
        openEditor(context, asset);
        scenario.before?.(run, context);
      },
    };
  }

  /** The marked loop of the project open in the editor, its marker at `index` given. */
  const onProjectMarker = (index = 0): Scenario => ({
    inProject: true,
    arguments: (context) => {
      const marker = context.assets.get().assets[0]?.markers[index];
      if (marker === undefined) throw new Error('The loop has no such marker.');
      return { marker: marker.id };
    },
  });

  /** The playhead a second into the project's loop, after its markers and its region's start. */
  const playheadAfterTheMarks: NonNullable<Scenario['before']> = (run) => {
    run('editor.set-playhead', { position: 48_000 });
  };

  /** The playhead a second into the asset, which can move either way. */
  const playheadInside = inEditor({
    before: (run) => run('editor.set-playhead', { position: 48_000 }),
  });

  /** Opens a reference picture, bound to the editor in use, as the browser would load it. */
  function openPicture(
    run: (id: string, args?: Arguments) => unknown,
    context: ShellContext,
  ): void {
    run('picture.open', { file: context.chosenFiles.offer(new File([], 'reference.webm')) });
    context.picture.element.dispatchEvent(new Event('loadeddata'));
  }

  /** Leaves a render waiting on the person's decision, as a warning makes one. */
  function awaitDecision(run: (id: string) => unknown, context: ShellContext): void {
    run('transport.render-mode-final-offline');
    context.renderStrategy.measured(2);
    run('transport.render-test-signal');
  }

  /**
   * The scenario of each command that needs one, or one per form for a command
   * that takes its arguments in more than one shape: with one scenario, only
   * the form it named would be run twice, and the others could record a change
   * that did not happen unseen.
   */
  const SCENARIOS: Readonly<Record<string, Scenario | readonly Scenario[]>> = {
    'view.theme-dark': { before: (run) => run('view.theme-light') },
    'view.set-brightness': {
      // Inside the range, so the second run meets the value itself rather
      // than one the range has clamped.
      arguments: (context) => ({
        brightness: context.preferences.get().brightness === 0.5 ? -0.5 : 0.5,
      }),
    },
    'view.density-comfortable': { before: (run) => run('view.density-compact') },
    'view.contrast-system': { before: (run) => run('view.high-contrast') },
    'view.motion-system': { before: (run) => run('view.motion-reduced') },
    'view.accent-blue': { before: (run) => run('view.accent-teal') },
    'workspace.rename': {
      before: (run) => run('workspace.save-as', { displayName: 'Mine' }),
      arguments: () => ({ displayName: 'Mine, renamed' }),
    },
    'workspace.reset': { before: (run) => run('workspace.move-panel-left') },
    'workspace.delete': { before: (run) => run('workspace.save-as', { displayName: 'Mine' }) },
    'workspace.restore': {
      before: (run) => {
        run('workspace.save-as', { displayName: 'Mine' });
        run('workspace.delete');
      },
    },
    'settings.discard-unread-text': {
      storage: () => {
        const raw = ephemeralStorage();
        raw.write('audiogubbins.workspaces.unreadable', JSON.stringify(['[{"id": "mine",']));
        return raw;
      },
      arguments: () => ({ about: 'collection' }),
    },
    'workspace.dismiss-notice': {
      storage: () => {
        const raw = ephemeralStorage();
        raw.write('audiogubbins.workspace', '{"schemaVersion": 1, "groups": [');
        return raw;
      },
    },
    'workspace.rearrange': {
      arguments: (context) => ({ arrangement: resizedArrangement(context) }),
    },
    'workspace.move-panel-centre': { before: (run) => run('workspace.move-panel-left') },

    // A nudge moves a floating group, so the panel is floated first. The
    // default placement leaves room to move each way twice.
    'workspace.nudge-panel-left': { before: (run) => run('workspace.move-panel-floating') },
    'workspace.nudge-panel-right': { before: (run) => run('workspace.move-panel-floating') },
    'workspace.nudge-panel-up': { before: (run) => run('workspace.move-panel-floating') },
    'workspace.nudge-panel-down': { before: (run) => run('workspace.move-panel-floating') },

    // A panel needs a neighbour in its group to pass. Moved to the left group
    // it joins the panel there and is last, so it can go earlier; taken
    // earlier first, it can then go later.
    'workspace.move-tab-earlier': { before: (run) => run('workspace.move-panel-left') },
    'workspace.move-tab-later': {
      before: (run) => {
        run('workspace.move-panel-left');
        run('workspace.move-tab-earlier');
      },
    },
    'view.close-command-palette': { before: (run) => run('view.command-palette') },
    'settings.close': { before: (run) => run('settings.open') },
    'shortcuts.rebind': {
      arguments: () => ({
        commandId: 'view.theme-light',
        shortcut: shortcutKey(shortcut(keyPress('KeyB', { control: true, alt: true }))),
      }),
    },
    'shortcuts.unbind': { arguments: () => ({ commandId: 'view.command-palette' }) },
    'shortcuts.reset': {
      before: (run) => run('shortcuts.unbind', { commandId: 'view.command-palette' }),
    },
    'shortcuts.switch-to': {
      before: (run) => run('shortcuts.unbind', { commandId: 'view.command-palette' }),
      arguments: () => ({ profileId: DEFAULT_PROFILE_ID }),
    },
    'shortcuts.delete': {
      before: (run) => run('shortcuts.unbind', { commandId: 'view.command-palette' }),
    },
    'shortcuts.import': {
      arguments: (context) => ({ text: context.shortcuts.exported() }),
    },
    'shortcuts.dismiss-notice': {
      storage: () => {
        const raw = ephemeralStorage();
        raw.write('audiogubbins.shortcuts', '{"schemaVersion": 1, "profiles": [');
        return raw;
      },
    },
    'help.stop-diagnostic-mode': { before: (run) => run('help.start-diagnostic-mode') },
    'help.clear-logs': {
      before: (_run, context) => {
        context.diagnostics.loggerFor('shell').warning('Something to clear.');
      },
    },
    'help.set-verbosity': [
      {
        form: 'the overall level',
        arguments: (context) => ({
          severity: context.verbosity.get().defaultSeverity === 'debug' ? 'trace' : 'debug',
        }),
      },
      {
        form: 'one subsystem',
        arguments: () => ({ category: 'commands', severity: 'error' }),
      },
      {
        form: 'one subsystem back to the overall level',
        before: (run) => run('help.set-verbosity', { category: 'commands', severity: 'error' }),
        arguments: () => ({ category: 'commands', severity: 'default' }),
      },
    ],
    'help.close-diagnostic-export': { before: (run) => run('help.open-diagnostic-export') },
    'transport.pause': { before: (run) => run('transport.play-test-signal'), settles: true },
    'transport.stop': { before: (run) => run('transport.play-test-signal'), settles: true },
    'transport.profile-balanced': { before: (run) => run('transport.profile-low-latency') },
    'transport.set-custom-profile': { arguments: () => ({ feedAheadMilliseconds: 321 }) },
    'transport.priority-interactive-first': {
      before: (run) => run('transport.priority-throughput'),
    },
    'transport.render-mode-automatic': {
      before: (run) => run('transport.render-mode-final-offline'),
    },
    // A render waits on a decision where the foreground was chosen over a
    // warning that the last render ran slower than real time.
    'transport.render-safer': { before: awaitDecision },
    'transport.render-as-chosen': { before: awaitDecision },

    'editor.open-asset': { arguments: () => ({ view: 'editor', asset: 'test:loop' }) },
    'editor.zoom-by': inEditor({ arguments: () => ({ factor: 0.5 }) }),
    'editor.zoom-to-fit': inEditor({ before: (run) => run('editor.zoom-in') }),
    'editor.zoom-to-selection': inEditor({
      before: (run) => run('editor.select-time', { start: 1000, end: 2000 }),
    }),
    'editor.zoom-to-range': inEditor({ arguments: () => ({ start: 1000, end: 2000 }) }),
    'editor.scroll': inEditor({
      before: (run) => run('editor.zoom-in'),
      arguments: () => ({ pixels: 100 }),
    }),
    'editor.scroll-back': inEditor({
      before: (run) => {
        run('editor.zoom-to-range', { start: 100_000, end: 101_000 });
      },
    }),
    'editor.scroll-forward': inEditor({ before: (run) => run('editor.zoom-in') }),
    'editor.scroll-to': inEditor({
      before: (run) => run('editor.zoom-in'),
      arguments: () => ({ position: 100_000 }),
    }),
    'editor.tool-select': inEditor({ before: (run) => run('editor.tool-hand') }),
    'editor.display-waveform': inEditor({ before: (run) => run('editor.display-stacked') }),
    'editor.toggle-channel': inEditor({ arguments: () => ({ channel: 0 }) }),
    'editor.show-all-channels': inEditor({
      before: (run) => run('editor.toggle-channel', { channel: 0 }),
    }),
    'editor.amplitude-down': inEditor({ before: (run) => run('editor.amplitude-up') }),
    'editor.time-format-clock': inEditor({ before: (run) => run('editor.time-format-samples') }),
    'editor.follow-page': inEditor({ before: (run) => run('editor.follow-off') }),
    'editor.spectral-scale-logarithmic': inEditor({
      before: (run) => run('editor.spectral-scale-linear'),
    }),
    'editor.spectral-band-audible': inEditor({
      before: (run) => run('editor.spectral-band-whole'),
    }),
    'editor.select-time': inEditor({ arguments: () => ({ start: 100, end: 200, channels: '1' }) }),
    'editor.select-marker': onProjectMarker(),
    'editor.select-region': {
      inProject: true,
      arguments: (context) => {
        const region = context.assets.get().assets[0]?.regions[0];
        if (region === undefined) throw new Error('The loop has no region.');
        return { region: region.id };
      },
    },
    'editor.select-next-marker': { inProject: true },
    'editor.select-previous-marker': { inProject: true, before: playheadAfterTheMarks },
    'editor.select-next-region': { inProject: true },
    'editor.select-previous-region': { inProject: true, before: playheadAfterTheMarks },
    'edit.copy': { inProject: true },
    'region.open': {
      inProject: true,
      arguments: (context) => {
        const region = context.assets.get().assets[0]?.regions[0];
        if (region === undefined) throw new Error('The loop has no region.');
        return { region: region.id };
      },
    },
    'editor.clear-selection': inEditor({ before: (run) => run('editor.select-all') }),
    'editor.scope-all-channels': inEditor({
      before: (run) => run('editor.select-time', { start: 100, end: 200, channels: '0' }),
    }),
    'editor.set-playhead': inEditor({ arguments: () => ({ position: 4800 }) }),
    'editor.selection-end-at-playhead': playheadInside,
    'editor.extend-selection-back': playheadInside,
    'editor.extend-selection-back-sample': playheadInside,
    'editor.playhead-back-pixel': inEditor({
      before: (run) => run('editor.set-playhead', { position: 48_000 }),
    }),
    'editor.playhead-back-sample': inEditor({
      before: (run) => run('editor.set-playhead', { position: 48_000 }),
    }),
    'editor.playhead-to-start': inEditor({
      before: (run) => run('editor.set-playhead', { position: 48_000 }),
    }),
    'transport.play': { ...inEditor(), settles: true },
    'picture.open': inEditor({
      arguments: (context) => ({
        file: context.chosenFiles.offer(new File([], 'reference.webm')),
      }),
    }),
    'picture.close': inEditor({ before: openPicture }),
    'picture.bind-to-editor': {
      before: (run, context) => {
        openPicture(run, context);
        openEditor(context, 'test:loop');
      },
    },
    'picture.frame-rate-pal': inEditor({
      before: (run, context) => {
        openPicture(run, context);
        run('picture.frame-rate-film');
      },
    }),
    'picture.align-with-playhead': inEditor({
      before: (run, context) => {
        openPicture(run, context);
        run('editor.set-playhead', { position: 4801 });
      },
    }),
  };

  /** The commands that need an editor, a picture or both, whose default scenario opens them. */
  function defaultScenario(id: string): Scenario {
    if (id.startsWith('picture.')) return inEditor({ before: openPicture });
    return id.startsWith('editor.') ? inEditor() : {};
  }

  /** Everything a command can change, as text, without the announcement it makes. */
  function everything(context: ShellContext): string {
    const { announcement: _said, ...interaction } = context.interaction.get();
    return JSON.stringify(
      {
        preferences: context.preferences.get(),
        workspace: { ...context.workspace.get(), revision: 0 },
        interaction,
        shortcuts: context.shortcuts.get(),
        verbosity: context.verbosity.get(),
        diagnosticModeActive: context.diagnostics.isDiagnosticModeActive(),
        logs: context.logs.usage().recordCount,
        audioSettings: context.audioSettings.get(),
        clipboard: context.clipboard.get().description,
        planning: context.renderStrategy.get().planning.stage,
        audio: {
          starting: context.audio.get().starting,
          transport: context.audio.get().playback?.transport,
          render: context.audio.get().render.stage,
          programme: context.playback.programme(),
        },
        editorViews: [...context.editorViews.get().views],
        selections: [...context.selections.get()],
        assets: context.assets.get().assets.map((asset) => asset.revision),
        cues: [...context.cues.get()],
        picture: context.picture.get(),
      },
      (_key, value: unknown) => (value instanceof Set ? [...value] : value),
    );
  }

  /** Each command run twice, once for each of its forms. */
  const RUNS: readonly (readonly [label: string, id: string, scenario: Scenario])[] = commands
    .map((command) => command.id)
    .filter((id) => !REPEATABLE.has(id) && !PROJECT_SYSTEM.has(id))
    .flatMap((id) => {
      const given = SCENARIOS[id] ?? defaultScenario(id);
      const forms: readonly Scenario[] = Array.isArray(given) ? given : [given];
      return forms.map(
        (scenario) =>
          [scenario.form === undefined ? id : `${id}, ${scenario.form},`, id, scenario] as const,
      );
    });

  /** A window whose project holds the loop, marked, open in its editor. */
  async function projectEditor(): Promise<ShellContext> {
    const audio = await windowWithAudio({
      markers: [
        { name: 'Attack', at: 0 },
        { name: 'Sustain', at: 4800 },
      ],
      regions: [{ name: 'Body', start: 4800, end: 240_000 }],
    });
    const { context } = audio.window;
    context.editorViews.open('editor', audio.asset());
    context.editorViews.measured('editor', 1000, audio.asset().length);
    context.editorViews.focus('editor');
    return context;
  }

  it.each(RUNS)(
    'runs %s a second time only when that changes something',
    async (_label, id, scenario) => {
      // A command that ran, changed nothing and was recorded as applied told
      // the log and the user something that did not happen. Fixed by name as
      // each is found, the next would be missed, so every command is run twice
      // here, from a state it is available in and with what it takes, and the
      // second run must change a store or be refused.
      const context =
        scenario.inProject === true
          ? await projectEditor()
          : buildShellContext(scenario.storage?.()).context;
      const registry = createCommandRegistry<ShellContext>();
      for (const command of commands) registry.register(command);
      const bus = createCommandBus(
        registry,
        createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
      );
      const run = (name: string, args?: Arguments) =>
        bus.execute(context, {
          commandId: commandId(name),
          ...(args === undefined ? {} : { arguments: args }),
        });

      scenario.before?.(run, context);
      if (scenario.settles === true) await playbackSettled(context.audio);
      const args = scenario.arguments?.(context);

      // The first run is asserted, so a scenario that fails to make the
      // command available fails here rather than passing with nothing checked.
      expect(run(id, args).kind).toBe('applied');

      // Applied a second time, it must have changed something; otherwise it
      // is refused, or says it found nothing to do.
      const before = everything(context);
      const second = run(id, args);
      expect(second.kind !== 'applied' || everything(context) !== before).toBe(true);
    },
  );

  it('offers an unavailable command with its reason rather than hiding it', () => {
    const { context } = buildShellContext();
    const results = searchCommands(commands, 'Accent colour: Blue', options(context));
    expect(results[0]?.unavailableReason).toContain('already in use');
  });
});
