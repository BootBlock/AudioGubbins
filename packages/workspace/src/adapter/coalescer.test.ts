import { describe, expect, it } from 'vitest';

import { createChangeCoalescer, type FrameScheduler } from './coalescer.js';

/** Frames that run only when a test says a frame has passed. */
function manualFrames(): FrameScheduler & {
  readonly next: () => void;
  readonly waiting: () => number;
} {
  const callbacks = new Map<number, () => void>();
  let handle = 0;

  return {
    request: (callback) => {
      handle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel: (cancelled) => {
      callbacks.delete(cancelled);
    },
    next: () => {
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const callback of due) callback();
    },
    waiting: () => callbacks.size,
  };
}

describe('createChangeCoalescer', () => {
  it('reports the next change at once after a flush whose report threw', () => {
    // A report that threw during a flush left the coalescer believing it was
    // still flushing, so every later change was owed to a frame rather than
    // reported, for the rest of the session.
    const frames = manualFrames();
    let reports = 0;
    let broken = false;
    const coalescer = createChangeCoalescer(() => {
      reports += 1;
      if (broken) throw new Error('The report failed.');
    }, frames);

    coalescer.changed();
    coalescer.changed();
    broken = true;
    expect(() => {
      coalescer.flush();
    }).toThrow('The report failed.');
    broken = false;

    coalescer.changed();
    expect(reports).toBe(3);
  });

  it('reports the first change of a burst at once, and the rest once at the end of the frame', () => {
    const frames = manualFrames();
    let reports = 0;
    const coalescer = createChangeCoalescer(() => {
      reports += 1;
    }, frames);

    coalescer.changed();
    expect(reports).toBe(1);

    for (let move = 0; move < 50; move += 1) coalescer.changed();
    expect(reports).toBe(1);

    frames.next();
    expect(reports).toBe(2);
  });

  it('reports once a frame while changes keep coming, not twice', () => {
    // The trailing report used to clear the flags before it reported, so the
    // next change in the following frame was taken as a fresh burst and
    // reported at once, beside that frame's own trailing report.
    const frames = manualFrames();
    let reports = 0;
    const coalescer = createChangeCoalescer(() => {
      reports += 1;
    }, frames);

    coalescer.changed();
    for (let frame = 0; frame < 10; frame += 1) {
      coalescer.changed();
      coalescer.changed();
      frames.next();
    }

    expect(reports).toBe(1 + 10);
  });

  it('owes a change a report provokes to the next frame, rather than reporting inside itself', () => {
    const frames = manualFrames();
    let depth = 0;
    let deepest = 0;
    let reports = 0;
    const coalescer = createChangeCoalescer(() => {
      reports += 1;
      depth += 1;
      deepest = Math.max(deepest, depth);
      if (reports < 3) coalescer.changed();
      depth -= 1;
    }, frames);

    coalescer.changed();
    frames.next();
    frames.next();

    expect(deepest).toBe(1);
    expect(reports).toBe(3);
  });

  it('reports what is owed when the page is hidden, where no frame will come', () => {
    // A frame never runs in a hidden tab. The end of a drag was owed to one, so
    // a tab switched away from and then discarded kept where the drag began.
    const frames = manualFrames();
    let reports = 0;
    const coalescer = createChangeCoalescer(() => {
      reports += 1;
    }, frames);

    coalescer.changed();
    coalescer.changed();
    coalescer.flush();

    expect(reports).toBe(2);
    expect(frames.waiting()).toBe(0);

    // Nothing is reported twice when the frame would have come after all.
    frames.next();
    expect(reports).toBe(2);

    // And the next change starts a burst of its own.
    coalescer.changed();
    expect(reports).toBe(3);
  });

  it('owes a change its flushed report provokes, rather than reporting it inside the flush', () => {
    const frames = manualFrames();
    let depth = 0;
    let deepest = 0;
    let reports = 0;
    const coalescer = createChangeCoalescer(() => {
      reports += 1;
      depth += 1;
      deepest = Math.max(deepest, depth);
      if (reports === 2) coalescer.changed();
      depth -= 1;
    }, frames);

    coalescer.changed();
    coalescer.changed();
    coalescer.flush();
    frames.next();

    expect(deepest).toBe(1);
    expect(reports).toBe(3);
  });

  it('reports nothing on a flush with nothing owed', () => {
    const frames = manualFrames();
    let reports = 0;
    const coalescer = createChangeCoalescer(() => {
      reports += 1;
    }, frames);

    coalescer.flush();
    coalescer.changed();
    coalescer.flush();

    expect(reports).toBe(1);
  });

  it('reports nothing once stopped, and leaves no frame behind', () => {
    // A frame pending when the dock was remounted measured an engine that had
    // been disposed, and reported an all-centre arrangement into the next
    // workspace.
    const frames = manualFrames();
    let reports = 0;
    const coalescer = createChangeCoalescer(() => {
      reports += 1;
    }, frames);

    coalescer.changed();
    coalescer.changed();
    coalescer.stop();

    expect(frames.waiting()).toBe(0);
    frames.next();
    coalescer.changed();
    coalescer.flush();
    expect(reports).toBe(1);
  });
});
