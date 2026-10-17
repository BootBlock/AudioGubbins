/**
 * The knob's printed scale and value ring, on its 48-unit grid (design
 * language, section 10): eleven ticks across a sweep of 270 degrees from
 * -135, every 27, and the ring's track and value as arcs of one radius.
 *
 * Geometry inside a hardware control follows its own grid, so these are units
 * of the knob's view box, which the knob draws at its size token.
 */

/** The view box's side, and its centre. */
export const KNOB_GRID = 48;
const CENTRE = KNOB_GRID / 2;

/** Where the sweep starts, and how far it turns, in degrees from straight up. */
const SWEEP_START = -135;
const SWEEP = 270;

/** The printed ticks: their count, where they start and end, and the major ticks' reach. */
const TICKS = 11;
const TICK_INNER = 23.2;
const TICK_OUTER = 25.2;
const MAJOR_TICK_OUTER = 26;
const MAJOR_EVERY = 5;

/** The ring's radius: the track and the value are drawn on it. */
const RING_RADIUS = 20.5;

/** The widths of a printed tick's stroke and of the ring's, in units of the grid. */
export const KNOB_TICK_STROKE = 1.1;
export const KNOB_RING_STROKE = 2.5;

/** One printed tick, a line from the scale's inner edge outward. */
export interface KnobTick {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly major: boolean;
}

/** A point at `radius` and `degrees` clockwise from straight up. */
function polar(radius: number, degrees: number): readonly [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [CENTRE + radius * Math.cos(radians), CENTRE + radius * Math.sin(radians)];
}

/** An SVG arc along the ring from one angle to another, clockwise. */
function arc(from: number, to: number): string {
  const [x0, y0] = polar(RING_RADIUS, from);
  const [x1, y1] = polar(RING_RADIUS, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${String(x0)} ${String(y0)} A ${String(RING_RADIUS)} ${String(RING_RADIUS)} 0 ${String(large)} 1 ${String(x1)} ${String(y1)}`;
}

/** The angle the knob turns to at `fraction` of its travel, in degrees from straight up. */
export function knobAngle(fraction: number): number {
  return SWEEP_START + SWEEP * fraction;
}

/** The ticks printed on the panel round the knob, the same for every knob. */
export const KNOB_TICKS: readonly KnobTick[] = Array.from({ length: TICKS }, (_unused, index) => {
  const angle = SWEEP_START + (SWEEP * index) / (TICKS - 1);
  const major = index % MAJOR_EVERY === 0;
  const [x1, y1] = polar(TICK_INNER, angle);
  const [x2, y2] = polar(major ? MAJOR_TICK_OUTER : TICK_OUTER, angle);
  return { x1, y1, x2, y2, major };
});

/** The ring's track: the whole sweep. */
export const KNOB_TRACK = arc(SWEEP_START, SWEEP_START + SWEEP);

/**
 * The ring's value: the sweep from its start to `fraction` of it, or nothing
 * at the very start, where an arc of no length would draw a dot of its caps.
 */
export function knobValueArc(fraction: number): string | undefined {
  if (fraction <= 0) return undefined;
  return arc(SWEEP_START, knobAngle(fraction));
}
