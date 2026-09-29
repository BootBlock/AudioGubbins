/**
 * The renderer: the backend it draws with, how it came to be chosen, and what
 * happens when the device or context behind it is lost (ADR-0044).
 *
 * It tries its backends in order, WebGPU, WebGL2 and Canvas 2D in production,
 * each on a fresh canvas since a canvas takes one kind of context for life, and
 * draws with the first that is made. What it tried and why each was or was not
 * taken is its report, which the application shows among the capabilities and
 * records in the diagnostic log (REQ-AUDIO-152's renderer capability
 * diagnostics). A backend whose device is lost is given the chance to recover;
 * one that fails is replaced by the next kind. It keeps the latest frame, the
 * whole of what the screen shows, and draws it again whenever a backend
 * recovers or takes over, so nothing the editor holds is lost with the graphics
 * (REQ-AUDIO-152).
 */

import type { Painter } from './canvas-painting.js';
import { paintOverlay } from './canvas-painting.js';
import type { RenderFrame } from './render-frame.js';
import type { BackendFactory, RendererBackend, RendererKind } from './renderer-backend.js';

/** Where a renderer draws: a geometry canvas it may replace, and the overlay above it. */
export interface RenderSurface {
  /** A new canvas for the geometry, which takes the place of any before it. */
  freshCanvas(): HTMLCanvasElement;
  /** The Canvas 2D context of the overlay, or `undefined` where the browser gives none. */
  overlay(): Painter | undefined;
}

/** What became of one backend the renderer tried. */
export interface RendererAttempt {
  readonly kind: RendererKind;
  readonly outcome: 'active' | 'refused' | 'lost' | 'failed';
  readonly reason?: string;
}

/** Where the renderer is. */
export const RendererState = {
  Starting: 'starting',
  Drawing: 'drawing',
  /** The device or context is lost and may come back. */
  Recovering: 'recovering',
  /** No backend could be made. */
  Unavailable: 'unavailable',
} as const;

export type RendererState = (typeof RendererState)[keyof typeof RendererState];

/** What the renderer tried, what it draws with, and what it has recovered from. */
export interface RendererReport {
  readonly state: RendererState;
  readonly active: RendererKind | undefined;
  readonly attempts: readonly RendererAttempt[];
  readonly losses: number;
  readonly recoveries: number;
}

/** Draws frames through the best backend it can make. */
export class Renderer {
  readonly #surface: RenderSurface;
  readonly #backends: readonly BackendFactory[];
  readonly #listeners = new Set<(report: RendererReport) => void>();
  #report: RendererReport = {
    state: RendererState.Starting,
    active: undefined,
    attempts: [],
    losses: 0,
    recoveries: 0,
  };
  #backend: RendererBackend | undefined;
  #latest: RenderFrame | undefined;
  #disposed = false;

  constructor(options: {
    readonly surface: RenderSurface;
    readonly backends: readonly BackendFactory[];
  }) {
    this.#surface = options.surface;
    this.#backends = options.backends;
  }

  get report(): RendererReport {
    return this.#report;
  }

  subscribe(listener: (report: RendererReport) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #update(change: Partial<RendererReport>): void {
    this.#report = { ...this.#report, ...change };
    for (const listener of [...this.#listeners]) listener(this.#report);
  }

  #attempt(attempt: RendererAttempt): void {
    this.#update({ attempts: [...this.#report.attempts, attempt] });
  }

  /** Makes the first backend it can, from `from` in its order on. */
  async start(from = 0): Promise<void> {
    for (let index = from; index < this.#backends.length; index += 1) {
      const factory = this.#backends[index];
      if (factory === undefined || this.#disposed) return;
      const made = await factory.create(this.#surface.freshCanvas(), {
        lost: (reason) => {
          this.#lost(factory.kind, reason);
        },
        restored: () => {
          this.#restored(factory.kind);
        },
        failed: (reason) => {
          void this.#failed(factory.kind, index, reason);
        },
      });
      // Disposed while the backend was being made, by a view that went away.
      if (this.#stopped()) {
        if (made.ok) made.value.dispose();
        return;
      }
      if (made.ok) {
        this.#backend = made.value;
        this.#attempt({ kind: factory.kind, outcome: 'active' });
        this.#update({ state: RendererState.Drawing, active: factory.kind });
        this.#redraw();
        return;
      }
      this.#attempt({ kind: factory.kind, outcome: 'refused', reason: made.failures[0].summary });
    }
    this.#update({ state: RendererState.Unavailable, active: undefined });
  }

  #stopped(): boolean {
    return this.#disposed;
  }

  #lost(kind: RendererKind, reason: string): void {
    if (this.#report.active !== kind) return;
    this.#attempt({ kind, outcome: 'lost', reason });
    this.#update({ state: RendererState.Recovering, losses: this.#report.losses + 1 });
  }

  #restored(kind: RendererKind): void {
    if (this.#report.active !== kind) return;
    this.#update({ state: RendererState.Drawing, recoveries: this.#report.recoveries + 1 });
    this.#redraw();
  }

  /** A backend gone for good: the next kind takes over, and draws the latest frame. */
  async #failed(kind: RendererKind, index: number, reason: string): Promise<void> {
    if (this.#report.active !== kind) return;
    this.#backend?.dispose();
    this.#backend = undefined;
    this.#attempt({ kind, outcome: 'failed', reason });
    this.#update({ state: RendererState.Recovering, active: undefined });
    await this.start(index + 1);
    if (this.#report.state === RendererState.Drawing) {
      this.#update({ recoveries: this.#report.recoveries + 1 });
    }
  }

  /** Draws `frame`, and keeps it to draw again after a recovery. */
  draw(frame: RenderFrame): void {
    this.#latest = frame;
    this.#redraw();
  }

  #redraw(): void {
    const frame = this.#latest;
    if (frame === undefined || this.#backend === undefined) return;
    if (!this.#backend.draw(frame)) return;
    const overlay = this.#surface.overlay();
    if (overlay !== undefined) paintOverlay(overlay, frame);
  }

  dispose(): void {
    this.#disposed = true;
    this.#backend?.dispose();
    this.#backend = undefined;
    this.#listeners.clear();
  }
}
