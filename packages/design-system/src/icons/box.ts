/** An axis-aligned box in a glyph's 24-unit grid. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Grows a box to take in every point it is given. */
export class BoxBuilder {
  private left = Infinity;
  private top = Infinity;
  private right = -Infinity;
  private bottom = -Infinity;

  take(x: number, y: number): void {
    this.left = Math.min(this.left, x);
    this.top = Math.min(this.top, y);
    this.right = Math.max(this.right, x);
    this.bottom = Math.max(this.bottom, y);
  }

  takeBox(box: Box): void {
    this.take(box.left, box.top);
    this.take(box.right, box.bottom);
  }

  /** The box, or `undefined` when no point was taken: a shape that draws nothing has no ink. */
  build(): Box | undefined {
    if (this.left > this.right) return undefined;
    return { left: this.left, top: this.top, right: this.right, bottom: this.bottom };
  }
}
