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
  type CommandRegistry,
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
import { SPECTRAL_TIME_STEP_PIXELS, withDrawnShape } from '@audiogubbins/editor-view';
import {
  SelectionFacet,
  SpectralCombination,
  activeFacet,
  samplesWithin,
} from '@audiogubbins/timeline';

import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import type { ShellContext } from './shell-context.js';
import { shellCommands } from './shell-commands.js';

type Arguments = NonNullable<CommandInvocation['arguments']>;

const ASSET = 'test:tone-bursts';

let context: ShellContext;
let bus: CommandBus<ShellContext>;
let registry: CommandRegistry<ShellContext>;

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
  registry = createCommandRegistry<ShellContext>();
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

describe('the spectral selection from the keyboard (REQ-UX-005)', () => {
  /** The asset's rate, which gives the highest frequency it holds. */
  const rate = () => context.assets.find(ASSET)?.sampleRate ?? 0;

  it('selects a band of the time selection, the band the spectrogram shows where none is named', () => {
    expect(refusal(run('editor.select-spectral-band'))).toBe(
      'Select a time range first, then a band of it.',
    );
    run('editor.select-time', { start: 1_000, end: 2_000, channels: '1' });
    expect(run('editor.select-spectral-band').kind).toBe('applied');
    const { spectral } = context.editorViews.entry('editor')?.state ?? {};
    expect(selection().spectral).toEqual({
      shapes: [rectangle(1_000, 2_000, spectral?.lowest ?? 0, spectral?.highest ?? 0)],
      feather: NO_FEATHER,
    });
    expect(selection().channels).toEqual([1]);
    expect(activeFacet(selection())).toBe(SelectionFacet.Spectral);
  });

  it('selects the band named, softened as the view’s marquee is', () => {
    context.editorViews.change('editor', (state) => ({
      ...state,
      spectralTools: { ...state.spectralTools, feather: { time: 48, frequency: 20 } },
    }));
    run('editor.select-time', { start: 1_000, end: 2_000 });
    run('editor.select-spectral-band', { low: 300, high: 3_000 });
    expect(selection().spectral).toEqual({
      shapes: [rectangle(1_000, 2_000, 300, 3_000)],
      feather: { time: 48, frequency: 20 },
    });
  });

  it('adds a band of the time selection to the area, and takes one from it, as a pointer joins a shape', () => {
    run('editor.select-time', { start: 1_000, end: 2_000 });
    run('editor.select-spectral-band', { low: 100, high: 400 });
    run('editor.select-time', { start: 3_000, end: 4_000 });
    expect(run('editor.add-spectral-band', { low: 200, high: 800 }).kind).toBe('applied');
    expect(run('editor.subtract-spectral-band', { low: 300, high: 500 }).kind).toBe('applied');
    expect(selection().spectral?.shapes).toEqual([
      rectangle(1_000, 2_000, 100, 400),
      rectangle(3_000, 4_000, 200, 800),
      { ...rectangle(3_000, 4_000, 300, 500), effect: MaskEffect.Subtract },
    ]);
    expect(activeFacet(selection())).toBe(SelectionFacet.Spectral);
  });

  it('adds the first band where nothing is selected, and refuses to take one from nothing', () => {
    run('editor.select-time', { start: 1_000, end: 2_000 });
    expect(refusal(run('editor.subtract-spectral-band', { low: 300, high: 500 }))).toBe(
      'No area of time and frequency is selected to take a band from.',
    );
    expect(selection().spectral).toBeUndefined();
    run('editor.add-spectral-band', { low: 300, high: 500 });
    expect(selection().spectral?.shapes).toEqual([rectangle(1_000, 2_000, 300, 500)]);
  });

  it('offers each way of joining a band in the palette, where a person finds it', () => {
    for (const id of [
      'editor.select-spectral-band',
      'editor.add-spectral-band',
      'editor.subtract-spectral-band',
    ]) {
      const command = registry.get(commandId(id));
      expect(command).toBeDefined();
      expect(command?.discoverable).not.toBe(false);
    }
  });

  it('refuses a band that is no band, or one above what the audio holds', () => {
    run('editor.select-time', { start: 1_000, end: 2_000 });
    const reason = `A band is a low frequency below a high one, from nothing to ${String(rate() / 2000)} kHz.`;
    expect(refusal(run('editor.select-spectral-band', { low: 3_000, high: 300 }))).toBe(reason);
    expect(refusal(run('editor.select-spectral-band', { low: 300, high: rate() }))).toBe(reason);
    expect(selection().spectral).toBeUndefined();
  });

  it('widens and narrows the area in time by a step of the view', () => {
    run('editor.select-spectral', drawn(rectangle(100_000, 200_000, 100, 400), 'replace'));
    const viewport = context.editorViews.entry('editor')?.state.viewport;
    if (viewport === undefined) throw new Error('The view is not open.');
    const step = samplesWithin(viewport, SPECTRAL_TIME_STEP_PIXELS);
    run('editor.widen-spectral-time');
    expect(selection().spectral?.shapes[0]).toEqual(
      rectangle(100_000 - step, 200_000 + step, 100, 400),
    );
    run('editor.narrow-spectral-time');
    run('editor.narrow-spectral-time');
    expect(selection().spectral?.shapes[0]).toEqual(
      rectangle(100_000 + step, 200_000 - step, 100, 400),
    );
  });

  it('widens and narrows the band by a step of the spectrogram’s axis', () => {
    run('editor.select-spectral', drawn(rectangle(100_000, 200_000, 400, 1_600), 'replace'));
    const before = selection().spectral;
    run('editor.widen-spectral-band');
    const [wider] = selection().spectral?.shapes ?? [];
    if (wider?.kind !== 'rectangle') throw new Error('The rectangle was not kept.');
    expect(wider.band.low).toBeLessThan(400);
    expect(wider.band.high).toBeGreaterThan(1_600);
    run('editor.narrow-spectral-band');
    const [back] = selection().spectral?.shapes ?? [];
    if (back?.kind !== 'rectangle' || before?.shapes[0]?.kind !== 'rectangle') {
      throw new Error('The rectangle was not kept.');
    }
    expect(back.band.low).toBeCloseTo(400, 6);
    expect(back.band.high).toBeCloseTo(1_600, 6);
  });

  it('refuses a step past the audio or to nothing, leaving the selection as it was', () => {
    const length = context.assets.find(ASSET)?.length ?? 0;
    run('editor.select-spectral', drawn(rectangle(0, length, 0, rate() / 2), 'replace'));
    expect(refusal(run('editor.widen-spectral-time'))).toBe(
      'The spectral selection reaches as far in time as the audio does.',
    );
    expect(refusal(run('editor.widen-spectral-band'))).toBe(
      'The spectral selection reaches as far in frequency as the audio does.',
    );
    run('editor.select-spectral', drawn(rectangle(1_000, 1_001, 100, 400), 'replace'));
    expect(refusal(run('editor.narrow-spectral-time'))).toBe(
      'The spectral selection cannot be narrowed in time any further.',
    );
    expect(selection().spectral?.shapes[0]).toEqual(rectangle(1_000, 1_001, 100, 400));
  });

  it('clears the area alone, keeping the time selection', () => {
    run('editor.select-time', { start: 1_000, end: 2_000 });
    run('editor.select-spectral-band');
    run('editor.clear-spectral-selection');
    expect(selection().spectral).toBeUndefined();
    expect(selection().time).toEqual({ start: 1_000, end: 2_000 });
    expect(refusal(run('editor.clear-spectral-selection'))).toBe(
      'No area of time and frequency is selected.',
    );
  });

  it('describes the area in words, for a person who cannot see it', () => {
    run('editor.time-format-samples');
    run('editor.select-spectral', drawn(rectangle(1_000, 2_000, 100, 4_000), 'replace', '0'));
    run('editor.select-spectral', drawn(rectangle(1_200, 1_400, 200, 300), 'subtract'));
    run('editor.describe-spectral-selection');
    expect(context.interaction.get().announcement?.text).toBe(
      'An area from 1,000 to 2,000, 100 Hz to 4 kHz, on channel Left. It is made of a rectangle, with a rectangle taken away. Its rectangles and lasso shapes have hard edges. It is what an edit acts on now.',
    );
  });
});
