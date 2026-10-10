import { describe, expect, it, vi } from 'vitest';

import { sampleCount, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  DisplayMode,
  ToolId,
  layoutView,
  newViewState,
  type EditorViewState,
} from '@audiogubbins/editor-view';
import {
  DEFAULT_GESTURE_SETTINGS,
  PointerKind,
  type GestureSettings,
  type PointerSample,
} from '@audiogubbins/input';
import {
  EMPTY_SELECTION,
  SpectralCombination,
  boundaryAt,
  samplesWithin,
} from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { testAssets } from '../assets/test-assets.js';
import { everythingQueued } from '../testing/waiting.js';
import type { IntentCommand } from './intent-commands.js';
import { ToolPointer, type ToolPointerHost } from './tool-pointer.js';

/**
 * One pointer working a view's tool, over a fake host: the view it reads, the
 * commands it runs, and the zero-crossing search it asks, which answers what
 * the test says and records what it was asked.
 */

const TONES = (() => {
  const [first] = expectSuccess(testAssets());
  if (first === undefined) throw new Error('No test asset.');
  return first;
})();

/** A view of the tone bursts 1000 CSS pixels wide, with the Select tool. */
function viewOf(change: (state: EditorViewState) => EditorViewState = (state) => state) {
  return change(newViewState(TONES.length, 1000));
}

/** A search asked of the host, and what it was asked with. */
interface Asked {
  readonly position: number;
  readonly within: number;
  readonly channels: readonly number[];
  readonly signal: AbortSignal;
}

/** A pointer over a fake host whose search answers `answer` for the position asked. */
function pointerOver(
  state: EditorViewState,
  answer: (position: number) => Promise<number | undefined>,
  asset: EditorAsset = TONES,
  gestures: GestureSettings = DEFAULT_GESTURE_SETTINGS,
) {
  const asked: Asked[] = [];
  const ran: IntentCommand[] = [];
  const faults: unknown[] = [];
  const host: ToolPointerHost = {
    panel: 'editor',
    snapshot: () => ({
      sources: {
        state,
        asset,
        content: { markers: [], regions: [] },
        selection: EMPTY_SELECTION,
        playhead: undefined,
        picture: undefined,
      },
      layout: layoutView(state, 1000, 200, 2, false),
    }),
    panning: () => false,
    gestures: () => gestures,
    run: (command) => {
      ran.push(command);
    },
    show: () => undefined,
    fault: (error) => {
      faults.push(error);
    },
    zeroCrossing: (position, within, channels, signal) => {
      asked.push({ position, within, channels, signal });
      return answer(position);
    },
  };
  return { tool: new ToolPointer(host), asked, ran, faults };
}

/** A mouse at `x`, in the first lane. */
function at(x: number, pointerId = 1): PointerSample {
  return { pointerId, kind: PointerKind.Mouse, x, y: 60, timestamp: 0 };
}

const NONE = { shift: false, alt: false };

/** Drags from `from` to `to` and lets go. */
function drag(tool: ToolPointer, from: number, to: number): void {
  tool.down(at(from), NONE);
  tool.moved(at((from + to) / 2), NONE);
  tool.moved(at(to), NONE);
  tool.up(at(to), NONE);
}

