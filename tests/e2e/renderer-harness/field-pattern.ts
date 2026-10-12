/**
 * The field the renderer harness draws, and the colours a page must show for
 * it (ADR-0082), shared by the harness page, which composes the frame, and the
 * renderer suites, which read the page's pixels against it.
 *
 * A field of four columns and three rows, holding both ends of the ramp, drawn
 * through a ramp whose every entry is a different colour and whose middle entry
 * is half transparent, across a rectangle that also holds a stretch of columns
 * before the field's first and a band of rows that read no field row. A
 * rectangle is drawn under the field and another over part of it, in the one
 * layer, so the layer's order and the blending are seen as well. Everything is
 * placed in CSS pixels, and the rows are given per device row, so the picture
 * is the same at any device pixel ratio.
 */

/** A colour as the page shows it, red, green and blue from 0 to 255. */
export type Rgb = readonly [number, number, number];

/** A colour of the ramp, red, green, blue and alpha from 0 to 255. */
export type Rgba = readonly [number, number, number, number];

/** The surface's size in CSS pixels. */
export const SURFACE = { width: 72, height: 48 } as const;

/** What the frame is cleared to. */
export const CLEAR: Rgb = [20, 20, 20];

/** The rectangle drawn first, under the whole of the field's rectangle. */
export const UNDER: Rgb = [40, 60, 200];

/** The rectangle drawn last, over the field's last column in its first band. */
export const OVER: Rgb = [230, 230, 40];

/** Where the field is drawn, in CSS pixels. */
export const FIELD_AT = { x: 8, y: 8, width: 50, height: 32 } as const;

/**
 * Its column coordinates at the rectangle's left and right edges: ten CSS
 * pixels to a column, the first ten reading column -1, which paints nothing.
 */
export const FIELD_COLUMNS = { from: -1, to: 4 } as const;

/** Where the rectangle over the field is drawn: the last column of the first band. */
export const OVER_AT = { x: 48, y: 8, width: 10, height: 8 } as const;

/** The field's cells, row by row, holding 0 and 255, the ramp's two ends. */
export const FIELD = {
  width: 4,
  height: 3,
  values: [0, 255, 64, 128, 255, 0, 192, 32, 10, 128, 250, 1],
} as const;

/** CSS pixels to a band of rows: the field's rectangle is four bands deep. */
const BAND = 8;

/**
 * The field row each band of the rectangle reads, top to bottom: the third
 * band reads none, so the rectangle under the field shows through it.
 */
const BAND_ROWS = [0, 1, -1, 2] as const;

/** The field row read `y` CSS pixels below the top of the field's rectangle. */
export function rowAt(y: number): number {
  return BAND_ROWS[Math.floor(y / BAND)] ?? -1;
}

/**
 * The ramp's entry for the byte `value`: a different colour for every byte,
 * opaque but for the middle entry, which is half transparent.
 */
export function rampEntry(value: number): Rgba {
  return [value, 255 - value, (value * 3) % 256, value === 128 ? 128 : 255];
}

/** `colour` blended source-over onto `under`, as every backend blends a field. */
function over(colour: Rgba, under: Rgb): Rgb {
  const alpha = colour[3] / 255;
  const mix = (top: number, bottom: number): number =>
    Math.round(top * alpha + bottom * (1 - alpha));
  return [mix(colour[0], under[0]), mix(colour[1], under[1]), mix(colour[2], under[2])];
}

/** Whether CSS point `x`, `y` lies inside `area`. */
function inside(
  area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  x: number,
  y: number,
): boolean {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}

/** The colour the page must show at CSS point `x`, `y` of the surface. */
export function expectedAt(x: number, y: number): Rgb {
  if (inside(OVER_AT, x, y)) return OVER;
  if (!inside(FIELD_AT, x, y)) return CLEAR;
  const perColumn = FIELD_AT.width / (FIELD_COLUMNS.to - FIELD_COLUMNS.from);
  const column = Math.floor(FIELD_COLUMNS.from + (x - FIELD_AT.x) / perColumn);
  const row = rowAt(y - FIELD_AT.y);
  if (column < 0 || row < 0) return UNDER;
  return over(rampEntry(FIELD.values[row * FIELD.width + column] ?? 0), UNDER);
}

/**
 * The points the suites read, each the middle of a CSS pixel: one in the
 * middle of every cell the field draws, of the stretch before its first
 * column, of the band that reads no row and of the rectangle over it, and
 * one outside the field's rectangle.
 */
export const READ_POINTS: readonly { readonly x: number; readonly y: number }[] = [
  ...[0, 1, 3].flatMap((band) =>
    [-1, 0, 1, 2, 3].map((column) => ({
      x: FIELD_AT.x + (column + 1) * 10 + 5.5,
      y: FIELD_AT.y + band * BAND + 4.5,
    })),
  ),
  { x: FIELD_AT.x + 25.5, y: FIELD_AT.y + 2 * BAND + 4.5 },
  { x: 3.5, y: 3.5 },
  { x: 65.5, y: 44.5 },
];
