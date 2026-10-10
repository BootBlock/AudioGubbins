/**
 * A frame to draw, as a value (ADR-0044).
 *
 * The view composes a whole frame from its state each time it draws, so a frame
 * is everything the screen shows and nothing the renderer remembers: a lost
 * device is recovered by drawing the next frame, and no editor state lives only
 * in the graphics (REQ-AUDIO-152). Geometry is rectangles and line segments in
 * CSS pixels, packed into typed arrays the composer reuses from frame to frame
 * (G4); a field is drawn among them, in device pixels, through a colour ramp
 * (ADR-0082); text and images are drawn above all geometry. Layers draw in
 * order, each clipped to its rectangle.
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

/**
 * A grid of bytes, such as a tile of a spectrogram's magnitudes: `values` holds
 * `width` times `height` cells, row by row, the cell of `row` and `column` at
 * `values[row * width + column]`. Neither side may reach 2^24.
 *
 * `key` names the values. A backend may keep what it made of a field under its
 * key and draw the same key again without reading the values, so a caller
 * that changes the values must change the key: the same key always carries the
 * same width, height and values.
 */
export interface ScalarField {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array<ArrayBuffer>;
}

/**
 * The colours a field's bytes are drawn in: 256 entries of straight red, green,
 * blue and alpha, a byte each, so the byte `v` is drawn in the four bytes from
 * `colours[v * 4]`. `colours` holds exactly 1024 bytes. `key` names the colours
 * as a field's key names its values, and a caller that changes the colours
 * changes the key.
 */
export interface ColourRamp {
  readonly key: string;
  readonly colours: Uint8Array<ArrayBuffer>;
}

/**
 * A field drawn across a rectangle (ADR-0082), in device pixels, which every
 * backend paints alike:
 *
 * - It paints the device pixels whose centres lie inside `at`, inside its
 *   layer's clip where there is one, and on the canvas. A centre lies inside a
 *   rectangle when it is at or after the near edge and before the far one, so
 *   the device column `i` is inside from `x` to `x + width` when
 *   `x <= (i + 0.5) / pixelRatio < x + width`, and a row likewise. A field's
 *   clip is by pixel centres, never by coverage.
 * - A painted pixel reads the field column `floor(c)`, where `c` is the column
 *   coordinate at its centre: `columns.from` at `at`'s left edge and
 *   `columns.to` at its right, linearly between. A column outside
 *   `[0, field.width)` paints nothing.
 * - `rows` holds the field row each device row reads, top to bottom, from the
 *   first device row whose centre lies inside `at`, as though nothing clipped
 *   it. A device row reads the field row `floor(rows[k])`, and paints nothing
 *   where that is outside `[0, field.height)`, such as the -1 a caller writes
 *   for a row with no field row. Entries past the rectangle's last row are
 *   never read, and a row with no entry paints nothing. The caller computes
 *   them, from whatever frequency axis the rows show; no backend resamples
 *   rows of its own accord.
 * - A cell's byte `v` is drawn in `ramp`'s entry `v`, blended source-over onto
 *   what is drawn before it, in its layer's order: a field drawn first in a
 *   layer is under the rectangles and segments after it.
 */
export interface FieldBatch {
  readonly kind: 'field';
  readonly field: ScalarField;
  readonly ramp: ColourRamp;
  /** The rectangle in CSS pixels. */
  readonly at: Rectangle;
  /** The field column coordinates at `at`'s left and right edges. */
  readonly columns: { readonly from: number; readonly to: number };
  readonly rows: Float32Array;
}

export type RenderBatch = RectangleBatch | SegmentBatch | FieldBatch | TextBatch | ImageBatch;

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
