import { beforeEach, describe, expect, it } from 'vitest';

import { keyPress } from '@audiogubbins/input';

import { commandId } from './command.js';
import { createChordTracker, type ChordTracker } from './chord-tracker.js';
import { shortcut, type ShortcutProfile } from './shortcut.js';

const save = commandId('file.save');
const palette = commandId('view.command-palette');
const splitRight = commandId('workspace.split-right');

const ctrlK = keyPress('KeyK', { control: true });
const ctrlS = keyPress('KeyS', { control: true });
const ctrlP = keyPress('KeyP', { control: true });
const ctrlBackslash = keyPress('Backslash', { control: true });
const plainA = keyPress('KeyA');

const profile: ShortcutProfile = {
  id: 'default',
  displayName: 'Default',
  builtIn: true,
  bindings: [
    { commandId: save, shortcut: shortcut(ctrlS) },
    { commandId: palette, shortcut: shortcut(ctrlK, ctrlP) },
    { commandId: splitRight, shortcut: shortcut(ctrlK, ctrlBackslash) },
  ],
};

describe('createChordTracker', () => {
  let tracker: ChordTracker;

  beforeEach(() => {
    tracker = createChordTracker(() => profile);
  });

  it('runs a single-press shortcut immediately', () => {
    const outcome = tracker.press(ctrlS);

    expect(outcome.kind).toBe('run');
    if (outcome.kind === 'run') expect(outcome.commandId).toBe(save);
  });

  it('lets an unbound key through, so typing still works', () => {
    expect(tracker.press(plainA).kind).toBe('pass-through');
  });

  it('waits after the first press of a chord', () => {
    const outcome = tracker.press(ctrlK);

    expect(outcome.kind).toBe('waiting');
    expect(tracker.pending()).toEqual([ctrlK]);
  });

  it('runs the chord when it completes', () => {
    tracker.press(ctrlK);
    const outcome = tracker.press(ctrlP);

    expect(outcome.kind).toBe('run');
    if (outcome.kind === 'run') {
      expect(outcome.commandId).toBe(palette);
      expect(outcome.presses).toEqual([ctrlK, ctrlP]);
    }
  });

  it('chooses between chords that share a prefix', () => {
    tracker.press(ctrlK);
    const outcome = tracker.press(ctrlBackslash);

    expect(outcome.kind).toBe('run');
    if (outcome.kind === 'run') expect(outcome.commandId).toBe(splitRight);
  });

  it('forgets the chord once it has run', () => {
    tracker.press(ctrlK);
    tracker.press(ctrlP);

    expect(tracker.pending()).toEqual([]);
    expect(tracker.press(ctrlP).kind).toBe('pass-through');
  });

  it('abandons a chord that cannot complete, and consumes the key', () => {
    tracker.press(ctrlK);
    const outcome = tracker.press(plainA);

    // Consumed rather than passed through: the user was mid-chord, so the press
    // was aimed at the chord, not at whatever has focus.
    expect(outcome.kind).toBe('abandoned');
    if (outcome.kind === 'abandoned') expect(outcome.presses).toEqual([ctrlK, plainA]);
    expect(tracker.pending()).toEqual([]);
  });

  it('is ready for an ordinary shortcut after abandoning a chord', () => {
    tracker.press(ctrlK);
    tracker.press(plainA);

    expect(tracker.press(ctrlS).kind).toBe('run');
  });

  it('forgets a half-typed chord when it is reset', () => {
    tracker.press(ctrlK);
    tracker.reset();

    expect(tracker.pending()).toEqual([]);
    // Without the reset this press would have completed the palette chord that
    // the user has long since forgotten starting.
    expect(tracker.press(ctrlP).kind).toBe('pass-through');
  });

  it('resets harmlessly when no chord is in progress', () => {
    expect(() => {
      tracker.reset();
    }).not.toThrow();
    expect(tracker.press(ctrlS).kind).toBe('run');
  });

  it('follows a profile that changes between presses', () => {
    let current = profile;
    const following = createChordTracker(() => current);

    expect(following.press(ctrlS).kind).toBe('run');

    current = { ...profile, bindings: [] };
    expect(following.press(ctrlS).kind).toBe('pass-through');
  });

  it('reports the presses of a single-key shortcut too', () => {
    const outcome = tracker.press(ctrlS);
    expect(outcome.kind).toBe('run');
    if (outcome.kind === 'run') expect(outcome.presses).toEqual([ctrlS]);
  });

  it('lets a chord prefix through when the profile has no chords', () => {
    const noChords = createChordTracker(() => ({
      ...profile,
      bindings: [{ commandId: save, shortcut: shortcut(ctrlS) }],
    }));

    expect(noChords.press(ctrlK).kind).toBe('pass-through');
  });
});
