/**
 * The value of a rank among values, by the selection `selection.rs` states,
 * swap for swap: quickselect with Dijkstra's three-way partition about the
 * middle value of the range, so the two paths agree even where a NaN makes
 * order meaningless, and a run of equal values costs one pass.
 */

/** The nearest rank at `share` of `count` values, ascending: `⌊(count − 1) · share + 0.5⌋`. */
export function rankAt(count: number, share: number): number {
  return Math.min(Math.floor((count - 1) * share + 0.5), count - 1);
}

/** Swaps `values[a]` and `values[b]`. */
function swap(values: Float64Array, a: number, b: number): void {
  const held = values[a] ?? 0;
  values[a] = values[b] ?? 0;
  values[b] = held;
}

/**
 * Reorders the first `count` of `values` so the value of rank `rank` in
 * ascending order is at `values[rank]`, where `select` in `selection.rs`
 * finds it. It is read from there rather than answered: a number answered
 * by a call the optimiser leaves out of line is an allocation, and a
 * detector calls this once a block, too seldom to be sure it is inlined.
 */
export function selectRank(values: Float64Array, count: number, rank: number): void {
  let low = 0;
  let high = Math.max(count - 1, 0);
  while (low < high) {
    const pivot = values[low + Math.floor((high - low) / 2)] ?? 0;
    let lt = low;
    let i = low;
    let end = high + 1;
    while (i < end) {
      const value = values[i] ?? 0;
      if (value < pivot) {
        swap(values, lt, i);
        lt += 1;
        i += 1;
      } else if (value > pivot) {
        end -= 1;
        swap(values, i, end);
      } else {
        i += 1;
      }
    }
    if (rank < lt) high = lt - 1;
    else if (rank >= end) low = end;
    else return;
  }
}
