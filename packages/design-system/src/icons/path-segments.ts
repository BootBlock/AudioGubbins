/**
 * SVG path data, read into the segments it draws.
 *
 * Every command of the path grammar is read, relative and absolute, with its
 * implicit repeats, and each is reduced to one of four absolute segment kinds,
 * so the measurement beside it never has to know how the path was written. A
 * subpath's close is a straight segment back to its start; a move draws nothing
 * and so yields no segment, because a glyph's ink is only what is stroked.
 */

/** A point in a glyph's grid. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One drawn piece of a path, in absolute coordinates. */
export type PathSegment =
  | { readonly kind: 'line'; readonly from: Point; readonly to: Point }
  | {
      readonly kind: 'quadratic';
      readonly from: Point;
      readonly control: Point;
      readonly to: Point;
    }
  | {
      readonly kind: 'cubic';
      readonly from: Point;
      readonly control1: Point;
      readonly control2: Point;
      readonly to: Point;
    }
  | {
      readonly kind: 'arc';
      readonly from: Point;
      readonly radiusX: number;
      readonly radiusY: number;
      /** The ellipse's x-axis rotation, in degrees, as the path writes it. */
      readonly rotation: number;
      readonly largeArc: boolean;
      readonly sweep: boolean;
      readonly to: Point;
    };

const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const SEPARATOR = /[\s,]/;

/** The commands that draw straight lines, or move: the rest draw curves. */
const STRAIGHT = /^[MLHV]$/;

/**
 * A cursor over path data.
 *
 * Read character by character rather than split by one expression, because
 * the grammar lets an arc's two flags run into each other and into the number
 * after them (`a1 1 0 011 1`), which no number pattern can tell apart.
 */
class PathReader {
  private at = 0;
  private readonly data: string;

  constructor(data: string) {
    this.data = data;
  }

  private skipSeparators(): void {
    while (this.at < this.data.length && SEPARATOR.test(this.data.charAt(this.at))) this.at += 1;
  }

  /** The next command letter, or `undefined` at the end of the data. */
  command(): string | undefined {
    this.skipSeparators();
    if (this.at >= this.data.length) return undefined;
    const letter = this.data.charAt(this.at);
    if (!COMMAND.test(letter)) {
      throw new Error(`Path data has "${letter}" where a command belongs, at ${String(this.at)}.`);
    }
    this.at += 1;
    return letter;
  }

  /** Whether a number comes next, which repeats the command before it. */
  numberFollows(): boolean {
    this.skipSeparators();
    return NUMBER.test(this.data.slice(this.at));
  }

  number(): number {
    this.skipSeparators();
    const match = NUMBER.exec(this.data.slice(this.at));
    if (match === null) {
      throw new Error(`Path data has no number where one belongs, at ${String(this.at)}.`);
    }
    this.at += match[0].length;
    return Number(match[0]);
  }

  flag(): boolean {
    this.skipSeparators();
    const digit = this.data.charAt(this.at);
    if (digit !== '0' && digit !== '1') {
      throw new Error(`Path data has no arc flag where one belongs, at ${String(this.at)}.`);
    }
    this.at += 1;
    return digit === '1';
  }
}

/** The reflection of a control point through the current point, which `S` and `T` take. */
function reflected(control: Point | undefined, through: Point): Point {
  return control === undefined
    ? through
    : { x: 2 * through.x - control.x, y: 2 * through.y - control.y };
}

/** Where the pen is as a path is read, and what a smooth curve would reflect. */
class PathWalk {
  readonly segments: PathSegment[] = [];
  private readonly reader: PathReader;
  private current: Point = { x: 0, y: 0 };
  private start: Point = this.current;
  private relative = false;
  // The last cubic's or quadratic's second control point, which a smooth
  // command straight after it reflects. Any other command forgets it.
  private cubicControl: Point | undefined;
  private quadraticControl: Point | undefined;

  constructor(reader: PathReader) {
    this.reader = reader;
  }

  private point(): Point {
    const x = this.reader.number();
    const y = this.reader.number();
    return this.relative ? { x: this.current.x + x, y: this.current.y + y } : { x, y };
  }

  private draw(segment: PathSegment, cubicControl?: Point, quadraticControl?: Point): void {
    this.segments.push(segment);
    this.current = segment.to;
    this.cubicControl = cubicControl;
    this.quadraticControl = quadraticControl;
  }

  close(): void {
    const { current, start } = this;
    if (current.x !== start.x || current.y !== start.y) {
      this.segments.push({ kind: 'line', from: current, to: start });
    }
    this.current = start;
    this.cubicControl = undefined;
    this.quadraticControl = undefined;
  }

  /** Reads one set of a command's arguments, `first` for the set after its letter. */
  step(command: string, relative: boolean, first: boolean): void {
    this.relative = relative;
    if (STRAIGHT.test(command)) this.straight(command, first);
    else this.curved(command);
  }

  private straight(command: string, first: boolean): void {
    const from = this.current;
    switch (command) {
      case 'M':
        // A move's further pairs are lines, the grammar's implicit repeat.
        if (first) {
          this.start = this.point();
          this.current = this.start;
          this.cubicControl = undefined;
          this.quadraticControl = undefined;
        } else {
          this.draw({ kind: 'line', from, to: this.point() });
        }
        return;
      case 'L':
        this.draw({ kind: 'line', from, to: this.point() });
        return;
      case 'H': {
        const x = this.reader.number();
        this.draw({ kind: 'line', from, to: { x: this.relative ? from.x + x : x, y: from.y } });
        return;
      }
      case 'V': {
        const y = this.reader.number();
        this.draw({ kind: 'line', from, to: { x: from.x, y: this.relative ? from.y + y : y } });
      }
    }
  }

  private curved(command: string): void {
    const from = this.current;
    switch (command) {
      case 'C':
      case 'S': {
        const control1 = command === 'C' ? this.point() : reflected(this.cubicControl, from);
        const control2 = this.point();
        this.draw({ kind: 'cubic', from, control1, control2, to: this.point() }, control2);
        return;
      }
      case 'Q':
      case 'T': {
        const control = command === 'Q' ? this.point() : reflected(this.quadraticControl, from);
        this.draw({ kind: 'quadratic', from, control, to: this.point() }, undefined, control);
        return;
      }
      case 'A':
        this.draw({
          kind: 'arc',
          from,
          radiusX: this.reader.number(),
          radiusY: this.reader.number(),
          rotation: this.reader.number(),
          largeArc: this.reader.flag(),
          sweep: this.reader.flag(),
          to: this.point(),
        });
        return;
      default:
        throw new Error(`Path command "${command}" is not read.`);
    }
  }
}

/** Every segment a path's data draws, in order. */
export function pathSegments(data: string): readonly PathSegment[] {
  const reader = new PathReader(data);
  const walk = new PathWalk(reader);
  for (let letter = reader.command(); letter !== undefined; letter = reader.command()) {
    const command = letter.toUpperCase();
    if (command === 'Z') {
      walk.close();
      continue;
    }
    let first = true;
    do {
      walk.step(command, letter !== command, first);
      first = false;
    } while (reader.numberFollows());
  }
  return walk.segments;
}
