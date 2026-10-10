/**
 * A spectral shape drawn from the keyboard through its commands (ADR-0082,
 * REQ-UX-005): the cursor stands at the playhead and moves up and down the
 * axis, a point is placed where it stands, and finishing joins to the
 * selection the very shape a pointer through those points joins, for the
 * lasso, the brush and the marquee; the cursor's place said in words.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  commandId,
  createCommandBus,
  createCommandRegistry,
  type CommandBus,
  type CommandInvocation,
  type ExecutionResult,
} from '@audiogubbins/commands';
import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';
import { ToolId, layoutView, type EditorViewState } from '@audiogubbins/editor-view';
import { DEFAULT_GESTURE_SETTINGS, PointerKind, type PointerSample } from '@audiogubbins/input';
import { EMPTY_SELECTION, SpectralCombination, boundaryAt, pixelOf } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { IntentCommand } from '../editor/intent-commands.js';
import { ToolPointer } from '../editor/tool-pointer.js';
import { DESCRIPTORS, buildShellContext } from '../testing/shell-context.js';
import { everythingQueued } from '../testing/waiting.js';
import type { ShellContext } from './shell-context.js';
import { shellCommands } from './shell-commands.js';

type Arguments = NonNullable<CommandInvocation['arguments']>;

const ASSET = 'test:tone-bursts';
const SIZE = { width: 1000, height: 300 };

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

function asset(): EditorAsset {
  const found = context.assets.find(ASSET);
  if (found === undefined) throw new Error(`No asset ${ASSET}.`);
  return found;
}

function view(): EditorViewState {
  const state = context.editorViews.entry('editor')?.state;
  if (state === undefined) throw new Error('The view is not open.');
  return state;
}

function said(): string | undefined {
  return context.interaction.get().announcement?.text;
}

beforeEach(() => {
  context = buildShellContext().context;
  const registry = createCommandRegistry<ShellContext>();
  for (const command of shellCommands(DESCRIPTORS)) registry.register(command);
  bus = createCommandBus(
    registry,
    createDiagnosticCentre(createLogStore(), { now: () => 0 }).loggerFor('commands'),
  );
  context.editorViews.open('editor', asset());
  context.editorViews.measured('editor', SIZE, asset().length);
  context.editorViews.focus('editor');
  run('editor.display-spectrogram');
  // Off, so a pointer's position lands where it is, as the playhead's does.
  run('editor.toggle-snapping');
});

/** A point of a shape: a pixel across the view, and a number of cursor steps up from the middle. */
type Point = readonly [x: number, steps: number];

/** The boundary at pixel `x` of the view. */
function boundaryOf(x: number): number {
  return boundaryAt(view().viewport, x, asset().length);
}

/** Places a point at each of `points` from the keyboard, the cursor starting half way up. */
function placeByKeyboard(points: readonly Point[]): void {
  let steps = 0;
  for (const [x, up] of points) {
    run('editor.set-playhead', { position: boundaryOf(x) });
    for (; steps < up; steps += 1) run('editor.spectral-cursor-up');
    for (; steps > up; steps -= 1) run('editor.spectral-cursor-down');
    expect(run('editor.place-spectral-point').kind).toBe('applied');
  }
}

/** The selection a mouse dragged through `points` in the first channel's lane makes. */
async function selectionByPointer(points: readonly Point[]) {
  const state = view();
  const layout = layoutView(state, SIZE.width, SIZE.height, 2, false);
  const lane = layout.lanes[0];
  if (lane === undefined) throw new Error('No lane.');
  const ran: IntentCommand[] = [];
  const pointer = new ToolPointer({
    panel: 'editor',
    snapshot: () => ({
      sources: {
        state,
        asset: asset(),
        selection: EMPTY_SELECTION,
        playhead: undefined,
        picture: undefined,
      },
      layout,
    }),
    panning: () => false,
    gestures: () => DEFAULT_GESTURE_SETTINGS,
    run: (command) => {
      ran.push(command);
    },
    show: () => undefined,
    fault: (error) => {
      throw error;
    },
    zeroCrossing: () => Promise.resolve(undefined),
  });
  const sample = ([x, steps]: Point): PointerSample => ({
    pointerId: 1,
    kind: PointerKind.Mouse,
    x: pixelOf(state.viewport, boundaryOf(x)),
    // The cursor's axis is 200 fine steps from its foot, and starts half way up.
    y: lane.area.y + lane.area.height * (1 - (100 + steps * 10) / 200),
    timestamp: 0,
  });
  const [first, ...rest] = points;
  if (first === undefined) throw new Error('No points.');
  const none = { shift: false, alt: false };
  pointer.down(sample(first), none);
  for (const point of rest) {
    await everythingQueued();
    pointer.moved(sample(point), none);
  }
  await everythingQueued();
  pointer.up(sample(rest.at(-1) ?? first), none);
  await vi.waitFor(() => {
    expect(ran).toHaveLength(1);
  });
  const before = context.selections.of(ASSET);
  for (const command of ran) run(command.id, command.args);
  const made = context.selections.of(ASSET);
  context.selections.change(ASSET, () => before);
  return made;
}

