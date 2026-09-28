import { describe, expect, it, vi } from 'vitest';

import type { LayoutMapPairs } from '@audiogubbins/capabilities';

import { PROMPTLY } from '../testing/waiting.js';
import { adoptLayoutMapOnReturn, type PageVisibility } from './layout-map-watch.js';

/**
 * Reading the layout map again when the user comes back.
 *
 * Read only once, at start-up, the map would leave a user who changed keyboard
 * layout while AudioGubbins ran with a mixture of the old map and the keys they
 * had typed since.
 */

/** A page a test says the state of, and whose listeners it fires. */
function page(): PageVisibility & {
  visible: boolean;
  fire: (event: 'visibilitychange' | 'focus') => void;
  listening: () => number;
} {
  const handlers = new Map<string, Set<() => void>>();
  const state = {
    visible: true,
    isVisible: () => state.visible,
    listen: (event: string, handler: () => void) => {
      const forEvent = handlers.get(event) ?? new Set<() => void>();
      forEvent.add(handler);
      handlers.set(event, forEvent);
      return () => {
        forEvent.delete(handler);
      };
    },
    fire: (event: string) => {
      for (const handler of [...(handlers.get(event) ?? [])]) handler();
    },
    listening: () => [...handlers.values()].reduce((total, each) => total + each.size, 0),
  };
  return state;
}

describe('adopting the layout map again when the user returns', () => {
  it('reads it and adopts it when the page becomes visible', async () => {
    const adopt = vi.fn();
    const pairs: LayoutMapPairs = [['KeyV', 'k']];
    const read = vi.fn(() => Promise.resolve(pairs));
    const surface = page();

    adoptLayoutMapOnReturn({ adopt }, read, () => undefined, surface);
    surface.fire('visibilitychange');
    await vi.waitFor(() => {
      expect(adopt).toHaveBeenCalledWith(pairs);
    }, PROMPTLY);
  });

  it('reads nothing while the page is hidden', () => {
    // `visibilitychange` fires when the page is hidden as well as when it is
    // shown, and asking a hidden page is asking about a keyboard nobody is at.
    const read = vi.fn(() => Promise.resolve([]));
    const surface = page();
    surface.visible = false;

    adoptLayoutMapOnReturn({ adopt: vi.fn() }, read, () => undefined, surface);
    surface.fire('visibilitychange');
    surface.fire('focus');

    expect(read).not.toHaveBeenCalled();
  });

  it('asks once for a return that fires both events', async () => {
    // Coming back to the tab fires `focus` and `visibilitychange` together.
    let settle = (): void => undefined;
    const read = vi.fn(
      () =>
        new Promise<LayoutMapPairs>((resolve) => {
          settle = () => {
            resolve([]);
          };
        }),
    );
    const adopt = vi.fn();
    const surface = page();

    adoptLayoutMapOnReturn({ adopt }, read, () => undefined, surface);
    surface.fire('visibilitychange');
    surface.fire('focus');

    expect(read).toHaveBeenCalledTimes(1);

    // And again once the first has answered, so the guard is a guard rather
    // than a single reading for the life of the page. The first reading is
    // over once its answer is adopted, so that is what is waited for.
    settle();
    await vi.waitFor(() => {
      expect(adopt).toHaveBeenCalledOnce();
    }, PROMPTLY);
    surface.fire('focus');
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
    }, PROMPTLY);
  });

  it('says why when the map cannot be read, and asks again next time', async () => {
    const onProblem = vi.fn();
    const read = vi
      .fn<() => Promise<LayoutMapPairs>>()
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValue([]);
    const surface = page();

    adoptLayoutMapOnReturn({ adopt: vi.fn() }, read, onProblem, surface);
    surface.fire('focus');
    await vi.waitFor(() => {
      expect(onProblem).toHaveBeenCalledOnce();
    }, PROMPTLY);

    surface.fire('focus');
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2);
    }, PROMPTLY);
  });

  it('stops watching when it is told to', () => {
    const surface = page();

    const stop = adoptLayoutMapOnReturn(
      { adopt: vi.fn() },
      () => Promise.resolve([]),
      () => undefined,
      surface,
    );
    expect(surface.listening()).toBe(2);

    stop();

    expect(surface.listening()).toBe(0);
  });
});
