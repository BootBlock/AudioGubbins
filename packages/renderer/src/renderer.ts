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
import {
  DRAWN,
  type BackendFactory,
  type DrawOutcome,
  type RendererBackend,
  type RendererKind,
} from './renderer-backend.js';

/** What a surface tells its renderer of the overlay's context. */
export interface OverlayEvents {
  /** The context is lost, and painting it does nothing until it is restored. */
  readonly lost: () => void;
  /** It is back, and blank. */
  readonly restored: () => void;
}

/**
 * Where a renderer draws: a geometry canvas it may replace, and the overlay
 * above it. The overlay is a Canvas 2D context the browser can take away as it
 * takes the geometry's, in the same GPU process crash and not necessarily in
 * the same order, so the surface says when the overlay is lost and given back.
 */
export interface RenderSurface {
  /** A new canvas for the geometry, which takes the place of any before it. */
  freshCanvas(): HTMLCanvasElement;
  /** The Canvas 2D context of the overlay, or `undefined` where the browser gives none. */
  overlay(): Painter | undefined;
  /** Tells `events` when the overlay's context is lost and given back, until the answer is called. */
  watchOverlay(events: OverlayEvents): () => void;
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
  #backend: { readonly made: RendererBackend; readonly index: number } | undefined;
  #latest: RenderFrame | undefined;
  #disposed = false;
  #overlayLost = false;
  readonly #stopWatchingOverlay: () => void;

  constructor(options: {
    readonly surface: RenderSurface;
    readonly backends: readonly BackendFactory[];
  }) {
    this.#surface = options.surface;
    this.#backends = options.backends;
    this.#stopWatchingOverlay = options.surface.watchOverlay({
      lost: () => {
        this.#overlayLost = true;
      },
      restored: () => {
        this.#overlayLost = false;
        // The geometry's own recovery paints the overlay with it.
        if (this.#report.state === RendererState.Drawing) this.#paintOverlay();
      },
    });
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

  /**
   * Makes the first backend it can, from `from` in its order on, and draws the
   * latest frame with it. A backend that is made and cannot draw that frame is
   * not taken: it is reported as failed, and the next is tried.
   */
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
          void this.#failed(factory.kind, reason);
        },
      });
      // Disposed while the backend was being made, by a view that went away.
      if (this.#stopped()) {
        if (made.ok) made.value.dispose();
        return;
      }
      if (!made.ok) {
        this.#attempt({ kind: factory.kind, outcome: 'refused', reason: made.failures[0].summary });
        continue;
      }
      this.#backend = { made: made.value, index };
      const outcome = this.#paint();
      if (outcome.kind === 'failed') {
        this.#backend = undefined;
        made.value.dispose();
        this.#attempt({ kind: factory.kind, outcome: 'failed', reason: outcome.reason });
        continue;
      }
      this.#attempt({ kind: factory.kind, outcome: 'active' });
      this.#update({
        state: outcome.kind === 'away' ? RendererState.Recovering : RendererState.Drawing,
        active: factory.kind,
      });
      return;
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

  /**
   * A backend back from a loss: recovered once it has drawn the latest frame
   * again, and failed, as any backend that cannot draw is, if it cannot.
   */
  #restored(kind: RendererKind): void {
    if (this.#report.active !== kind) return;
    const outcome = this.#paint();
    if (outcome.kind === 'failed') {
      void this.#failed(kind, outcome.reason);
      return;
    }
    // Lost again before it drew: its backend says so, and says when it is back.
    if (outcome.kind === 'away') return;
    this.#update({ state: RendererState.Drawing, recoveries: this.#report.recoveries + 1 });
  }

  /** A backend gone for good: the next kind takes over, and draws the latest frame. */
  async #failed(kind: RendererKind, reason: string): Promise<void> {
    const current = this.#backend;
    if (this.#report.active !== kind || current === undefined) return;
    current.made.dispose();
    this.#backend = undefined;
    this.#attempt({ kind, outcome: 'failed', reason });
    this.#update({ state: RendererState.Recovering, active: undefined });
    await this.start(current.index + 1);
    if (this.#report.state === RendererState.Drawing) {
      this.#update({ recoveries: this.#report.recoveries + 1 });
    }
  }

  /**
   * Draws `frame`, and keeps it to draw again after a recovery. While the
   * device is away it is only kept; a backend that cannot draw it is replaced
   * by the next kind, which draws it.
   */
  draw(frame: RenderFrame): void {
    this.#latest = frame;
    const kind = this.#report.active;
    if (this.#report.state !== RendererState.Drawing || kind === undefined) return;
    const outcome = this.#paint();
    if (outcome.kind === 'failed') void this.#failed(kind, outcome.reason);
  }

  /**
   * Draws the latest frame's geometry with the backend, and its text and images
   * on the overlay once the geometry is drawn; answers what became of the
   * geometry. Nothing to draw, or nothing to draw it with, fails nothing.
   */
  #paint(): DrawOutcome {
    const frame = this.#latest;
    const backend = this.#backend;
    if (frame === undefined || backend === undefined) return DRAWN;
    const outcome = backend.made.draw(frame);
    if (outcome.kind === 'drawn') this.#paintOverlay();
    return outcome;
  }

  /** Paints the latest frame's text and images on the overlay, where it has its context. */
  #paintOverlay(): void {
    const frame = this.#latest;
    const overlay = this.#overlayLost ? undefined : this.#surface.overlay();
    if (frame !== undefined && overlay !== undefined) paintOverlay(overlay, frame);
  }

  dispose(): void {
    this.#disposed = true;
    this.#stopWatchingOverlay();
    this.#backend?.made.dispose();
    this.#backend = undefined;
    this.#listeners.clear();
  }
}
