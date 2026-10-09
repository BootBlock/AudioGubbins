/**
 * Events of four values that a detector has found and not yet handed out:
 * the clicks' and the clipping runs' records, which come a block at a time
 * and leave a pull at most a record at a time (`pull_events` in
 * `detectors/mod.rs`). The array grows by doubling to the most a block has
 * found, and is reused from then on.
 */

export class EventQueue {
  #values = new Float64Array(64);
  #count = 0;
  #cursor = 0;

  /** Appends one event. */
  append(first: number, second: number, third: number, fourth: number): void {
    if (this.#count + 4 > this.#values.length) {
      const grown = new Float64Array(2 * this.#values.length);
      grown.set(this.#values);
      this.#values = grown;
    }
    this.#values[this.#count] = first;
    this.#values[this.#count + 1] = second;
    this.#values[this.#count + 2] = third;
    this.#values[this.#count + 3] = fourth;
    this.#count += 4;
  }

  /** Forgets every event, handed out or not. */
  clear(): void {
    this.#count = 0;
    this.#cursor = 0;
  }

  /**
   * Copies events not yet handed out into `records` from record `written`
   * until `capacity` records are written or none is left, and answers how
   * many records `records` then holds.
   */
  drain(records: Float64Array, written: number, capacity: number): number {
    let count = written;
    while (count < capacity && this.#cursor < this.#count) {
      for (let value = 0; value < 4; value += 1) {
        records[4 * count + value] = this.#values[this.#cursor + value] ?? 0;
      }
      this.#cursor += 4;
      count += 1;
    }
    return count;
  }
}
