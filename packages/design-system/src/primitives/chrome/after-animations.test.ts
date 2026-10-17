import { describe, expect, it, vi } from 'vitest';

import { afterAnimations } from './after-animations.js';

/** An element whose running animations are those given. */
function animating(...finished: Promise<unknown>[]): Element {
  const element = document.createElement('div');
  Object.defineProperty(element, 'getAnimations', {
    value: () => finished.map((done) => ({ finished: done })),
  });
  return element;
}

describe('afterAnimations', () => {
  it('goes at once where nothing is animating', () => {
    const then = vi.fn();

    afterAnimations(document.createElement('div'), then);

    expect(then).toHaveBeenCalledOnce();
  });

  it('waits for every animation to finish', async () => {
    let finishFirst: () => void = () => undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = Promise.resolve();
    const then = vi.fn();

    afterAnimations(animating(first, second), then);
    await second;
    expect(then).not.toHaveBeenCalled();

    finishFirst();
    await vi.waitFor(() => {
      expect(then).toHaveBeenCalledOnce();
    });
  });

  it('goes when an animation is cancelled, which ends it as surely as finishing', async () => {
    const then = vi.fn();

    afterAnimations(animating(Promise.reject(new Error('cancelled'))), then);

    await vi.waitFor(() => {
      expect(then).toHaveBeenCalledOnce();
    });
  });

  it('does not go once it is told not to, as when the element is shown again', async () => {
    const finished = Promise.resolve();
    const then = vi.fn();

    const stop = afterAnimations(animating(finished), then);
    stop();
    await finished;
    await Promise.resolve();

    expect(then).not.toHaveBeenCalled();
  });
});
