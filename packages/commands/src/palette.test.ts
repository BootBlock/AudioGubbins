import { describe, expect, it } from 'vitest';

import { keyPress, UNKNOWN_LAYOUT } from '@audiogubbins/input';

import {
  AVAILABLE,
  CommandCategory,
  commandId,
  unavailable,
  type Command,
  type CommandOutcome,
} from './command.js';
import { resultCommandIds, searchCommands, type PaletteOptions } from './palette.js';
import { KeyboardConvention, shortcut, type ShortcutProfile } from './shortcut.js';

interface ShellContext {
  readonly hasSelection: boolean;
}

function command(
  id: string,
  label: string,
  extra: Partial<Pick<Command<ShellContext>, 'keywords' | 'availability'>> = {},
): Command<ShellContext> {
  return {
    id: commandId(id),
    label,
    category: CommandCategory.View,
    undoable: false,
    availability: extra.availability ?? (() => AVAILABLE),
    run: (context): CommandOutcome<ShellContext> => ({ kind: 'applied', next: context }),
    ...(extra.keywords === undefined ? {} : { keywords: extra.keywords }),
  };
}

const resetLayout = command('workspace.reset-layout', 'Reset layout');
const saveLayout = command('workspace.save-layout', 'Save layout');
const toggleTheme = command('view.toggle-theme', 'Switch between dark and light', {
  keywords: ['night', 'colour', 'appearance'],
});
const deleteSelection = command('edit.delete', 'Delete selection', {
  availability: (context) =>
    context.hasSelection ? AVAILABLE : unavailable('Nothing is selected.'),
});

const COMMANDS = [resetLayout, saveLayout, toggleTheme, deleteSelection];

const profile: ShortcutProfile = {
  id: 'default',
  displayName: 'Default',
  builtIn: true,
  bindings: [
    {
      commandId: resetLayout.id,
      shortcut: shortcut(keyPress('KeyR', { control: true, shift: true })),
    },
  ],
};

function options(
  overrides: Partial<PaletteOptions<ShellContext>> = {},
): PaletteOptions<ShellContext> {
  return {
    context: { hasSelection: true },
    profile,
    convention: KeyboardConvention.Windows,
    layout: UNKNOWN_LAYOUT,
    ...overrides,
  };
}

