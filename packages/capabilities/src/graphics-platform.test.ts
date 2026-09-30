import { afterEach, describe, expect, it } from 'vitest';

import { readGraphicsPlatform } from './graphics-platform.js';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const originalRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');

/** Who listens to which query, and the ratio the screen has. */
let listeners: { query: string; notify: () => void }[] = [];
let ratio = 1;

afterEach(() => {
  if (originalMatchMedia !== undefined) {
    Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  }
  if (originalRatio !== undefined) Object.defineProperty(window, 'devicePixelRatio', originalRatio);
  listeners = [];
  ratio = 1;
});

/** A screen whose ratio the test moves, answering resolution queries by it. */
function screenAt(initial: number): void {
  ratio = initial;
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => ratio });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      get matches() {
        return query === `(resolution: ${String(ratio)}dppx)`;
      },
      media: query,
      addEventListener: (_: string, notify: () => void) => listeners.push({ query, notify }),
      removeEventListener: (_: string, notify: () => void) => {
        listeners = listeners.filter((one) => one.notify !== notify);
      },
    }),
  });
}

/** Moves the window to a screen of another ratio, as the browser tells it. */
function moveTo(next: number): void {
  ratio = next;
  for (const listener of [...listeners]) listener.notify();
}

describe('the graphics platform', () => {
  it('reads the pixel ratio the browser gives', () => {
    screenAt(1.25);

    expect(readGraphicsPlatform().pixelRatio()).toBe(1.25);
  });

  it('reads a ratio that is not a usable number as one', () => {
    screenAt(Number.NaN);

    expect(readGraphicsPlatform().pixelRatio()).toBe(1);
  });

  it('says each change of ratio, and watches the new one', () => {
    screenAt(1);
    const heard: number[] = [];
    const stop = readGraphicsPlatform().watchPixelRatio((next) => heard.push(next));

    moveTo(2);
    moveTo(1.5);

    expect(heard).toEqual([2, 1.5]);
    expect(listeners.map((one) => one.query)).toEqual(['(resolution: 1.5dppx)']);
    stop();
    expect(listeners).toEqual([]);
  });

  it('gives the WebGPU entry point as it is, for the renderer to check', () => {
    const gpu = { requestAdapter: () => Promise.resolve(null) };
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: gpu });
    try {
      expect(readGraphicsPlatform().gpu).toBe(gpu);
    } finally {
      Reflect.deleteProperty(navigator, 'gpu');
    }
  });
});
