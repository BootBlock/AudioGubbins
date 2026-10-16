/**
 * The voices of a game preview's simulation still to end, by the frame each
 * ends at, then by voice (a binary heap): the simulation asks it, before each
 * trigger, which voices ended by then, so it costs the logarithm of the voices
 * sounding rather than a look at each.
 *
 * A stolen or stopped voice is not taken out: whoever pops it checks that it
 * still sounds. The heap is an array of plain entries, so a snapshot of the
 * simulation copies it as it is.
 */

export interface EndingVoice {
  readonly end: number;
  readonly voice: number;
  /** The emitter's place in the scenario. */
  readonly emitter: number;
}

function earlier(left: EndingVoice, right: EndingVoice): boolean {
  return left.end !== right.end ? left.end < right.end : left.voice < right.voice;
}

export class EndQueue {
  readonly #heap: EndingVoice[];

  constructor(entries: readonly EndingVoice[] = []) {
    this.#heap = [...entries];
  }

  /** A copy that changes apart from this one. */
  copy(): EndQueue {
    return new EndQueue(this.#heap);
  }

  push(entry: EndingVoice): void {
    const heap = this.#heap;
    heap.push(entry);
    let at = heap.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      const above = heap[parent];
      if (above === undefined || !earlier(entry, above)) break;
      heap[at] = above;
      at = parent;
    }
    heap[at] = entry;
  }

  /** The earliest entry, taken out, where it ends by `frame`. */
  popBy(frame: number): EndingVoice | undefined {
    const heap = this.#heap;
    const top = heap[0];
    if (top === undefined || top.end > frame) return undefined;
    const last = heap.pop();
    if (last === undefined || heap.length === 0) return top;
    let at = 0;
    for (;;) {
      const left = 2 * at + 1;
      const right = left + 1;
      let next = at;
      let chosen = last;
      const leftEntry = heap[left];
      if (leftEntry !== undefined && earlier(leftEntry, chosen)) {
        next = left;
        chosen = leftEntry;
      }
      const rightEntry = heap[right];
      if (rightEntry !== undefined && earlier(rightEntry, chosen)) {
        next = right;
        chosen = rightEntry;
      }
      if (next === at) break;
      heap[at] = chosen;
      at = next;
    }
    heap[at] = last;
    return top;
  }
}