const LASSO: readonly Point[] = [
  [100, 4],
  [180, 5],
  [300, 2],
  [250, -3],
  [120, -2],
];

describe('drawing a spectral shape from the keyboard', () => {
  for (const tool of [ToolId.SpectralLasso, ToolId.SpectralBrush] as const) {
    it(`joins with the ${tool} the very shape a pointer through those points joins`, async () => {
      run(`editor.tool-${tool}`);
      const byPointer = await selectionByPointer(LASSO);
      placeByKeyboard(LASSO);
      expect(run('editor.finish-spectral-shape').kind).toBe('applied');
      expect(context.selections.of(ASSET).spectral).toEqual(byPointer.spectral);
      expect(context.selections.of(ASSET).channels).toEqual(byPointer.channels);
      expect(context.editorViews.entry('editor')?.drawing?.placed).toEqual([]);
    });
  }

  it('takes the marquee’s corner and the cursor as a rectangle’s corners', async () => {
    run('editor.tool-spectral-marquee');
    const corners: readonly Point[] = [
      [100, 4],
      [400, -2],
    ];
    const byPointer = await selectionByPointer(corners);
    placeByKeyboard(corners.slice(0, 1));
    expect(refusal(run('editor.place-spectral-point'))).toBe(
      'The marquee has its corner. Move the cursor to the other corner and finish the shape.',
    );
    run('editor.set-playhead', { position: boundaryOf(400) });
    for (let step = 0; step < 6; step += 1) run('editor.spectral-cursor-down');
    run('editor.finish-spectral-shape');
    expect(context.selections.of(ASSET).spectral).toEqual(byPointer.spectral);
  });

  it('strokes at the fixed strength and joins as the combination mode says', () => {
    run('editor.tool-spectral-brush');
    run('tools.set-fixed-strength', { strength: 0.4 });
    placeByKeyboard(LASSO.slice(0, 2));
    run('editor.finish-spectral-shape');
    run('editor.spectral-combination-add');
    placeByKeyboard(LASSO.slice(2));
    run('editor.finish-spectral-shape');
    const shapes = context.selections.of(ASSET).spectral?.shapes ?? [];
    expect(shapes.map((shape) => shape.effect)).toEqual(['add', 'add']);
    const strengths = shapes.flatMap((shape) =>
      shape.kind === 'stroke' ? shape.points.map((point) => point.strength) : [],
    );
    expect(new Set(strengths)).toEqual(new Set([0.4]));
    expect(view().spectralTools.combination).toBe(SpectralCombination.Add);
  });

  it('says where the cursor is and how many points are placed', () => {
    run('editor.tool-spectral-lasso');
    run('editor.time-format-samples');
    run('editor.set-playhead', { position: 4_800 });
    run('editor.spectral-cursor-up');
    expect(said()).toMatch(
      /^The cursor is at 4,800, [\d.]+ k?Hz, on channel Left; nothing placed\.$/u,
    );
    run('editor.place-spectral-point');
    run('editor.spectral-cursor-down-fine');
    expect(said()).toMatch(/; 1 point placed\.$/u);
  });

  it('moves the cursor to the next channel’s lane, but not while a shape is drawn in one', () => {
    run('editor.tool-spectral-lasso');
    run('editor.spectral-cursor-next-channel');
    expect(context.editorViews.entry('editor')?.drawing?.channel).toBe(1);
    expect(said()).toMatch(/on channel Right/u);
    run('editor.place-spectral-point');
    expect(refusal(run('editor.spectral-cursor-next-channel'))).toBe(
      'A shape is drawn in one channel. Finish it or let its points go first.',
    );
    run('editor.cancel-spectral-shape');
    expect(context.editorViews.entry('editor')?.drawing?.placed).toEqual([]);
    expect(refusal(run('editor.cancel-spectral-shape'))).toBe(
      'No point of a spectral shape is placed.',
    );
  });

  it('refuses to draw without a spectral tool, or to finish what makes nothing', () => {
    expect(refusal(run('editor.place-spectral-point'))).toBe(
      'Choose the spectral marquee, lasso or brush to draw with first.',
    );
    run('editor.tool-spectral-lasso');
    expect(refusal(run('editor.finish-spectral-shape'))).toBe('Place a point of the shape first.');
    placeByKeyboard(LASSO.slice(0, 2));
    expect(refusal(run('editor.finish-spectral-shape'))).toMatch(/^Those points enclose nothing/u);
    expect(context.selections.of(ASSET).spectral).toBeUndefined();
  });

  it('stops the cursor at the edges of the lane, and says so', () => {
    run('editor.tool-spectral-lasso');
    for (let step = 0; step < 12; step += 1) run('editor.spectral-cursor-up');
    expect(refusal(run('editor.spectral-cursor-up'))).toBe('The cursor is at the top of the lane.');
  });

  it('refuses a view that shows no spectrogram for the cursor to stand in', () => {
    run('editor.tool-spectral-lasso');
    run('editor.display-waveform');
    expect(refusal(run('editor.spectral-cursor-up'))).toBe(
      'The cursor’s channel shows no spectrogram here. Show the spectrogram to draw on it.',
    );
  });
});
