/**
 * The box of a drawn SVG shape, found by sampling it densely.
 *
 * A second measurement of a glyph's ink, written apart from the icon's own on
 * purpose: the icon finds a curve's extremes analytically, from its
 * derivative's roots, and this walks each shape point by point, so a mistake in
 * the analysis is not repeated here to agree with itself. It reads the shapes a
 * renderer was given, from the DOM, because jsdom measures no geometry.
 *
 * Sampled finely enough that its own error, a curve's sag between two samples,
 * is under a thousandth of a grid unit for any glyph on a 24-unit grid.
 */

/** A sampled box, in the shape's own units. */
export interface SampledBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const SAMPLES_PER_SEGMENT = 1024;

type Sample = (x: number, y: number) => void;

function attribute(element: Element, name: string): number {
  return Number(element.getAttribute(name) ?? '0');
}

/** Path data split into its command letters and numbers, every flag a token of its own. */
function tokens(data: string): string[] {
  const found = data.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  return found;
}

function sampleArc(
  sample: Sample,
  [x1, y1]: readonly [number, number],
  [radiusX, radiusY, degrees, large, sweep]: readonly number[],
  [x2, y2]: readonly [number, number],
): void {
  let rx = Math.abs(radiusX ?? 0);
  let ry = Math.abs(radiusY ?? 0);
  if ((x1 === x2 && y1 === y2) || rx === 0 || ry === 0) {
    sample(x1, y1);
    sample(x2, y2);
    return;
  }
  const phi = ((degrees ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(phi), Math.sin(phi)];
  const xp = (c * (x1 - x2)) / 2 + (s * (y1 - y2)) / 2;
  const yp = (-s * (x1 - x2)) / 2 + (c * (y1 - y2)) / 2;
  const scale = Math.hypot(xp / rx, yp / ry);
  if (scale > 1) [rx, ry] = [rx * scale, ry * scale];
  const square =
    (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) /
    (rx * rx * yp * yp + ry * ry * xp * xp);
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, square));
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = c * cxp - s * cyp + (x1 + x2) / 2;
  const cy = s * cxp + c * cyp + (y1 + y2) / 2;
  const start = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
  const end = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx);
  let turn = end - start;
  if (sweep === 1 && turn < 0) turn += 2 * Math.PI;
  if (sweep === 0 && turn > 0) turn -= 2 * Math.PI;
  for (let step = 0; step <= SAMPLES_PER_SEGMENT; step += 1) {
    const angle = start + (turn * step) / SAMPLES_PER_SEGMENT;
    sample(
      cx + rx * c * Math.cos(angle) - ry * s * Math.sin(angle),
      cy + rx * s * Math.cos(angle) + ry * c * Math.sin(angle),
    );
  }
}

