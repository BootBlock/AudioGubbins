/**
 * A growing list of 32-bit sizes, one per encoded unit, held in a typed array
 * that doubles as it fills: an hour of AAC or MP3 is some 170,000 units, which
 * an array of numbers would hold at several times the memory.
 */

/** The sizes of a stream's units, in the order they were added. */
export class SizeList {
  private sizes = new Uint32Array(1_024);
  private count = 0;

  /** How many sizes the list holds. */
  get length(): number {
    return this.count;
  }

  push(size: number): void {
    if (this.count === this.sizes.length) {
      const grown = new Uint32Array(this.sizes.length * 2);
      grown.set(this.sizes);
      this.sizes = grown;
    }
    this.sizes[this.count] = size;
    this.count += 1;
  }

  /** The size at `index`, which the caller keeps below the length. */
  at(index: number): number {
    return this.sizes[index] ?? 0;
  }
}
