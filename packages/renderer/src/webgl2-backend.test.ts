/**
 * The WebGL2 backend's loss and recovery, against a context that records what
 * it is asked and a schedule the test runs by hand, so a context taken away,
 * given back, never given back or given back unable to be rebuilt is each
 * driven on demand. What it draws is read in a real browser by the renderer
 * suites under `tests/e2e`.
 */

import { describe, expect, it } from 'vitest';

import type { BackendEvents, RendererBackend, Schedule } from './renderer-backend.js';
import { webGl2Backend } from './webgl2-backend.js';

/**
 * The state of a WebGL2 context: whether it is lost, whether its shaders
 * compile, and what it has built and drawn. Every call the backend makes that
 * this does not name answers a fresh object, which is all a handle is to it.
 */
class GlState {
  lost = false;
  compiles = true;
  linked = 0;
  draws = 0;
  error = 0;
  readonly NO_ERROR = 0;
  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  isContextLost(): boolean {
    return this.lost;
  }

  getShaderParameter(): boolean {
    return this.compiles;
  }

  getShaderInfoLog(): string {
    return 'The shader did not compile.';
  }

  getProgramParameter(): boolean {
    return true;
  }

  linkProgram(): void {
    this.linked += 1;
  }

  drawArraysInstanced(): void {
    this.draws += 1;
  }

  getError(): number {
    return this.error;
  }

  getExtension(): undefined {
    return undefined;
  }
}

/** A canvas whose WebGL2 context is `state`, and the events a backend on it sends. */
function glCanvas() {
  const canvas = document.createElement('canvas');
  const state = new GlState(canvas);
  const context = new Proxy(state, {
    get: (target, name): unknown =>
      name in target ? Reflect.get(target, name) : (): object => ({ name }),
  }) as unknown as WebGL2RenderingContext;
  canvas.getContext = ((kind: string) =>
    kind === 'webgl2' ? context : null) as HTMLCanvasElement['getContext'];
  const said: string[] = [];
  const events: BackendEvents = {
    lost: (reason) => said.push(`lost: ${reason}`),
    restored: () => said.push('restored'),
    failed: (reason) => said.push(`failed: ${reason}`),
  };
  return { canvas, state, events, said };
}

/** A schedule the test runs by hand: what waits, and running it. */
function manualSchedule() {
  const waiting = new Set<{ readonly callback: () => void; readonly delayMs: number }>();
  const schedule: Schedule = (callback, delayMs) => {
    const entry = { callback, delayMs };
    waiting.add(entry);
    return () => {
      waiting.delete(entry);
    };
  };
  const run = (): void => {
    for (const entry of [...waiting]) {
      waiting.delete(entry);
      entry.callback();
    }
  };
  return { schedule, waiting, run };
}

async function made(
  canvas: HTMLCanvasElement,
  events: BackendEvents,
  schedule: Schedule,
): Promise<RendererBackend> {
  const result = await webGl2Backend(schedule).create(canvas, events);
  if (!result.ok) throw new Error(result.failures[0].summary);
  return result.value;
}

function lose(canvas: HTMLCanvasElement, state: GlState): Event {
  state.lost = true;
  const event = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(event);
  return event;
}

function restore(canvas: HTMLCanvasElement, state: GlState): void {
  state.lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
}

describe('the WebGL2 backend losing its context', () => {
  it('asks for the context back, and waits for it by the schedule it is given', async () => {
    const { canvas, state, events, said } = glCanvas();
    const timers = manualSchedule();
    await made(canvas, events, timers.schedule);

    const event = lose(canvas, state);

    expect(event.defaultPrevented).toBe(true);
    expect(said).toEqual(['lost: The browser took the WebGL2 context away.']);
    expect([...timers.waiting].map((entry) => entry.delayMs)).toEqual([3000]);
    timers.run();
    expect(said.at(-1)).toBe('failed: The WebGL2 context was not given back within 3 seconds.');
  });

  it('rebuilds on the context given back, calls off the wait, and says it is restored', async () => {
    const { canvas, state, events, said } = glCanvas();
    const timers = manualSchedule();
    await made(canvas, events, timers.schedule);

    lose(canvas, state);
    restore(canvas, state);

    expect(said.at(-1)).toBe('restored');
    expect(timers.waiting.size).toBe(0);
    expect(state.linked).toBe(2);
  });

  it('fails when the context given back cannot be rebuilt', async () => {
    const { canvas, state, events, said } = glCanvas();
    const timers = manualSchedule();
    await made(canvas, events, timers.schedule);

    lose(canvas, state);
    state.compiles = false;
    restore(canvas, state);

    expect(said.at(-1)).toBe(
      'failed: The WebGL2 context came back and could not be rebuilt: The shader did not compile.',
    );
  });
});
