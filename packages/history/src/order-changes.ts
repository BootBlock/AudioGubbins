/**
 * Which items of a reordered list kept their order, so the difference of two
 * effect chains names as moved only the processors a person moved
 * (REQ-STOR-195).
 *
 * The items that stayed in order are a longest increasing subsequence of their
 * old positions taken in their new order; every other item moved. One processor
 * inserted at the head shifts every other's index without moving any of them,
 * which comparing indices alone would report as a move of all.
 */

/**
 * The positions in `sequence` of one longest strictly increasing subsequence,
 * found in O(n log n). `sequence` holds each item's old position in its new
 * order, so the positions returned are of the items that did not move.
 */
export function unmovedPositions(sequence: readonly number[]): ReadonlySet<number> {
  // `tails[length]` is the position of the smallest value ending an increasing
  // run of `length + 1`; `previous` links each position to the one before it
  // in the run it ends.
  const tails: number[] = [];
  const previous: (number | undefined)[] = [];
  for (const [position, value] of sequence.entries()) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((sequence[tails[middle] ?? 0] ?? 0) < value) low = middle + 1;
      else high = middle;
    }
    previous[position] = low > 0 ? tails[low - 1] : undefined;
    tails[low] = position;
  }

  const kept = new Set<number>();
  for (let position = tails.at(-1); position !== undefined; position = previous[position]) {
    kept.add(position);
  }
  return kept;
}
