/**
 * How a view's spectral tools draw, set through its commands (ADR-0082): the
 * brush's radius and hardness taken to their control's steps and moved a step
 * at a time, and the marquee's and lasso's softness given in milliseconds and
 * hertz, both or neither, kept in the view as samples and hertz.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandInvocation,
  type ExecutionResult,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { SPECTRAL_TOOL_RANGES, type SpectralToolSettings } from '@audiogubbins/editor-view';
import { SpectralCombination } from '@audiogubbins/timeline';

import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import type { ShellContext } from './shell-context.js';
import { shellCommands } from './shell-commands.js';

const ASSET = 'test:tone-bursts';

let context: ShellContext;
let bus: CommandBus<ShellContext>;

function run(id: string, args?: NonNullable<CommandInvocation['arguments']>) {
  return bus.execute(context, {
    commandId: commandId(id),
    ...(args === undefined ? {} : { arguments: args }),
  });
}

function refusal(result: ExecutionResult<ShellContext>): string | undefined {
  return result.kind === 'refused' ? result.failures[0].summary : undefined;
}

function tools(): SpectralToolSettings | undefined {
  return context.editorViews.entry('editor')?.state.spectralTools;
}

beforeEach(() => {
  context = buildShellContext().context;
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
  const found = context.assets.find(ASSET);
  if (found === undefined) throw new Error(`No asset ${ASSET}.`);
  context.editorViews.open('editor', found);
  context.editorViews.measured('editor', { width: 1000, height: 300 }, found.length);
  context.editorViews.focus('editor');
});

describe('the spectral brush', () => {
  it('takes the radius it is set to to a whole pixel within its control', () => {
    run('editor.set-brush-radius', { pixels: 30.4 });
    expect(tools()?.brushRadius).toBe(30);
    run('editor.set-brush-radius', { pixels: 5_000 });
    expect(tools()?.brushRadius).toBe(SPECTRAL_TOOL_RANGES.brushRadius.maximum);
    expect(context.interaction.get().announcement?.text).toBe(
      'The brush is 96 pixels in radius, 50% hard.',
    );
  });

  it('grows and shrinks a step at a time, and says so at either end', () => {
    run('editor.set-brush-radius', { pixels: 20 });
    run('editor.larger-brush');
    expect(tools()?.brushRadius).toBe(22);
    run('editor.set-brush-radius', { pixels: SPECTRAL_TOOL_RANGES.brushRadius.minimum });
    expect(refusal(run('editor.smaller-brush'))).toBe('The brush is already at its smallest.');
  });

  it('takes the hardness to its control’s steps, below full', () => {
    run('editor.set-brush-hardness', { hardness: 0.333 });
    expect(tools()?.hardness).toBe(0.35);
    run('editor.set-brush-hardness', { hardness: 1 });
    expect(tools()?.hardness).toBe(SPECTRAL_TOOL_RANGES.hardness.maximum);
    expect(refusal(run('editor.harder-brush'))).toBe('The brush is already at its hardest.');
    run('editor.softer-brush');
    expect(tools()?.hardness).toBe(0.9);
  });
});

describe('the softness of the marquee and the lasso', () => {
  it('is kept in the view’s samples and hertz', () => {
    const rate = context.assets.find(ASSET)?.sampleRate ?? 0;
    run('editor.set-spectral-softness', { milliseconds: 10, hertz: 50 });
    expect(tools()?.feather).toEqual({ time: rate / 100, frequency: 50 });
    run('editor.hard-spectral-edges');
    expect(tools()?.feather).toEqual({ time: 0, frequency: 0 });
  });

  it('is refused in one part alone, as a mask’s feather is none or both', () => {
    expect(refusal(run('editor.set-spectral-softness', { milliseconds: 10, hertz: 0 }))).toBe(
      'A softness fades out in both time and frequency, or in neither. Give both, or neither.',
    );
    expect(run('editor.set-spectral-softness', { milliseconds: -1, hertz: 50 }).kind).toBe(
      'refused',
    );
    expect(tools()?.feather).toEqual({ time: 0, frequency: 0 });
  });
});

describe('the combination mode', () => {
  it('sets how a shape drawn with no modifier joins the selection, and says so', () => {
    expect(tools()?.combination).toBe(SpectralCombination.Replace);
    for (const [id, combination, said] of [
      [
        'editor.spectral-combination-add',
        SpectralCombination.Add,
        'A spectral tool’s shape adds to the spectral selection.',
      ],
      [
        'editor.spectral-combination-subtract',
        SpectralCombination.Subtract,
        'A spectral tool’s shape takes from the spectral selection.',
      ],
      [
        'editor.spectral-combination-replace',
        SpectralCombination.Replace,
        'A spectral tool’s shape replaces the spectral selection.',
      ],
    ] as const) {
      expect(run(id).kind).toBe('applied');
      expect(tools()?.combination).toBe(combination);
      expect(context.interaction.get().announcement?.text).toBe(said);
    }
  });

  it('says a mode already in use is so, rather than doing nothing quietly', () => {
    run('editor.spectral-combination-add');
    expect(run('editor.spectral-combination-add')).toMatchObject({
      kind: 'unchanged',
      reason: 'The view is already so.',
    });
  });
});