/** Samples every segment a path draws. */
function samplePath(sample: Sample, data: string): void {
  const list = tokens(data);
  let at = 0;
  let command = '';
  let [x, y] = [0, 0];
  let [startX, startY] = [0, 0];
  let previous: { command: string; x: number; y: number } | undefined;

  const next = (): number => Number(list[at++]);
  const flag = (): number => {
    // Flags may run into the number after them: "011" is the flags 0 and 1 and the number 1.
    const token = list[at] ?? '';
    if (token.length > 1 && /^[01]/.test(token)) {
      list[at] = token.slice(1);
      return Number(token.charAt(0));
    }
    at += 1;
    return Number(token);
  };
  const curve = (points: readonly (readonly [number, number])[]): void => {
    for (let step = 0; step <= SAMPLES_PER_SEGMENT; step += 1) {
      const t = step / SAMPLES_PER_SEGMENT;
      // De Casteljau's construction, a different route to the curve's points
      // than the Bernstein polynomials the icon measures with.
      let layer = points.map(([px, py]) => [px, py] as const);
      while (layer.length > 1) {
        layer = layer.slice(1).map(([px, py], index) => {
          const [qx, qy] = layer[index] ?? [px, py];
          return [qx + (px - qx) * t, qy + (py - qy) * t] as const;
        });
      }
      const [first] = layer;
      if (first !== undefined) sample(first[0], first[1]);
    }
  };

  while (at < list.length) {
    const token = list[at] ?? '';
    if (/[A-Za-z]/.test(token)) {
      command = token;
      at += 1;
    }
    const relative = command === command.toLowerCase();
    const [ox, oy] = relative ? [x, y] : [0, 0];
    const upper = command.toUpperCase();
    let [toX, toY] = [x, y];

    if (upper === 'Z') {
      sample(x, y);
      sample(startX, startY);
      [x, y] = [startX, startY];
      previous = undefined;
      continue;
    }
    if (upper === 'M') {
      [x, y] = [ox + next(), oy + next()];
      [startX, startY] = [x, y];
      // Further pairs after a move are lines.
      command = relative ? 'l' : 'L';
      previous = undefined;
      continue;
    }
    if (upper === 'L') [toX, toY] = [ox + next(), oy + next()];
    if (upper === 'H') toX = ox + next();
    if (upper === 'V') toY = oy + next();
    if (upper === 'L' || upper === 'H' || upper === 'V') {
      sample(x, y);
      sample(toX, toY);
    }
    if (upper === 'C' || upper === 'S') {
      const reflect = previous !== undefined && 'CS'.includes(previous.command);
      const first: [number, number] =
        upper === 'C'
          ? [ox + next(), oy + next()]
          : reflect && previous !== undefined
            ? [2 * x - previous.x, 2 * y - previous.y]
            : [x, y];
      const second: [number, number] = [ox + next(), oy + next()];
      [toX, toY] = [ox + next(), oy + next()];
      curve([[x, y], first, second, [toX, toY]]);
      previous = { command: upper, x: second[0], y: second[1] };
    } else if (upper === 'Q' || upper === 'T') {
      const reflect = previous !== undefined && 'QT'.includes(previous.command);
      const control: [number, number] =
        upper === 'Q'
          ? [ox + next(), oy + next()]
          : reflect && previous !== undefined
            ? [2 * x - previous.x, 2 * y - previous.y]
            : [x, y];
      [toX, toY] = [ox + next(), oy + next()];
      curve([[x, y], control, [toX, toY]]);
      previous = { command: upper, x: control[0], y: control[1] };
    } else if (upper === 'A') {
      const shape = [next(), next(), next(), flag(), flag()];
      [toX, toY] = [ox + next(), oy + next()];
      sampleArc(sample, [x, y], shape, [toX, toY]);
      previous = undefined;
    } else {
      previous = undefined;
    }
    [x, y] = [toX, toY];
  }
}

function sampleEllipse(sample: Sample, cx: number, cy: number, rx: number, ry: number): void {
  for (let step = 0; step < 4 * SAMPLES_PER_SEGMENT; step += 1) {
    const angle = (2 * Math.PI * step) / (4 * SAMPLES_PER_SEGMENT);
    sample(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
  }
}

function sampleShape(sample: Sample, shape: Element): void {
  switch (shape.tagName.toLowerCase()) {
    case 'path':
      samplePath(sample, shape.getAttribute('d') ?? '');
      return;
    case 'circle': {
      const r = attribute(shape, 'r');
      sampleEllipse(sample, attribute(shape, 'cx'), attribute(shape, 'cy'), r, r);
      return;
    }
    case 'ellipse':
      sampleEllipse(
        sample,
        attribute(shape, 'cx'),
        attribute(shape, 'cy'),
        attribute(shape, 'rx'),
        attribute(shape, 'ry'),
      );
      return;
    case 'rect': {
      const [x, y] = [attribute(shape, 'x'), attribute(shape, 'y')];
      sample(x, y);
      sample(x + attribute(shape, 'width'), y + attribute(shape, 'height'));
      return;
    }
    case 'line':
      sample(attribute(shape, 'x1'), attribute(shape, 'y1'));
      sample(attribute(shape, 'x2'), attribute(shape, 'y2'));
      return;
    case 'polyline':
    case 'polygon': {
      const values = (shape.getAttribute('points') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      for (let index = 0; index + 1 < values.length; index += 2) {
        sample(values[index] ?? 0, values[index + 1] ?? 0);
      }
      return;
    }
    default:
      throw new Error(`The sampler does not draw <${shape.tagName}>.`);
  }
}

/** The sampled box of every shape given, together. */
export function sampledBoxOf(shapes: Iterable<Element>): SampledBox {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  const sample: Sample = (x, y) => {
    [left, top] = [Math.min(left, x), Math.min(top, y)];
    [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
  };
  for (const shape of shapes) sampleShape(sample, shape);
  return { left, top, right, bottom };
}
