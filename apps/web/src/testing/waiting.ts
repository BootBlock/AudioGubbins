/**
 * How often `vi.waitFor` asks again: every millisecond, where it asks every
 * fifty by default.
 *
 * What these tests wait for is a promise the code under test settles within a
 * turn or two of the task queue, so the first check nearly always comes too
 * soon, and at the default the second came fifty milliseconds later for every
 * wait. The timeout is left as it is, so a wait gives up no sooner.
 */
export const PROMPTLY = { interval: 1 } as const;

/**
 * Lets everything already queued run, to a turn of the task queue.
 *
 * A turn of the task queue rather than a count of microtask turns: counted, the
 * count would be right for the number of awaits the code under test holds today
 * and silently short the moment one more is added.
 */
export async function everythingQueued(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
