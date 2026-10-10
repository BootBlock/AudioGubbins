/**
 * A spectral tool's shape joining the spectral selection through its command
 * (ADR-0082): the shape replacing the selection, adding to it or taking from
 * it, as the editor view's preview of the drag showed; and a shape that is no
 * mask, or that would leave a selection no mask may be, refused with a reason
 * and the selection left as it was.
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
import {
  MAXIMUM_MASK_SHAPES,
  MaskEffect,
  NO_FEATHER,
  type SpectralFeather,
  type SpectralShape,
} from '@audiogubbins/domain';
import { withDrawnShape } from '@audiogubbins/editor-view';
import { SelectionFacet, SpectralCombination, activeFacet } from '@audiogubbins/timeline';

import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import type { ShellContext } from './shell-context.js';
import { shellCommands } from './shell-commands.js';

type Arguments = NonNullable<CommandInvocation['arguments']>;

const ASSET = 'test:tone-bursts';

let context: ShellContext;
let bus: CommandBus<ShellContext>;

function run(id: string, args?: Arguments): ExecutionResult<ShellContext> {
  return bus.execute(context, {
    commandId: commandId(id),
    ...(args === undefined ? {} : { arguments: args }),
  });
}

function refusal(result: ExecutionResult<ShellContext>): string | undefined {
  return result.kind === 'refused' ? result.failures[0].summary : undefined;
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
  context.editorViews.measured('editor', 1000, found.length);
  context.editorViews.focus('editor');
});

function rectangle(start: number, end: number, low: number, high: number): SpectralShape {
  // Positions are written as numbers, as a command's argument carries them.
  return JSON.parse(
    JSON.stringify({
      kind: 'rectangle',
      effect: MaskEffect.Add,
      range: { start, end },
      band: { low, high },
    }),
  ) as SpectralShape;
}

/** What a spectral tool's intent runs the command with. */
function drawn(
  shape: SpectralShape,
  combination: SpectralCombination,
  channels?: string,
  feather: SpectralFeather = NO_FEATHER,
): Arguments {
  return {
    view: 'editor',
    mask: JSON.stringify({ shapes: [shape], feather }),
    combination,
    ...(channels === undefined ? {} : { channels }),
  };
}

function selection() {
  return context.selections.of(ASSET);
}

describe('selecting a spectral area', () => {
  it('replaces the spectral selection with the shape, scoped to the channel it was drawn in', () => {
    const shape = rectangle(1_000, 2_000, 100, 400);
    expect(run('editor.select-spectral', drawn(shape, SpectralCombination.Replace, '1')).kind).toBe(
      'applied',
    );
    expect(selection().spectral).toEqual({ shapes: [shape], feather: NO_FEATHER });
    expect(selection().channels).toEqual([1]);
    expect(activeFacet(selection())).toBe(SelectionFacet.Spectral);
  });

  it('adds with Shift and takes away with Alt, as the drag’s preview showed', () => {
    const first = rectangle(1_000, 2_000, 100, 400);
    const second = rectangle(1_500, 3_000, 200, 800);
    run('editor.select-spectral', drawn(first, SpectralCombination.Replace));
    const before = selection();
    run('editor.select-spectral', drawn(second, SpectralCombination.Add));
    const previewed = withDrawnShape(
      before,
      {
        shape: second,
        combination: SpectralCombination.Add,
        feather: NO_FEATHER,
        channels: undefined,
      },
      2,
    );
    expect(selection().spectral).toEqual(previewed.spectral);
    run(
      'editor.select-spectral',
      drawn(rectangle(1_200, 1_400, 150, 300), SpectralCombination.Subtract),
    );
    expect(selection().spectral?.shapes.map((shape) => shape.effect)).toEqual([
      MaskEffect.Add,
      MaskEffect.Add,
      MaskEffect.Subtract,
    ]);
  });

  it('keeps the channel scope where a shape joins the selection', () => {
    run(
      'editor.select-spectral',
      drawn(rectangle(1_000, 2_000, 100, 400), SpectralCombination.Replace, '0'),
    );
    run(
      'editor.select-spectral',
      drawn(rectangle(3_000, 4_000, 100, 400), SpectralCombination.Add, '1'),
    );
    expect(selection().channels).toEqual([0]);
  });

  it('refuses to take a shape from no spectral selection, leaving the selection as it was', () => {
    const result = run(
      'editor.select-spectral',
      drawn(rectangle(1_000, 2_000, 100, 400), SpectralCombination.Subtract),
    );
    expect(refusal(result)).toBe('Nothing is selected to take that shape from.');
    expect(selection().spectral).toBeUndefined();
  });

  it('refuses a mask it cannot read, or one of more than one shape, with a reason', () => {
    expect(
      refusal(
        run('editor.select-spectral', {
          view: 'editor',
          mask: '{"shapes": [',
          combination: 'replace',
        }),
      ),
    ).toBe('A spectral shape needs a mask to join to the selection.');
    expect(
      refusal(
        run('editor.select-spectral', {
          view: 'editor',
          mask: JSON.stringify({ shapes: [{ kind: 'circle' }], feather: NO_FEATHER }),
          combination: 'replace',
        }),
      ),
    ).toBe('A spectral shape needs a mask to join to the selection.');
    const shape = rectangle(1_000, 2_000, 100, 400);
    expect(
      refusal(
        run('editor.select-spectral', {
          view: 'editor',
          mask: JSON.stringify({ shapes: [shape, shape], feather: NO_FEATHER }),
          combination: 'replace',
        }),
      ),
    ).toBe('A spectral tool draws one shape at a time.');
    expect(selection().spectral).toBeUndefined();
  });

  it('refuses a shape no selection may hold, and a joining it does not name', () => {
    const length = context.assets.find(ASSET)?.length ?? 0;
    expect(
      refusal(
        run(
          'editor.select-spectral',
          drawn(rectangle(1_000, length + 10, 100, 400), SpectralCombination.Replace),
        ),
      ),
    ).toBe('A rectangle of the selection covers no audio.');
    expect(
      refusal(
        run('editor.select-spectral', {
          ...drawn(rectangle(1_000, 2_000, 100, 400), SpectralCombination.Replace),
          combination: 'intersect',
        }),
      ),
    ).toBe('A spectral shape replaces the selection, adds to it or takes from it.');
  });

  it('refuses a shape that would leave more shapes than a selection may hold', () => {
    const shape = rectangle(1_000, 2_000, 100, 400);
    run('editor.select-spectral', drawn(shape, SpectralCombination.Replace));
    for (let added = 1; added < MAXIMUM_MASK_SHAPES; added += 1) {
      run('editor.select-spectral', drawn(shape, SpectralCombination.Add));
    }
    expect(selection().spectral?.shapes).toHaveLength(MAXIMUM_MASK_SHAPES);
    expect(refusal(run('editor.select-spectral', drawn(shape, SpectralCombination.Add)))).toBe(
      'The selection has too many shapes.',
    );
  });
});
