/**
 * Where the engine is drawing the arrangement last known, kept up to date
 * until stopped.
 *
 * A group still drawn where it was reads back as it was stored, which is what
 * makes an arrangement nobody has changed read back as itself (see
 * `DrawnGroup` in `geometry.ts`). That pairing has to move with the engine,
 * and it moves for two reasons: a report, which is a new arrangement drawn
 * somewhere; and the grid laid out at a new size, which the engine reports
 * nothing for, because a resize is not a change to the workspace.
 *
 * Fixed at the mount, the pairing would be right only while the dock stayed the
 * size it was mounted at. After a change of window size, of zoom, of monitor,
 * or a status-bar notice appearing, the next report would find every group
 * somewhere else, read each one's share off the pixels, and record a change
 * nobody had made; the workspace as it ships would then offer a reset that
 * would change nothing anyone could see.
 *
 * Kept apart from the adapter, with the measuring, the watch for a new size and
 * the frame scheduler injected, as the coalescer is: the adapter cannot be
 * tested without mounting an engine, and here a test holds the pairing renewed
 * after a report and the watch stopped with the mount.
 */

import type { WorkspaceArrangement } from '../panel.js';
import type { FrameScheduler } from './coalescer.js';
import { drawnGroups, type DrawnGroup, type MeasuredGroup } from './geometry.js';

/** What the adapter asks of the pairing. */
export interface Baseline {
  /** The pairing to read the next report against. */
  readonly groups: () => readonly DrawnGroup[];

  /** Takes an arrangement that was just reported, and where it was drawn. */
  readonly reported: (
    arrangement: WorkspaceArrangement,
    measured: readonly MeasuredGroup[],
  ) => void;

  /** Stops watching for a new size, and gives up a pairing owed to a frame. */
  readonly stop: () => void;
}

/** What the pairing is kept from. */
export interface BaselineSources {
  /** The arrangement the engine was mounted with. */
  readonly drawn: WorkspaceArrangement;

  /** Where the engine drew it at the mount. */
  readonly mounted: readonly MeasuredGroup[];

  /** Where the engine draws its groups now, read against the pairing given. */
  readonly measure: (before: readonly DrawnGroup[]) => readonly MeasuredGroup[];

  /** Calls `resized` each time the dock is laid out at a new size, until the answer is called. */
  readonly watchSize: (resized: () => void) => () => void;

  readonly frames: FrameScheduler;
}

/** Keeps the pairing, from the mount on. */
export function keepBaseline(sources: BaselineSources): Baseline {
  const { measure, frames } = sources;
  let groups = drawnGroups(sources.drawn, sources.mounted);
  let known = sources.drawn;

  // A frame later, once the engine has finished laying the grid out: the
  // measurement taken inside the watch's own callback is of the size it is
  // reporting, not of what the engine has drawn in it.
  let nextFrame: number | undefined;
  const unwatch = sources.watchSize(() => {
    if (nextFrame !== undefined) frames.cancel(nextFrame);
    nextFrame = frames.request(() => {
      nextFrame = undefined;
      groups = drawnGroups(known, measure(groups));
    });
  });

  return {
    groups: () => groups,
    reported: (arrangement, measured) => {
      known = arrangement;
      groups = drawnGroups(arrangement, measured);
    },
    stop: () => {
      unwatch();
      if (nextFrame !== undefined) frames.cancel(nextFrame);
      nextFrame = undefined;
    },
  };
}