describe('snapping a drag to zero crossings (REQ-EDIT-013)', () => {
  it('starts and ends a selection on the crossings the search found', async () => {
    // Nothing held this: every browser test that drags turns zero crossings
    // off, and removing the search from the pointer passed every suite.
    const state = viewOf();
    const { viewport } = state;
    const crossing = (position: number) => Promise.resolve(position + 5);
    const { tool, asked, ran } = pointerOver(state, crossing);

    drag(tool, 210, 420);

    await vi.waitFor(() => {
      expect(ran).toHaveLength(1);
    });
    const start = boundaryAt(viewport, 210, TONES.length) + 5;
    const end = boundaryAt(viewport, 420, TONES.length) + 5;
    expect(ran[0]).toMatchObject({ id: 'editor.select-time', args: { start, end } });
    // Searched as far as the snapping tolerance reaches, on the channels shown.
    expect(asked[0]).toMatchObject({
      position: start - 5,
      within: samplesWithin(viewport, state.snapping.tolerance),
      channels: [0, 1],
    });
  });

  it('searches only the channels the view shows', async () => {
    const state = viewOf((view) => ({ ...view, hiddenChannels: [1] }));
    const { tool, asked } = pointerOver(state, () => Promise.resolve(undefined));

    tool.down(at(300), NONE);

    await vi.waitFor(() => {
      expect(asked.map((one) => one.channels)).toEqual([[0]]);
    });
  });

  it('keeps the pointer’s own position where the crossing is beyond the tolerance', async () => {
    const state = viewOf();
    const beyond = samplesWithin(state.viewport, state.snapping.tolerance) * 2;
    const { tool, ran } = pointerOver(state, (position) => Promise.resolve(position + beyond));

    drag(tool, 210, 420);

    await vi.waitFor(() => {
      expect(ran).toHaveLength(1);
    });
    expect(ran[0]).toMatchObject({
      args: {
        start: boundaryAt(state.viewport, 210, TONES.length),
        end: boundaryAt(state.viewport, 420, TONES.length),
      },
    });
  });

  it('asks nothing of the audio where zero crossings are not snapped to', async () => {
    const state = viewOf((view) => ({
      ...view,
      snapping: { ...view.snapping, enabled: false },
    }));
    const { tool, asked, ran } = pointerOver(state, () => Promise.resolve(0));

    drag(tool, 210, 420);

    await vi.waitFor(() => {
      expect(ran).toHaveLength(1);
    });
    expect(asked).toEqual([]);
  });
});

