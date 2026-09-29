/**
 * What the machine has left for AudioGubbins to use, where the browser says
 * (REQ-ARCH-087).
 *
 * The engine plans work around measured resources rather than fixed limits,
 * and this is where they are measured: here, beside every other question put
 * to the browser, so no other package reads a global to find out.
 *
 * Memory is the page's own heap: what it may still take before the browser
 * refuses it, which is the memory a render's output is gathered in. Only
 * Chromium reports it, through the non-standard `performance.memory`, so it is
 * read through `Reflect` and every value is checked rather than trusted. Where
 * the browser does not say, the answer is `undefined`, never a guess: a plan
 * then warns of nothing it cannot know, and still runs in chunks.
 */

/** What the machine has left, as far as the browser says. */
export interface ResourceFigures {
  /** Bytes the page's heap may still grow by, or `undefined` where the browser does not say. */
  readonly availableMemoryBytes: number | undefined;
}

function byteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The heap's limit less what is in use, or `undefined` where either is not
 * reported. Read afresh on each call, since what is in use moves.
 */
function heapAvailable(performanceLike: object): number | undefined {
  const memory: unknown = Reflect.get(performanceLike, 'memory');
  if (typeof memory !== 'object' || memory === null) return undefined;
  const limit = byteCount(Reflect.get(memory, 'jsHeapSizeLimit'));
  const used = byteCount(Reflect.get(memory, 'usedJSHeapSize'));
  if (limit === undefined || used === undefined) return undefined;
  return Math.max(0, limit - used);
}

/**
 * What the machine has left now, read from the page's `performance`.
 *
 * Given `performance` rather than reading the global, as `readLayoutMap` is
 * given `navigator`, so the application decides when to ask and a test hands
 * in what a browser would report.
 */
export function readResourceFigures(performanceLike: object): ResourceFigures {
  try {
    return { availableMemoryBytes: heapAvailable(performanceLike) };
  } catch (error) {
    // A hardened browser may make reading the property throw rather than
    // answer, which says as much as its absence: nothing is known.
    if (error instanceof DOMException || error instanceof TypeError) {
      return { availableMemoryBytes: undefined };
    }
    throw error;
  }
}
