/**
 * The order a graph's nodes run in.
 *
 * Kahn's algorithm, with every tie broken by declaration order: of the nodes
 * whose inputs are all ready, the one declared first runs first. The order is
 * then a function of the graph alone, never of the order its edges were
 * written in or of a map's iteration, so the same graph always makes the same
 * plan (REQ-ARCH-049).
 */

/**
 * A binary min-heap of node indices.
 *
 * The ready set is taken from once per node and added to once per node, so a
 * heap keeps the whole ordering to O((n + e) log n) where rescanning the ready
 * set for its smallest member would be quadratic in a long graph.
 */
class IndexHeap {
  readonly #items: number[] = [];

  push(value: number): void {
    const items = this.#items;
    items.push(value);
    let child = items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      const [above = 0, below = 0] = [items[parent], items[child]];
      if (above <= below) break;
      items[parent] = below;
      items[child] = above;
      child = parent;
    }
  }

  pop(): number | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;
    items[0] = last;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      const smallest = [left, left + 1]
        .filter((child) => child < items.length)
        .reduce((best, child) => ((items[child] ?? 0) < (items[best] ?? 0) ? child : best), parent);
      if (smallest === parent) return top;
      [items[parent], items[smallest]] = [items[smallest] ?? 0, items[parent] ?? 0];
      parent = smallest;
    }
  }
}

/** A graph's nodes in running order, and those a cycle kept from being ordered. */
export interface TopologicalOrder {
  /** Node indices in the order they run. */
  readonly order: readonly number[];

  /** Node indices that could not be ordered, in declaration order. */
  readonly unordered: readonly number[];
}

/**
 * Orders `count` nodes, known by their declaration index, joined by edges
 * given as the index of the node each starts and ends at.
 */
export function topologicalOrder(
  count: number,
  edges: readonly (readonly [from: number, to: number])[],
): TopologicalOrder {
  const waiting = Array.from({ length: count }, () => 0);
  const after = Array.from({ length: count }, (): number[] => []);
  for (const [from, to] of edges) {
    waiting[to] = (waiting[to] ?? 0) + 1;
    after[from]?.push(to);
  }
  const ready = new IndexHeap();
  for (const [index, count] of waiting.entries()) if (count === 0) ready.push(index);

  const order: number[] = [];
  for (let next = ready.pop(); next !== undefined; next = ready.pop()) {
    order.push(next);
    for (const to of after[next] ?? []) {
      const left = (waiting[to] ?? 0) - 1;
      waiting[to] = left;
      if (left === 0) ready.push(to);
    }
  }
  const unordered = waiting.flatMap((left, index) => (left > 0 ? [index] : []));
  return { order, unordered };
}
