import { describe, expect, it, vi } from 'vitest';

import {
  AVAILABLE,
  CommandCategory,
  commandId,
  createCommandBus,
  createCommandRegistry,
  refusal,
  unchanged,
  type Command,
  type RefusedOutcome,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { executeVoiced } from './voiced-execution.js';

/**
 * The one place a refusal is said, so the shell and the shortcut listener share
 * it rather than each keeping a copy of its own that reads only the first
 * failure.
 */

/** A command that answers with whatever outcome a test gives it. */
function answering(id: string, outcome: ReturnType<Command<null>['run']>): Command<null> {
  return {
    id: commandId(id),
    label: id,
    category: CommandCategory.View,
    undoable: false,
    availability: () => AVAILABLE,
    run: () => outcome,
  };
}

/**
 * A refusal with two reasons, built from two single ones: the application
 * does not depend on the domain package that builds a failure.
 */
function twoFailures(): RefusedOutcome {
  const [first] = refusal('test.first', 'The name is empty.').failures;
  const [second] = refusal('test.second', 'The colour is not one this build has.').failures;
  return { kind: 'refused', failures: [first, second] };
}

/**
 * A refusal with as many reasons as asked for, each naming its number.
 *
 * Built from the first and the rest, so the list is non-empty by
 * construction: the type says a refusal has at least one reason, and a list
 * built by `Array.from` cannot tell the checker that.
 */
function manyFailures(count: number): RefusedOutcome {
  const reason = (index: number) =>
    refusal(`test.reason-${String(index)}`, `Reason ${String(index)}.`).failures[0];
  const rest = Array.from({ length: count - 1 }, (_, index) => reason(index + 1));
  return { kind: 'refused', failures: [reason(0), ...rest] };
}

function busWith(...commands: readonly Command<null>[]) {
  const registry = createCommandRegistry<null>();
  for (const command of commands) registry.register(command);
  return createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
}

describe('executeVoiced', () => {
  it('says every reason a refusal gives, not only the first', () => {
    const bus = busWith(answering('test.twice-wrong', twoFailures()));
    const announce = vi.fn();

    const result = executeVoiced(bus, null, { commandId: commandId('test.twice-wrong') }, announce);

    expect(result.kind).toBe('refused');
    expect(announce).toHaveBeenCalledExactlyOnceWith(
      'The name is empty. The colour is not one this build has.',
      true,
      { refusal: true },
    );
  });

  it('says the first reasons of a refusal and how many more there are', () => {
    // An imported profile reports every malformed binding at once rather than
    // the first, which is right for the reader of a file and wrong for a
    // sentence: a file of two hundred thousand bad entries was two hundred
    // thousand sentences in one announcement, with no way to interrupt it.
    const bus = busWith(answering('test.many-wrong', manyFailures(9)));
    const announce = vi.fn();

    executeVoiced(bus, null, { commandId: commandId('test.many-wrong') }, announce);

    expect(announce).toHaveBeenCalledExactlyOnceWith(
      'Reason 0. Reason 1. Reason 2. There are 6 more reasons.',
      true,
      { refusal: true },
    );
  });

  it('cuts a long reason at the last word that fits, so no half word is read out', () => {
    // A refusal reaches an assertive region and a visible notice, so what is
    // cut is read out. An imported profile's version field, a quarter of a
    // megabyte of it, was interpolated whole into the first reason; bounded at
    // the two-hundredth character, the reason ended part-way through a word.
    // The word the bound falls inside is what this is about, so the fixture
    // puts one there: cut at the two-hundredth character, the reason would end
    // part-way through the eighteenth word.
    const long = `The version ${'abcdefghij '.repeat(18)}is not one this build knows.`;
    const bus = busWith(answering('test.long-reason', refusal('test.long', long)));
    const announce = vi.fn();

    executeVoiced(bus, null, { commandId: commandId('test.long-reason') }, announce);

    const said = String(announce.mock.calls[0]?.[0]);
    expect(said.length).toBeLessThanOrEqual(201);
    expect(said.endsWith('…')).toBe(true);
    // Every word said is a whole word of the reason, and the ellipsis follows
    // a word rather than the space after one.
    expect(said).not.toMatch(/\s…$/u);
    expect(long.startsWith(said.slice(0, -1))).toBe(true);
    expect(long.charAt(said.length - 1)).toBe(' ');
  });

  it('says one more reason in the singular, so the sentence reads', () => {
    const bus = busWith(answering('test.four-wrong', manyFailures(4)));
    const announce = vi.fn();

    executeVoiced(bus, null, { commandId: commandId('test.four-wrong') }, announce);

    expect(announce).toHaveBeenCalledExactlyOnceWith(
      'Reason 0. Reason 1. Reason 2. There is 1 more reason.',
      true,
      { refusal: true },
    );
  });

  it('says the reason the bus refuses with, for a command it does not know', () => {
    const announce = vi.fn();

    executeVoiced(busWith(), null, { commandId: commandId('test.missing') }, announce);

    expect(announce).toHaveBeenCalledExactlyOnceWith('There is no command "test.missing".', true, {
      refusal: true,
    });
  });

  it('says an unavailable command politely, because what it asks for holds already', () => {
    // Every refusal interrupted whatever a screen reader was saying, and a
    // chord pressed on a workspace with nothing to reset did so to say that.
    const bus = busWith({
      ...answering('test.already', { kind: 'applied', next: null }),
      availability: () => ({ available: false, reason: 'It is already so.' }),
    });
    const announce = vi.fn();

    executeVoiced(bus, null, { commandId: commandId('test.already') }, announce);

    // And shown as long as any refusal: politely spoken, it was gone in five
    // seconds, and its reason takes as long to read.
    expect(announce).toHaveBeenCalledExactlyOnceWith('It is already so.', false, {
      refusal: true,
    });
  });

  it('says nothing when the command found nothing to do, which its control shows', () => {
    const bus = busWith(
      answering(
        'test.same',
        unchanged('view.brightness-already-set', 'The brightness is already 50.'),
      ),
    );
    const announce = vi.fn();

    const result = executeVoiced(bus, null, { commandId: commandId('test.same') }, announce);

    expect(result.kind).toBe('unchanged');
    expect(announce).not.toHaveBeenCalled();
  });

  it('says, politely, what a command found when asked to, as a Save or a Rename asks', () => {
    // Recording a command's own shortcut and saving it closed the recorder in
    // silence.
    const bus = busWith(
      answering(
        'test.same',
        unchanged('shortcuts.already-bound', 'Ctrl+B is already its shortcut.'),
      ),
    );
    const announce = vi.fn();

    executeVoiced(bus, null, { commandId: commandId('test.same') }, announce, {
      sayWhenUnchanged: true,
    });

    expect(announce).toHaveBeenCalledExactlyOnceWith('Ctrl+B is already its shortcut.', false);
  });

  it('says nothing when the command did what it was asked', () => {
    const bus = busWith(answering('test.fine', { kind: 'applied', next: null }));
    const announce = vi.fn();

    const result = executeVoiced(bus, null, { commandId: commandId('test.fine') }, announce);

    expect(result.kind).toBe('applied');
    expect(announce).not.toHaveBeenCalled();
  });
});
