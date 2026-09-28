import { describe, expect, it } from 'vitest';

import { DockRegion, type PanelGroup, type WorkspaceArrangement } from '../panel.js';
import { keepBaseline } from './baseline.js';
import {
  arrangementFrom,
  type DrawnGroup,
  type MeasuredGroup,
  type Rectangle,
} from './geometry.js';

/**
 * Where the engine is drawing the arrangement last known.
 *
 * The browser suite holds the pairing taken again after a resize; these hold it
 * taken again after a report. Kept at the mount's arrangement, a splitter the
 * user dragged, then a new window size, then a tab chosen, would read the
 * user's resize back as the share the workspace was mounted with.
 */

/** Frames that run only when a test says a frame has passed. */
function handFrames() {
  const pending = new Map<number, () => void>();
  let next = 0;
  return {
    request: (callback: () => void): number => {
      next += 1;
      pending.set(next, callback);
      return next;
    },
    cancel: (handle: number): void => {
      pending.delete(handle);
    },
    run: (): void => {
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback();
    },
    pending: (): number => pending.size,
  };
}

/** A dock whose size a test changes, and whether anything still watches it. */
function handDock() {
  let resized: (() => void) | undefined;
  return {
    watchSize: (callback: () => void): (() => void) => {
      resized = callback;
      return () => {
        resized = undefined;
      };
    },
    resize: (): void => {
      resized?.();
    },
    watched: (): boolean => resized !== undefined,
  };
}

/** The asset browser on the left at `width`, and the editor beside it, in a dock `total` wide. */
function drawnAt(width: number, total: number): readonly MeasuredGroup[] {
  const height = 600;
  return [
    {
      rectangle: { x: 0, y: 0, width, height },
      panels: [{ id: 'assets', kind: 'asset-browser' }],
      floating: false,
    },
    {
      rectangle: { x: width, y: 0, width: total - width, height },
      panels: [{ id: 'editor', kind: 'editor' }],
      floating: false,
    },
  ];
}

/** An arrangement of the asset browser at `share` beside the editor. */
function arrangedAt(share: number): WorkspaceArrangement {
  const group = (region: DockRegion, id: string, kind: string, proportion: number): PanelGroup => ({
    region,
    panels: [{ id, kind }],
    activePanelId: id,
    proportion,
  });
  return {
    groups: [
      group(DockRegion.Left, 'assets', 'asset-browser', share),
      group(DockRegion.Centre, 'editor', 'editor', 1),
    ],
    activePanelId: 'editor',
  };
}

/** The share the asset browser reads back at, measured against `before`. */
function assetsShare(
  measured: readonly MeasuredGroup[],
  workspace: Rectangle,
  before: readonly DrawnGroup[],
): number | undefined {
  return arrangementFrom(measured, 'editor', workspace, before).groups.find(
    (group) => group.region === DockRegion.Left,
  )?.proportion;
}

describe('keepBaseline', () => {
  it('keeps the share a user dragged to through a new size of the dock and a tab chosen', () => {
    // The shipped share, 0.2, is drawn at 200 of 1000 pixels. The user drags
    // the splitter to 350 pixels, which is reported as 0.35.
    const frames = handFrames();
    const dock = handDock();
    let current = drawnAt(200, 1000);
    const baseline = keepBaseline({
      drawn: arrangedAt(0.2),
      mounted: current,
      measure: () => current,
      watchSize: dock.watchSize,
      frames,
    });

    current = drawnAt(350, 1000);
    baseline.reported(arrangedAt(0.35), current);

    // The window narrows, and the engine draws the same share of a smaller dock.
    current = drawnAt(280, 800);
    dock.resize();
    frames.run();

    // A tab chosen is reported against the pairing: the asset browser is still
    // drawn where the share the user chose puts it.
    const workspace = { x: 0, y: 0, width: 800, height: 600 };
    expect(assetsShare(current, workspace, baseline.groups())).toBe(0.35);
  });

  it('stops watching the dock and gives up the pairing owed to a frame when stopped', () => {
    const frames = handFrames();
    const dock = handDock();
    const baseline = keepBaseline({
      drawn: arrangedAt(0.2),
      mounted: drawnAt(200, 1000),
      measure: () => drawnAt(160, 800),
      watchSize: dock.watchSize,
      frames,
    });

    dock.resize();
    expect(frames.pending()).toBe(1);

    baseline.stop();

    expect(dock.watched()).toBe(false);
    expect(frames.pending()).toBe(0);
  });
});
