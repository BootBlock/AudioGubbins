/**
 * A frame to draw, as a value (ADR-0044).
 *
 * The view composes a whole frame from its state each time it draws, so a frame
 * is everything the screen shows and nothing the renderer remembers: a lost
 * device is recovered by drawing the next frame, and no editor state lives only
 * in the graphics (REQ-AUDIO-152). Geometry is rectangles and line segments in
 * CSS pixels, packed into typed arrays the composer reuses from frame to frame
 * (G4); text and images are drawn above all geometry. Layers draw in order,
 * each clipped to its rectangle.
 */

/** A colour as straight red, green, blue and alpha, each from 0 to 1. */
export type Colour = readonly [number, number, number, number];

/** A rectangle in CSS pixels. */
export interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Filled rectangles of one colour: `x, y, width, height` per rectangle, `count` of them used. */
export interface RectangleBatch {
  readonly kind: 'rectangles';
  readonly colour: Colour;
  readonly values: Float32Array;
  readonly count: number;
}

/** Line segments of one colour and width: `x0, y0, x1, y1` per segment, `count` of them used. */
export interface SegmentBatch {
  readonly kind: 'segments';
  readonly colour: Colour;
  /** The width in CSS pixels. */
  readonly width: number;
  readonly values: Float32Array;
  readonly count: number;
}

/** A line of text. */
export interface TextLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly colour: Colour;
  /** A CSS font shorthand, such as the theme's `12px system-ui`. */
  readonly font: string;
  readonly align: 'left' | 'centre' | 'right';
  readonly baseline: 'top' | 'middle' | 'bottom';
}

/** Text, drawn above every rectangle and segment. */
export interface TextBatch {
  readonly kind: 'text';
  readonly labels: readonly TextLabel[];
}

/** An image the browser has decoded, as a canvas draws one. */
export interface PlacedImage {
  readonly image: CanvasImageSource;
  readonly at: Rectangle;
}

/** Images, drawn above every rectangle and segment and below text. */
export interface ImageBatch {
  readonly kind: 'images';
  readonly images: readonly PlacedImage[];
}

export type RenderBatch = RectangleBatch | SegmentBatch | TextBatch | ImageBatch;

/** Batches drawn in order within a clip. */
export interface RenderLayer {
  /** Where the layer may draw; the whole frame where absent. */
  readonly clip?: Rectangle;
  readonly batches: readonly RenderBatch[];
}

/** Everything a canvas shows. */
export interface RenderFrame {
  /** The size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Device pixels to a CSS pixel, which the backing store is sized by. */
  readonly pixelRatio: number;
  readonly clear: Colour;
  readonly layers: readonly RenderLayer[];
}

/** The backing store's size in device pixels for a frame. */
export function backingSize(frame: RenderFrame): {
  readonly width: number;
  readonly height: number;
} {
  return {
    width: Math.max(1, Math.round(frame.width * frame.pixelRatio)),
    height: Math.max(1, Math.round(frame.height * frame.pixelRatio)),
  };
}
