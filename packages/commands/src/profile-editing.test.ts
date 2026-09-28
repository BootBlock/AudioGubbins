import { describe, expect, it } from 'vitest';

import { keyPress, UNKNOWN_LAYOUT } from '@audiogubbins/input';

import { commandId } from './command.js';
import { duplicateProfile, rebind, unbind } from './profile-editing.js';
import {
  KeyboardConvention,
  commandForShortcut,
  shortcut,
  type ShortcutProfile,
} from './shortcut.js';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

const save = commandId('file.save');
const open = commandId('file.open');

function profile(bindings: ShortcutProfile['bindings'], builtIn = false): ShortcutProfile {
  return { id: 'test', displayName: 'Test profile', builtIn, bindings };
}

describe('rebind and unbind', () => {
  // Another command's binding beside the one edited, which every edit keeps.
  const saveBinding = { commandId: save, shortcut: shortcut(keyPress('KeyS', { control: true })) };
  const openBinding = { commandId: open, shortcut: shortcut(keyPress('KeyO', { control: true })) };
  const editable = profile([saveBinding, openBinding]);

  it('replaces the command former binding rather than adding to it', () => {
    const next = expectSuccess(
      rebind(editable, save, shortcut(keyPress('F2')), KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    );
    expect(next.bindings).toEqual([
      openBinding,
      { commandId: save, shortcut: shortcut(keyPress('F2')) },
    ]);
    expect(commandForShortcut(next, shortcut(keyPress('KeyS', { control: true })))).toBeUndefined();
  });

  it('leaves the original profile untouched', () => {
    expectSuccess(
      rebind(editable, save, shortcut(keyPress('F2')), KeyboardConvention.Windows, UNKNOWN_LAYOUT),
    );
    expectSuccess(unbind(editable, save));
    expect(editable.bindings).toEqual([
      { commandId: save, shortcut: shortcut(keyPress('KeyS', { control: true })) },
      { commandId: open, shortcut: shortcut(keyPress('KeyO', { control: true })) },
    ]);
  });

  it('refuses a shortcut the browser takes first', () => {
    expect(
      expectFailureCode(
        rebind(
          editable,
          save,
          shortcut(keyPress('KeyW', { control: true })),
          KeyboardConvention.Windows,
          UNKNOWN_LAYOUT,
        ),
      ),
    ).toBe('shortcut.reserved-by-platform');
  });

  it('refuses a chord whose second press the browser takes', () => {
    expect(
      expectFailureCode(
        rebind(
          editable,
          save,
          shortcut(keyPress('KeyK', { meta: true }), keyPress('KeyL', { meta: true })),
          KeyboardConvention.Apple,
          UNKNOWN_LAYOUT,
        ),
      ),
    ).toBe('shortcut.reserved-by-platform');
  });

  it('refuses to change a built-in profile', () => {
    const builtIn = profile(editable.bindings, true);
    expect(
      expectFailureCode(
        rebind(builtIn, save, shortcut(keyPress('F2')), KeyboardConvention.Windows, UNKNOWN_LAYOUT),
      ),
    ).toBe('shortcut.built-in-profile-is-read-only');
    expect(expectFailureCode(unbind(builtIn, save))).toBe('shortcut.built-in-profile-is-read-only');
  });

  it('removes every binding for a command', () => {
    const next = expectSuccess(unbind(editable, save));
    expect(next.bindings).toEqual([openBinding]);
  });
});

describe('duplicateProfile', () => {
  const builtIn = profile(
    [{ commandId: save, shortcut: shortcut(keyPress('KeyS', { control: true })) }],
    true,
  );

  it('produces an editable copy of a built-in profile', () => {
    const copy = expectSuccess(duplicateProfile(builtIn, [builtIn], 'My shortcuts'));
    expect(copy.builtIn).toBe(false);
    expect(copy.displayName).toBe('My shortcuts');
    expect(copy.bindings).toEqual(builtIn.bindings);
  });

  it('refuses to make a copy under a name the copy could not be read back with', () => {
    // The maker accepted any name and the reader beside it refused one past
    // the bound, so the package could write what it could not read.
    expect(expectFailureCode(duplicateProfile(builtIn, [builtIn], 'a'.repeat(121)))).toBe(
      'shortcut-profile.name-too-long',
    );
    expect(expectFailureCode(duplicateProfile(builtIn, [builtIn], '   '))).toBe(
      'shortcut-profile.has-no-name',
    );
    expect(expectSuccess(duplicateProfile(builtIn, [builtIn], 'a'.repeat(120))).displayName).toBe(
      'a'.repeat(120),
    );
  });
});
