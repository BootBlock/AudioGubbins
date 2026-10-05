import { describe, expect, it, vi } from 'vitest';

import { sampleCount, unsafeBrandId } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { layoutView, newViewState, type EditorViewState } from '@audiogubbins/editor-view';
import { PointerKind, type PointerSample } from '@audiogubbins/input';
import { EMPTY_SELECTION, boundaryAt, samplesWithin } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import { testAssets } from '../assets/test-assets.js';
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
