/**
 * Rectangles and segments gathered for a frame into arrays kept from frame to
 * frame (G4): a view draws tens of thousands of columns sixty times a second,
 * and allocating them afresh each time would be garbage the page pays for in
 * pauses. Each builder grows when a frame needs more and is reset, not
 * replaced, before the next.
 */

import type { Colour, RectangleBatch, SegmentBatch } from '@audiogubbins/renderer';

/** Values of four numbers per item, kept and grown. */
class Quads {
  #values = new Float32Array(1024);
  #count = 0;

  get count(): number {
    return this.#count;
  }

  get values(): Float32Array {
    return this.#values;
  }

  reset(): void {
    this.#count = 0;
  }

  push(a: number, b: number, c: number, d: number): void {
    const at = this.#count * 4;
    if (at + 4 > this.#values.length) {
      const grown = new Float32Array(this.#values.length * 2);
      grown.set(this.#values);
      this.#values = grown;
    }
    this.#values[at] = a;
    this.#values[at + 1] = b;
    this.#values[at + 2] = c;
    this.#values[at + 3] = d;
    this.#count += 1;
  }
}

/** Filled rectangles of one colour. */
export class RectangleBuilder {
  readonly #quads = new Quads();
  colour: Colour;

  constructor(colour: Colour) {
    this.colour = colour;
  }

  reset(colour: Colour): void {
    this.colour = colour;
    this.#quads.reset();
  }

  add(x: number, y: number, width: number, height: number): void {
    if (width > 0 && height > 0) this.#quads.push(x, y, width, height);
  }

  batch(): RectangleBatch {
    return {
      kind: 'rectangles',
      colour: this.colour,
      values: this.#quads.values,
      count: this.#quads.count,
    };
  }
}

/** Line segments of one colour and width. */
export class SegmentBuilder {
  readonly #quads = new Quads();
  colour: Colour;
  width: number;

  constructor(colour: Colour, width: number) {
    this.colour = colour;
    this.width = width;
  }

  reset(colour: Colour, width: number): void {
    this.colour = colour;
    this.width = width;
    this.#quads.reset();
  }

  add(x0: number, y0: number, x1: number, y1: number): void {
    this.#quads.push(x0, y0, x1, y1);
  }

  batch(): SegmentBatch {
    return {
      kind: 'segments',
      colour: this.colour,
      width: this.width,
      values: this.#quads.values,
      count: this.#quads.count,
    };
  }
}

/**
 * A pool of builders handed out in order and reset together, so a frame of any
 * number of lanes draws into the same builders as the frame before.
 */
export class BuilderPool {
  readonly #rectangles: RectangleBuilder[] = [];
  readonly #segments: SegmentBuilder[] = [];
  #nextRectangle = 0;
  #nextSegment = 0;

  /** Starts a new frame: every builder is free again. */
  reset(): void {
    this.#nextRectangle = 0;
    this.#nextSegment = 0;
  }

  rectangles(colour: Colour): RectangleBuilder {
    const builder = this.#rectangles[this.#nextRectangle] ?? new RectangleBuilder(colour);
    if (this.#nextRectangle === this.#rectangles.length) this.#rectangles.push(builder);
    this.#nextRectangle += 1;
    builder.reset(colour);
    return builder;
  }

  segments(colour: Colour, width: number): SegmentBuilder {
    const builder = this.#segments[this.#nextSegment] ?? new SegmentBuilder(colour, width);
    if (this.#nextSegment === this.#segments.length) this.#segments.push(builder);
    this.#nextSegment += 1;
    builder.reset(colour, width);
    return builder;
  }
}
