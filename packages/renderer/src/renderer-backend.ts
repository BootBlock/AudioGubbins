/**
 * What a backend is: something that draws a frame's geometry on a canvas it was
 * given, and says when it has lost the device or context it draws with.
 *
 * A backend keeps GPU resources between frames and no content (ADR-0044). A
 * canvas takes one kind of context for life, so the renderer gives each backend
 * a canvas of its own and makes a new one when it steps down to another kind.
 */

import type { DomainResult } from '@audiogubbins/domain';

import type { RenderFrame } from './render-frame.js';

/** The kinds of backend, in the order the renderer tries them. */
export const RendererKind = {
  WebGpu: 'webgpu',
  WebGl2: 'webgl2',
  Canvas2d: 'canvas-2d',
} as const;

export type RendererKind = (typeof RendererKind)[keyof typeof RendererKind];

/** What a backend tells the renderer about its device or context. */
export interface BackendEvents {
  /** The device or context is lost; drawing does nothing until it is restored. */
  readonly lost: (reason: string) => void;
  /** It is back and rebuilt; the latest frame should be drawn again. */
  readonly restored: () => void;
  /** It is gone for good, and the renderer should step down to the next kind. */
  readonly failed: (reason: string) => void;
}

/**
 * What became of one draw: drawn; not drawn because the device or context is
 * away, which the backend's `lost` and `restored` events say of it; or failed,
 * with the reason, by a backend that cannot draw until it is made again.
 */
export type DrawOutcome =
  | { readonly kind: 'drawn' }
  | { readonly kind: 'away' }
  | { readonly kind: 'failed'; readonly reason: string };

/** A draw that was made. */
export const DRAWN: DrawOutcome = { kind: 'drawn' };

/** A draw that waits on a device or context that is away. */
export const AWAY: DrawOutcome = { kind: 'away' };

/** A draw its backend cannot make, and why. */
export function drawFailed(reason: string): DrawOutcome {
  return { kind: 'failed', reason };
}

/** Draws a frame's rectangles, segments and fields on its canvas. */
export interface RendererBackend {
  readonly kind: RendererKind;
  /** Draws `frame`, sizing the canvas to it, and answers what became of it. */
  draw(frame: RenderFrame): DrawOutcome;
  /** Frees its resources; the canvas is its renderer's to remove. */
  dispose(): void;
}

/**
 * Calls `callback` after `delayMs`, and answers how to call it off. A backend
 * that waits takes this rather than the page's timers, which the renderer does
 * not read (ADR-0044), so a test decides when the wait is over.
 */
export type Schedule = (callback: () => void, delayMs: number) => () => void;

/** Makes a backend of one kind on a canvas, or says why it cannot. */
export interface BackendFactory {
  readonly kind: RendererKind;
  create(canvas: HTMLCanvasElement, events: BackendEvents): Promise<DomainResult<RendererBackend>>;
}