describe('searchCommands', () => {
  it('shows every command when the palette first opens', () => {
    expect(searchCommands(COMMANDS, '', options())).toHaveLength(COMMANDS.length);
  });

  it('treats a query of only spaces as empty', () => {
    expect(searchCommands(COMMANDS, '   ', options())).toHaveLength(COMMANDS.length);
  });

  it('ranks a label that starts with the query first', () => {
    // Then one with a word that starts with it, then one that holds it
    // anywhere: the reverse of the alphabetical order, which ranks a tie.
    const quickSave = command('file.quick-save', 'Quick save');
    const autosave = command('file.autosave-settings', 'Autosave settings');
    const results = searchCommands([autosave, quickSave, saveLayout], 'save', options());
    expect(resultCommandIds(results)).toEqual([saveLayout.id, quickSave.id, autosave.id]);
  });

  it('finds a command by a word in the middle of its label', () => {
    const results = searchCommands(COMMANDS, 'layout', options());
    expect(resultCommandIds(results)).toContain(resetLayout.id);
    expect(resultCommandIds(results)).toContain(saveLayout.id);
  });

  it('finds a command from letters typed with gaps', () => {
    const results = searchCommands(COMMANDS, 'rstlay', options());
    expect(resultCommandIds(results)).toContain(resetLayout.id);
  });

  it('finds a command by a keyword that is not in its label', () => {
    const results = searchCommands(COMMANDS, 'night', options());
    expect(resultCommandIds(results)).toContain(toggleTheme.id);
  });

  it('ignores case', () => {
    expect(resultCommandIds(searchCommands(COMMANDS, 'RESET', options()))).toContain(
      resetLayout.id,
    );
  });

  it('returns nothing when the query matches nothing', () => {
    expect(searchCommands(COMMANDS, 'zzzz', options())).toEqual([]);
  });

  it('ranks a prefix match above a scattered-letter match', () => {
    // Alphabetically, the scattered match would come first.
    const removeSilence = command('edit.remove-silence', 'Remove silence');
    const results = searchCommands([removeSilence, resetLayout], 'res', options());
    expect(resultCommandIds(results)).toEqual([resetLayout.id, removeSilence.id]);
  });

  it('puts a runnable command above one that cannot run', () => {
    const results = searchCommands([deleteSelection, resetLayout], 'e', {
      ...options(),
      context: { hasSelection: false },
    });
    expect(results[0]?.unavailableReason).toBeUndefined();
  });

  it('offers an unavailable command with the reason, rather than hiding it', () => {
    const results = searchCommands(COMMANDS, 'delete', {
      ...options(),
      context: { hasSelection: false },
    });
    expect(results[0]?.command.id).toBe(deleteSelection.id);
    expect(results[0]?.unavailableReason).toBe('Nothing is selected.');
  });

  it('hides an unavailable command when the caller asks it to', () => {
    const results = searchCommands(COMMANDS, 'delete', {
      ...options(),
      context: { hasSelection: false },
      includeUnavailable: false,
    });
    expect(results).toEqual([]);
  });

  it('shows the shortcut written for the platform', () => {
    const results = searchCommands(COMMANDS, 'reset', options());
    expect(results[0]?.shortcutText).toBe('Ctrl+Shift+R');
  });

  it('writes the same shortcut in the Apple convention on Apple hardware', () => {
    const results = searchCommands(COMMANDS, 'reset', {
      ...options(),
      convention: KeyboardConvention.Apple,
    });
    expect(results[0]?.shortcutText).toBe('⌃⇧R');
  });

  it('shows no shortcut for a command that has none', () => {
    const results = searchCommands(COMMANDS, 'save layout', options());
    expect(results[0]?.shortcutText).toBeUndefined();
  });

  it('offers no shortcut for a palette row whose binding the browser takes', () => {
    // A binding made on another keyboard is kept rather than dropped. Offered
    // here as a shortcut, it taught a press that closes the browser tab.
    const takenByTheBrowser: ShortcutProfile = {
      ...profile,
      bindings: [
        { commandId: resetLayout.id, shortcut: shortcut(keyPress('KeyW', { control: true })) },
      ],
    };

    const results = searchCommands(COMMANDS, 'reset', options({ profile: takenByTheBrowser }));
    expect(results[0]?.shortcutText).toBeUndefined();
  });

  it('reports which letters matched, so the interface can highlight them', () => {
    const results = searchCommands([resetLayout], 'reset', options());
    expect(results[0]?.matchedLabelIndices).toEqual([0, 1, 2, 3, 4]);
  });

  it('highlights nothing when the match came from a keyword', () => {
    const results = searchCommands([toggleTheme], 'night', options());
    expect(results[0]?.matchedLabelIndices).toEqual([]);
  });

  it('honours the result limit', () => {
    expect(searchCommands(COMMANDS, '', { ...options(), limit: 2 })).toHaveLength(2);
  });

  it('orders equally scoring results alphabetically, never by registration order', () => {
    const forwards = searchCommands([resetLayout, saveLayout], 'layout', options());
    const backwards = searchCommands([saveLayout, resetLayout], 'layout', options());
    expect(resultCommandIds(forwards)).toEqual([resetLayout.id, saveLayout.id]);
    expect(resultCommandIds(backwards)).toEqual([resetLayout.id, saveLayout.id]);
  });

  it('returns the same results for the same input, however often it is called', () => {
    const first = searchCommands(COMMANDS, 'la', options());
    const second = searchCommands(COMMANDS, 'la', options());
    expect(resultCommandIds(first)).toEqual(resultCommandIds(second));
  });
});
