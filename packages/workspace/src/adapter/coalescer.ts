/**
 * Reporting a burst of engine changes once a frame, without losing the last.
 *
 * The docking engine raises a layout change for every pointer move of a
 * splitter drag, and each report is a command, a validation and a write to
 * storage; were each change reported, a drag would write hundreds of them. So
 * the first change of a burst is reported as it happens, and anything further
 * is owed to the end of the frame.
 *
 * Kept apart from the adapter, with the frame scheduler injected, because this
 * logic holds three constraints and the adapter cannot be tested without
 * mounting an engine. A frame left pending when the dock is remounted would
 * measure an engine that has been disposed and report an all-centre arrangement
 * into the next workspace, so stopping cancels it. A report that itself
 * provokes a change is not a fresh burst, and is owed to a frame rather than
 * reported again inside the first. And a frame never runs in a hidden tab, so
 * what is owed is reported when the page is hidden or left: were it owed to a
 * frame that will not come, the arrangement a drag ends on would be lost when a
 * tab switched away from is discarded or closed, and the workspace would keep
 * where the drag began.
 */

/** Requests and cancels a callback at the next frame. */
export interface FrameScheduler {
  readonly request: (callback: () => void) => number;
  readonly cancel: (handle: number) => void;
}

/** What the adapter tells the coalescer, and what it asks of it. */
export interface ChangeCoalescer {
  /** The engine changed. */
  readonly changed: () => void;

  /**
   * Reports now whatever is owed, and waits for no frame.
   *
   * For a page being hidden or left, where no frame will run: the browser
   * suspends frames in a hidden document, and a discarded or closed tab never
   * gets one.
   */
  readonly flush: () => void;

  /** Stops reporting for good, and cancels anything owed. */
  readonly stop: () => void;
}

/** Creates a coalescer that calls `report` for the first change of a burst and at most once a frame after it. */
export function createChangeCoalescer(report: () => void, frames: FrameScheduler): ChangeCoalescer {
  /** The frame requested and not yet run. While there is one, changes are owed to it. */
  let pending: number | undefined;
  let owed = false;
  let stopped = false;

  /** Whether a flush is reporting, so a change it provokes waits. */
  let flushing = false;

  const atFrame = (): void => {
    pending = undefined;
    if (stopped || !owed) return;
    owed = false;

    // The next frame is requested before reporting, so a change the report
    // itself provokes is owed to that frame rather than reported inside this
    // one.
    pending = frames.request(atFrame);
    report();
  };

  return {
    changed: () => {
      if (stopped) return;
      if (pending !== undefined) {
        owed = true;
        return;
      }

      // A change a flush's report provokes is owed to a frame rather than
      // reported inside it, as it is at a frame.
      if (flushing) {
        owed = true;
        pending = frames.request(atFrame);
        return;
      }

      pending = frames.request(atFrame);
      report();
    },

    flush: () => {
      if (stopped || pending === undefined) return;
      frames.cancel(pending);
      pending = undefined;

      if (!owed) return;
      owed = false;

      flushing = true;
      try {
        report();
      } finally {
        flushing = false;
      }
    },

    stop: () => {
      stopped = true;
      owed = false;
      if (pending !== undefined) frames.cancel(pending);
      pending = undefined;
    },
  };
}
