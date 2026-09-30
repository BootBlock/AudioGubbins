/**
 * Finding the cycles that kept a graph from being ordered.
 *
 * Kahn's algorithm leaves unordered both the nodes on a cycle and the nodes
 * downstream of one, and only the first are the problem: a diagnostic naming a
 * node that merely follows a feedback loop would send the reader to the wrong
 * place. The strongly connected components of the unordered nodes are exactly
 * the cycles, found here by Tarjan's algorithm, written with an explicit stack
 * so that a long cycle cannot exhaust the call stack.
 */

/** One node being visited, and how many of its successors have been looked at. */
interface Frame {
  readonly node: number;
  next: number;
}

/** The running state of one search. */
interface Search {
  readonly successors: ReadonlyMap<number, readonly number[]>;
  readonly index: Map<number, number>;
  readonly low: Map<number, number>;
  readonly stack: number[];
  readonly onStack: Set<number>;
  readonly components: number[][];
}

function enter(search: Search, node: number, frames: Frame[]): void {
  search.index.set(node, search.index.size);
  search.low.set(node, search.index.size - 1);
  search.stack.push(node);
  search.onStack.add(node);
  frames.push({ node, next: 0 });
}

function lower(search: Search, node: number, candidate: number): void {
  search.low.set(node, Math.min(search.low.get(node) ?? candidate, candidate));
}

/** Pops the finished node's component off the stack, if the node is its root. */
function leave(search: Search, frame: Frame, parent: Frame | undefined): void {
  const low = search.low.get(frame.node) ?? 0;
  if (parent !== undefined) lower(search, parent.node, low);
  if (low !== search.index.get(frame.node)) return;
  const component: number[] = [];
  for (let member = search.stack.pop(); member !== undefined; member = search.stack.pop()) {
    search.onStack.delete(member);
    component.push(member);
    if (member === frame.node) break;
  }
  search.components.push(component);
}

function searchFrom(search: Search, root: number): void {
  const frames: Frame[] = [];
  enter(search, root, frames);
  for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
    const successor = search.successors.get(frame.node)?.[frame.next];
    frame.next += 1;
    if (successor === undefined) {
      frames.pop();
      leave(search, frame, frames.at(-1));
    } else if (!search.index.has(successor)) {
      enter(search, successor, frames);
    } else if (search.onStack.has(successor)) {
      lower(search, frame.node, search.index.get(successor) ?? 0);
    }
  }
}

/**
 * The cycles among some nodes, each as its node indices in declaration order,
 * the cycles ordered by the first node declared on each.
 */
export function cyclesAmong(
  nodes: readonly number[],
  edges: readonly (readonly [from: number, to: number])[],
): readonly (readonly number[])[] {
  const members = new Set(nodes);
  const successors = new Map<number, number[]>();
  const looped = new Set<number>();
  for (const [from, to] of edges) {
    if (!members.has(from) || !members.has(to)) continue;
    const list = successors.get(from);
    if (list === undefined) successors.set(from, [to]);
    else list.push(to);
    if (from === to) looped.add(from);
  }
  const search: Search = {
    successors,
    index: new Map(),
    low: new Map(),
    stack: [],
    onStack: new Set(),
    components: [],
  };
  for (const node of nodes) if (!search.index.has(node)) searchFrom(search, node);

  return search.components
    .filter((component) => component.length > 1 || looped.has(component[0] ?? -1))
    .map((component) => component.toSorted((one, other) => one - other))
    .toSorted((one, other) => (one[0] ?? 0) - (other[0] ?? 0));
}
