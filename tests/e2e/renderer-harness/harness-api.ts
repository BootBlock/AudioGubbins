/**
 * What the renderer harness page offers the renderer suites, on `window` under
 * {@link HARNESS_GLOBAL}: the page and the suites take the shape from here, so
 * the two cannot disagree on it unseen.
 */

import type { RendererKind, RendererReport } from '../../../packages/renderer/src/index.js';

/** The name the harness is given on `window`. */
export const HARNESS_GLOBAL = 'agRendererHarness';

/**
 * The textures the renderer holds for fields, as the page's own WebGPU and
 * WebGL2 objects were asked for them: one-byte textures, which only a field is
 * uploaded as. A texture of a lost device or context, or one released, is no
 * longer held.
 */
export interface FieldTextures {
  /** Field textures made since the page loaded, and their bytes. */
  readonly made: number;
  readonly madeBytes: number;
  /** Field textures held now, and their bytes. */
  readonly held: number;
  readonly heldBytes: number;
}

/** A tile of the long field the budget is read under, in cells. */
export const TILE = { width: 128, height: 64 } as const;

export interface RendererHarness {
  /** The kinds of backend this browser can draw with, each made alone and asked to draw. */
  offered(): Promise<readonly RendererKind[]>;

  /**
   * Starts a renderer on the surface, in place of any before it, with the
   * backends from `kind` on in the renderer's order, so a backend that fails
   * steps down as the editor's does, each holding field textures within
   * `budget` bytes where one is given.
   */
  open(kind: RendererKind, budget?: number): Promise<RendererReport>;

  /** What the renderer says of itself now. */
  report(): RendererReport;

  /** Draws the field of `field-pattern.ts`. */
  drawPattern(): void;

  /**
   * Draws `count` tiles of a long field, from tile `first`, side by side across
   * the surface, each a field of its own key, and answers the field textures
   * once the frame is drawn.
   */
  drawTiles(first: number, count: number): FieldTextures;

  /** The field textures held and made so far. */
  fieldTextures(): FieldTextures;

  /** How many canvases the Canvas 2D backend has asked for to compose fields on. */
  composingCanvases(): number;
}