describe('a search the press no longer needs', () => {
  /** A search that answers only when it is given up, as the peak worker's does. */
  const untilGivenUp = (asked: () => readonly Asked[]) => () =>
    new Promise<number | undefined>((_resolve, reject) => {
      const { signal } = asked().at(-1) ?? {};
      signal?.addEventListener('abort', () => {
        reject(new Error('Given up.'));
      });
    });

  it('is given up when the press is cancelled, and is no fault', async () => {
    const state = viewOf();
    const record: { asked: readonly Asked[] } = { asked: [] };
    const pointer = pointerOver(
      state,
      untilGivenUp(() => record.asked),
    );
    record.asked = pointer.asked;

    pointer.tool.down(at(300), NONE);
    await vi.waitFor(() => {
      expect(pointer.asked).toHaveLength(1);
    });
    pointer.tool.cancel();

    expect(pointer.asked[0]?.signal.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(pointer.tool.pressed).toBe(false);
    });
    expect(pointer.faults).toEqual([]);
    expect(pointer.ran).toEqual([]);
  });

  it('is given up when another pointer takes the tool while it is held', async () => {
    const state = viewOf();
    const record: { asked: readonly Asked[] } = { asked: [] };
    const pointer = pointerOver(
      state,
      untilGivenUp(() => record.asked),
    );
    record.asked = pointer.asked;

    pointer.tool.down(at(300, 1), NONE);
    await vi.waitFor(() => {
      expect(pointer.asked).toHaveLength(1);
    });
    pointer.tool.down(at(500, 2), NONE);

    expect(pointer.asked[0]?.signal.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(pointer.asked).toHaveLength(2);
    });
    expect(pointer.asked[1]?.signal.aborted).toBe(false);
    expect(pointer.faults).toEqual([]);
  });

  it('is kept for a press that was released, so its release is not lost to the next', async () => {
    const state = viewOf();
    const answers: ((value: number | undefined) => void)[] = [];
    const pointer = pointerOver(
      state,
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );

    pointer.tool.down(at(210, 1), NONE);
    pointer.tool.moved(at(420, 1), NONE);
    pointer.tool.up(at(420, 1), NONE);
    pointer.tool.down(at(600, 2), NONE);
    for (let answered = 0; answered < 4; answered += 1) {
      await vi.waitFor(() => {
        expect(answers.length).toBeGreaterThan(answered);
      });
      answers[answered]?.(undefined);
    }

    await vi.waitFor(() => {
      expect(pointer.ran.map((command) => command.id)).toEqual(['editor.select-time']);
    });
    expect(pointer.asked.slice(0, 3).map((one) => one.signal.aborted)).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('tapping a region in the strip (REQ-EDIT-014, REQ-EDIT-065)', () => {
  it('selects the region tapped, on its span or its end, and adds one with shift', async () => {
    const state = viewOf();
    const { viewport } = state;
    const regionOver = (id: string, from: number, to: number) => {
      const start = boundaryAt(viewport, from, TONES.length);
      return {
        id: unsafeBrandId<'RegionId'>(id),
        displayName: id,
        start,
        length: expectSuccess(sampleCount(boundaryAt(viewport, to, TONES.length) - start)),
        tags: [],
      };
    };
    const asset: EditorAsset = {
      ...TONES,
      regions: [regionOver('region-1', 100, 300), regionOver('region-2', 500, 700)],
    };
    const { tool, ran } = pointerOver(state, () => Promise.resolve(undefined), asset);
    const strip = layoutView(state, 1000, 200, 2, false).strip.y + 2;
    const tap = (x: number, modifiers = NONE) => {
      tool.down({ ...at(x), y: strip }, modifiers);
      tool.up({ ...at(x), y: strip }, modifiers);
    };

    tap(200);
    tap(700, { shift: true, alt: false });

    await vi.waitFor(() => {
      expect(ran).toHaveLength(2);
    });
    expect(ran).toEqual([
      { id: 'editor.select-region', args: { view: 'editor', region: 'region-1', add: false } },
      { id: 'editor.select-region', args: { view: 'editor', region: 'region-2', add: true } },
    ]);
  });
});

describe('dragging the end of a region in the strip (REQ-EDIT-014)', () => {
  it('moves that end to where it is let go, not back to where it was', async () => {
    // The end's own place is a region boundary within the snapping tolerance
    // of a short drag: offered as a target, it would take the drag back.
    const state = viewOf();
    const { viewport } = state;
    const start = boundaryAt(viewport, 100, TONES.length);
    const end = boundaryAt(viewport, 300, TONES.length);
    const region = {
      id: unsafeBrandId<'RegionId'>('region-1'),
      displayName: 'Region 1',
      start,
      length: expectSuccess(sampleCount(end - start)),
      tags: [],
    };
    const asset: EditorAsset = { ...TONES, regions: [region] };
    const { tool, ran } = pointerOver(state, () => Promise.resolve(undefined), asset);
    const strip = layoutView(state, 1000, 200, 2, false).strip.y + 2;
    const inStrip = (x: number): PointerSample => ({ ...at(x), y: strip });

    tool.down(inStrip(300), NONE);
    tool.moved(inStrip(306), NONE);
    tool.up(inStrip(306), NONE);

    await vi.waitFor(() => {
      expect(ran).toHaveLength(1);
    });
    expect(ran[0]).toEqual({
      id: 'region.move-end',
      args: { view: 'editor', region: 'region-1', to: boundaryAt(viewport, 306, TONES.length) },
    });
  });

  it.each([
    ['markers', 'editor.move-marker'],
    ['regions', 'region.move-end'],
  ] as const)('grabs no %s while they are hidden', async (overlay, moved) => {
    const shown = viewOf();
    const state = viewOf((view) => ({ ...view, overlays: { ...view.overlays, [overlay]: false } }));
    const { viewport } = shown;
    const start = boundaryAt(viewport, 100, TONES.length);
    const end = boundaryAt(viewport, 300, TONES.length);
    const asset: EditorAsset = {
      ...TONES,
      // One or the other, as a marker in reach is grabbed before a region's edge.
      markers:
        overlay === 'markers'
          ? [{ id: unsafeBrandId<'MarkerId'>('marker-1'), displayName: 'Hit', position: end }]
          : [],
      regions:
        overlay === 'regions'
          ? [
              {
                id: unsafeBrandId<'RegionId'>('region-1'),
                displayName: 'Region 1',
                start,
                length: expectSuccess(sampleCount(end - start)),
                tags: [],
              },
            ]
          : [],
    };
    const layout = layoutView(shown, 1000, 200, 2, false);
    const inStrip = (x: number): PointerSample => ({ ...at(x), y: layout.strip.y + 2 });
    const run = (view: EditorViewState) => {
      const pointer = pointerOver(view, () => Promise.resolve(undefined), asset);
      pointer.tool.down(inStrip(300), NONE);
      pointer.tool.moved(inStrip(340), NONE);
      pointer.tool.up(inStrip(340), NONE);
      // A click on the ruler after it, so the drag's commands have run when it has.
      pointer.tool.down({ ...at(500), y: layout.ruler.y + 2 }, NONE);
      pointer.tool.up({ ...at(500), y: layout.ruler.y + 2 }, NONE);
      return pointer.ran;
    };

    const whenShown = run(shown);
    const whenHidden = run(state);
    await vi.waitFor(() => {
      expect(whenShown.at(-1)?.id).toBe('editor.set-playhead');
      expect(whenHidden.at(-1)?.id).toBe('editor.set-playhead');
    });
    // Shown, the same drag moves what it grabbed, so hiding it is what stops it.
    expect(whenShown.map((command) => command.id)).toContain(moved);
    expect(whenHidden.map((command) => command.id)).not.toContain(moved);
  });
});

describe('the spectral tools through the pointer (ADR-0082)', () => {
  /** A spectrogram view of the tone bursts, with snapping off so a stroke lands where drawn. */
  const spectral = (tool: ToolId) =>
    viewOf((view) => ({
      ...view,
      tool,
      displayMode: DisplayMode.Spectrogram,
      snapping: { ...view.snapping, enabled: false },
    }));

  /** A pen at `x`, `y`, pressing `pressure`. */
  const pen = (x: number, y: number, pressure: number): PointerSample => ({
    pointerId: 1,
    kind: PointerKind.Pen,
    x,
    y,
    pressure,
    timestamp: 0,
  });

  /** The strengths of the stroke the brush made, as the command it ran was given it. */
  async function strokeStrengths(gestures: GestureSettings): Promise<readonly number[]> {
    const { tool, ran } = pointerOver(
      spectral(ToolId.SpectralBrush),
      () => Promise.resolve(undefined),
      TONES,
      gestures,
    );
    // Each move taken before the next, as a person's are.
    tool.down(pen(200, 90, 0.2), NONE);
    await everythingQueued();
    tool.moved(pen(240, 95, 0.6), NONE);
    await everythingQueued();
    tool.moved(pen(280, 100, 0.9), NONE);
    await everythingQueued();
    tool.up(pen(280, 100, 0.9), NONE);
    await vi.waitFor(() => {
      expect(ran).toHaveLength(1);
    });
    const [command] = ran;
    expect(command?.id).toBe('editor.select-spectral');
    const mask = JSON.parse(String(command?.args['mask'])) as {
      shapes: { points: { strength: number }[] }[];
    };
    return mask.shapes[0]?.points.map((point) => point.strength) ?? [];
  }

  it('strokes with a pen’s pressure where the person lets pressure set the strength', async () => {
    expect(await strokeStrengths(DEFAULT_GESTURE_SETTINGS)).toEqual([0.2, 0.6, 0.9]);
  });

  it('strokes at the fixed strength, whatever the pen presses, where the person turns pressure off', async () => {
    const fixed: GestureSettings = {
      ...DEFAULT_GESTURE_SETTINGS,
      usePenPressure: false,
      fixedStrength: 0.4,
    };
    expect(await strokeStrengths(fixed)).toEqual([0.4, 0.4, 0.4]);
  });

  it('draws with the brush and softness the view keeps, as the Spectral panel set them', async () => {
    const tools = {
      brushRadius: 30,
      hardness: 0.25,
      feather: { time: 480, frequency: 50 },
      combination: SpectralCombination.Replace,
    };
    const brushed = { ...spectral(ToolId.SpectralBrush), spectralTools: tools };
    const { tool, ran } = pointerOver(brushed, () => Promise.resolve(undefined));
    tool.down({ ...at(200), y: 90 }, NONE);
    tool.up({ ...at(200), y: 90 }, NONE);
    await vi.waitFor(() => {
      expect(ran).toHaveLength(1);
    });
    const mask = JSON.parse(String(ran[0]?.args['mask'])) as {
      shapes: { hardness: number; points: { radius: { time: number } }[] }[];
      feather: unknown;
    };
    expect(mask.shapes[0]?.hardness).toBe(0.25);
    expect(mask.shapes[0]?.points[0]?.radius.time).toBe(
      samplesWithin(brushed.viewport, tools.brushRadius),
    );
    expect(mask.feather).toEqual(tools.feather);
  });

  it('takes every move of a lasso or a brush, however long the zero-crossing search takes', async () => {
    for (const traced of [ToolId.SpectralBrush, ToolId.SpectralLasso]) {
      // Snapped to zero crossings, as a view is unless told otherwise, so
      // every event waits on the search; every move comes while the press
      // still waits on its own, as a quick drag's do while the worker is busy.
      const state = { ...spectral(traced), snapping: viewOf().snapping };
      const { tool, ran } = pointerOver(
        state,
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(undefined);
            }, 1);
          }),
      );
      tool.down({ ...at(200), y: 80 }, NONE);
      tool.moved({ ...at(260), y: 90 }, NONE);
      tool.moved({ ...at(300), y: 140 }, NONE);
      tool.moved({ ...at(220), y: 150 }, NONE);
      tool.up({ ...at(220), y: 150 }, NONE);
      await vi.waitFor(() => {
        expect(ran).toHaveLength(1);
      });
      const mask = JSON.parse(String(ran[0]?.args['mask'])) as {
        shapes: { points: unknown[] }[];
      };
      expect(mask.shapes[0]?.points, traced).toHaveLength(4);
    }
  });

  it('selects with the marquee on a spectrogram, as a command joining its shape', async () => {
    const state = spectral(ToolId.SpectralMarquee);
    const { tool, ran } = pointerOver(state, () => Promise.resolve(undefined));
    tool.down({ ...at(200), y: 80 }, { shift: true, alt: false });
    tool.moved({ ...at(260), y: 100 }, NONE);
    tool.up({ ...at(300), y: 120 }, NONE);
    await vi.waitFor(() => {
      expect(ran).toHaveLength(1);
    });
    const { viewport } = state;
    expect(ran[0]).toMatchObject({
      id: 'editor.select-spectral',
      args: { view: 'editor', combination: 'add', channels: '0' },
    });
    const mask = JSON.parse(String(ran[0]?.args['mask'])) as {
      shapes: { kind: string; range: { start: number; end: number } }[];
      feather: unknown;
    };
    expect(mask.shapes[0]).toMatchObject({
      kind: 'rectangle',
      range: {
        start: boundaryAt(viewport, 200, TONES.length),
        end: boundaryAt(viewport, 300, TONES.length),
      },
    });
    expect(mask.feather).toEqual({ time: 0, frequency: 0 });
  });
  /** A finger at `x`, `y`: a touch reports a pressure the brush does not read. */
  const finger = (x: number, y: number): PointerSample => ({
    pointerId: 3,
    kind: PointerKind.Touch,
    x,
    y,
    pressure: 0.5,
    timestamp: 0,
  });

  /** The command a finger's drag through `points` ran, each move taken before the next. */
  async function touched(
    state: EditorViewState,
    points: readonly (readonly [number, number])[],
  ): Promise<IntentCommand | undefined> {
    const { tool, ran } = pointerOver(state, () => Promise.resolve(undefined));
    const [first, ...rest] = points;
    if (first === undefined) throw new Error('No touch.');
    tool.down(finger(...first), NONE);
    for (const point of rest) {
      await everythingQueued();
      tool.moved(finger(...point), NONE);
    }
    await everythingQueued();
    tool.up(finger(...(rest.at(-1) ?? first)), NONE);
    await vi.waitFor(() => {
      expect(ran).toHaveLength(1);
    });
    return ran[0];
  }

  it('adds and takes away with a finger, which holds no key, as the combination mode says', async () => {
    for (const tool of [ToolId.SpectralMarquee, ToolId.SpectralLasso, ToolId.SpectralBrush]) {
      for (const combination of [SpectralCombination.Add, SpectralCombination.Subtract]) {
        const state = spectral(tool);
        const command = await touched(
          { ...state, spectralTools: { ...state.spectralTools, combination } },
          [
            [200, 80],
            [260, 90],
            [300, 110],
          ],
        );
        expect(command).toMatchObject({ id: 'editor.select-spectral', args: { combination } });
      }
    }
  });

  it('brushes with a finger at the fixed strength, since a touch has no pressure to read', async () => {
    const command = await touched(spectral(ToolId.SpectralBrush), [
      [200, 90],
      [240, 95],
      [280, 100],
    ]);
    const mask = JSON.parse(String(command?.args['mask'])) as {
      shapes: { points: { strength: number }[] }[];
    };
    expect(mask.shapes[0]?.points.map((point) => point.strength)).toEqual([
      DEFAULT_GESTURE_SETTINGS.fixedStrength,
      DEFAULT_GESTURE_SETTINGS.fixedStrength,
      DEFAULT_GESTURE_SETTINGS.fixedStrength,
    ]);
  });
});
