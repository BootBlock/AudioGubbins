/**
 * An immutable map whose `set` returns a new map sharing all but one path with
 * the old: a hash array mapped trie over string keys.
 *
 * REQ-STOR-021 asks for effectively unlimited undo, and the history is an
 * immutable value. Copying a `Map` of every node on every change would make
 * each edit cost as much as the whole history, and a long session quadratic;
 * with this trie a change costs a handful of small arrays, whatever the
 * history's length, and every earlier history value stays whole. Removal is not
 * offered: compaction, the one thing that removes nodes, rebuilds the maps once
 * from what it keeps.
 *
 * Two maps of one lineage share every subtree neither changed, which is how a
 * map's changes since an earlier one are found without visiting the rest: the
 * storage worker sends the page only what changed, and the page's copy of the
 * history stays persistent rather than rebuilt for every change.
 */

/** What changed from one map to another. */
export interface MapChanges<TKey extends string, TValue> {
  /** Each key set to a value the earlier map did not hold for it. */
  readonly set: readonly (readonly [TKey, TValue])[];

  /** Each key the earlier map held and the later one does not. */
  readonly removed: readonly TKey[];
}

/** An immutable map from string keys. */
export interface PersistentMap<TKey extends string, TValue> {
  readonly size: number;
  get(key: TKey): TValue | undefined;
  has(key: TKey): boolean;

  /** The map with `key` holding `value`; this map is unchanged. */
  set(key: TKey, value: TValue): PersistentMap<TKey, TValue>;
  keys(): IterableIterator<TKey>;
  values(): IterableIterator<TValue>;
  entries(): IterableIterator<readonly [TKey, TValue]>;

  /**
   * What changed from `earlier` to this map, skipping every subtree the two
   * share, so a map a few changes from `earlier` costs those changes.
   */
  changesSince(earlier: PersistentMap<TKey, TValue>): MapChanges<TKey, TValue>;

  /**
   * This map with `changes` made to it. A removal rebuilds the map once from
   * what is kept, as compaction does.
   */
  withChanges(changes: MapChanges<TKey, TValue>): PersistentMap<TKey, TValue>;
}

/** The bits of the hash each level of the trie consumes. */
const BITS = 5;
const MASK = (1 << BITS) - 1;

type Trie<TKey extends string, TValue> =
  Branch<TKey, TValue> | Leaf<TKey, TValue> | Collision<TKey, TValue>;

interface Leaf<TKey extends string, TValue> {
  readonly kind: 'leaf';
  readonly hash: number;
  readonly key: TKey;
  readonly value: TValue;
}

/** Keys whose whole hash is the same, which no deeper level can separate. */
interface Collision<TKey extends string, TValue> {
  readonly kind: 'collision';
  readonly hash: number;
  readonly leaves: readonly Leaf<TKey, TValue>[];
}

/** A level: a bit set for each slot of 32 that holds a child, and the children. */
interface Branch<TKey extends string, TValue> {
  readonly kind: 'branch';
  readonly bitmap: number;
  readonly children: readonly Trie<TKey, TValue>[];
}

/** FNV-1a over the key's UTF-16 code units: fast, and spread well enough here. */
function hashOf(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

/** The number of bits set in a 32-bit word. */
function bitCount(word: number): number {
  let bits = word - ((word >>> 1) & 0x55555555);
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (Math.imul((bits + (bits >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

/** The slot of 32 a hash takes at the level `shift` bits down. */
function slotOf(hash: number, shift: number): number {
  return (hash >>> shift) & MASK;
}

const EMPTY_BRANCH: Branch<never, never> = { kind: 'branch', bitmap: 0, children: [] };

/** An empty map. */
export function emptyPersistentMap<TKey extends string, TValue>(): PersistentMap<TKey, TValue> {
  return new Hamt<TKey, TValue>(EMPTY_BRANCH, 0);
}

/** A map of the entries given; a later entry for a key replaces an earlier. */
export function persistentMapOf<TKey extends string, TValue>(
  entries: Iterable<readonly [TKey, TValue]>,
): PersistentMap<TKey, TValue> {
  let map = emptyPersistentMap<TKey, TValue>();
  for (const [key, value] of entries) map = map.set(key, value);
  return map;
}

class Hamt<TKey extends string, TValue> implements PersistentMap<TKey, TValue> {
  readonly size: number;
  private readonly trie: Branch<TKey, TValue>;

  constructor(trie: Branch<TKey, TValue>, size: number) {
    this.trie = trie;
    this.size = size;
  }

  get(key: TKey): TValue | undefined {
    return this.leafOf(key)?.value;
  }

  has(key: TKey): boolean {
    return this.leafOf(key) !== undefined;
  }

  set(key: TKey, value: TValue): PersistentMap<TKey, TValue> {
    const leaf: Leaf<TKey, TValue> = { kind: 'leaf', hash: hashOf(key), key, value };
    const { node, added } = insert(this.trie, 0, leaf);
    if (node === this.trie) return this;
    return new Hamt(node, added ? this.size + 1 : this.size);
  }

  *entries(): IterableIterator<readonly [TKey, TValue]> {
    for (const leaf of leavesOf(this.trie)) yield [leaf.key, leaf.value];
  }

  *keys(): IterableIterator<TKey> {
    for (const leaf of leavesOf(this.trie)) yield leaf.key;
  }

  *values(): IterableIterator<TValue> {
    for (const leaf of leavesOf(this.trie)) yield leaf.value;
  }

  changesSince(earlier: PersistentMap<TKey, TValue>): MapChanges<TKey, TValue> {
    if (!(earlier instanceof Hamt)) {
      throw new Error('A persistent map is compared only with another persistent map.');
    }
    const set: (readonly [TKey, TValue])[] = [];
    const removed: TKey[] = [];
    collectChanges(earlier.trie, this.trie, { set, removed });
    return { set, removed };
  }

  withChanges(changes: MapChanges<TKey, TValue>): PersistentMap<TKey, TValue> {
    return changes.set.reduce<PersistentMap<TKey, TValue>>(
      (map, [key, value]) => map.set(key, value),
      changes.removed.length === 0 ? this : this.without(changes.removed),
    );
  }

  /** This map without the keys given, rebuilt once from what is kept. */
  private without(keys: readonly TKey[]): PersistentMap<TKey, TValue> {
    const removed = new Set(keys);
    return persistentMapOf([...this.entries()].filter(([key]) => !removed.has(key)));
  }

  private leafOf(key: TKey): Leaf<TKey, TValue> | undefined {
    const hash = hashOf(key);
    let node: Trie<TKey, TValue> = this.trie;
    for (let shift = 0; ; shift += BITS) {
      if (node.kind === 'leaf') return node.key === key ? node : undefined;
      if (node.kind === 'collision') return node.leaves.find((leaf) => leaf.key === key);
      const bit = 1 << slotOf(hash, shift);
      if ((node.bitmap & bit) === 0) return undefined;
      const child: Trie<TKey, TValue> | undefined =
        node.children[bitCount(node.bitmap & (bit - 1))];
      if (child === undefined) return undefined;
      node = child;
    }
  }
}

/** Every leaf under a node; the trie is at most seven levels deep. */
function* leavesOf<TKey extends string, TValue>(
  node: Trie<TKey, TValue>,
): Generator<Leaf<TKey, TValue>> {
  if (node.kind === 'leaf') yield node;
  else if (node.kind === 'collision') yield* node.leaves;
  else for (const child of node.children) yield* leavesOf(child);
}

/** The child of a branch in the slot `bit` marks, where it has one. */
function childAt<TKey extends string, TValue>(
  branch: Branch<TKey, TValue>,
  bit: number,
): Trie<TKey, TValue> | undefined {
  if ((branch.bitmap & bit) === 0) return undefined;
  return branch.children[bitCount(branch.bitmap & (bit - 1))];
}

/**
 * Adds to `changes` what differs between two nodes in one place of two tries.
 * The same node is the same entries; two branches are compared slot by slot;
 * any other pair is compared by the leaves under each, of which a leaf or a
 * collision has few.
 */
function collectChanges<TKey extends string, TValue>(
  earlier: Trie<TKey, TValue> | undefined,
  later: Trie<TKey, TValue> | undefined,
  changes: { set: (readonly [TKey, TValue])[]; removed: TKey[] },
): void {
  if (earlier === later) return;
  if (earlier?.kind === 'branch' && later?.kind === 'branch') {
    const slots = earlier.bitmap | later.bitmap;
    for (let slot = 0; slot < 1 << BITS; slot += 1) {
      const bit = 1 << slot;
      if ((slots & bit) !== 0) collectChanges(childAt(earlier, bit), childAt(later, bit), changes);
    }
    return;
  }
  const before = new Map<TKey, TValue>();
  if (earlier !== undefined) for (const leaf of leavesOf(earlier)) before.set(leaf.key, leaf.value);
  if (later !== undefined) {
    for (const leaf of leavesOf(later)) {
      if (!before.has(leaf.key) || !Object.is(before.get(leaf.key), leaf.value)) {
        changes.set.push([leaf.key, leaf.value]);
      }
      before.delete(leaf.key);
    }
  }
  changes.removed.push(...before.keys());
}

interface Placed<TNode> {
  readonly node: TNode;
  readonly added: boolean;
}

/**
 * The branch with the leaf set in it. The same branch where the key already
 * held the same value, so setting what is there makes no new map.
 */
function insert<TKey extends string, TValue>(
  branch: Branch<TKey, TValue>,
  shift: number,
  leaf: Leaf<TKey, TValue>,
): Placed<Branch<TKey, TValue>> {
  const bit = 1 << slotOf(leaf.hash, shift);
  const index = bitCount(branch.bitmap & (bit - 1));
  if ((branch.bitmap & bit) === 0) {
    return {
      node: {
        kind: 'branch',
        bitmap: branch.bitmap | bit,
        children: branch.children.toSpliced(index, 0, leaf),
      },
      added: true,
    };
  }
  const child = branch.children[index];
  if (child === undefined) throw new Error('A trie branch has fewer children than its bitmap.');
  const { node, added } = placed(child, shift + BITS, leaf);
  if (node === child) return { node: branch, added: false };
  return {
    node: { kind: 'branch', bitmap: branch.bitmap, children: branch.children.with(index, node) },
    added,
  };
}

/** The node that was `node`, with the leaf set in it, one level down. */
function placed<TKey extends string, TValue>(
  node: Trie<TKey, TValue>,
  shift: number,
  leaf: Leaf<TKey, TValue>,
): Placed<Trie<TKey, TValue>> {
  if (node.kind === 'branch') return insert(node, shift, leaf);
  if (node.kind === 'leaf') {
    if (node.key === leaf.key) {
      return { node: Object.is(node.value, leaf.value) ? node : leaf, added: false };
    }
    if (node.hash === leaf.hash) {
      return { node: { kind: 'collision', hash: leaf.hash, leaves: [node, leaf] }, added: true };
    }
    return { node: split(node, leaf, shift), added: true };
  }
  if (node.hash !== leaf.hash) return { node: split(node, leaf, shift), added: true };
  const at = node.leaves.findIndex((held) => held.key === leaf.key);
  if (at === -1) return { node: { ...node, leaves: [...node.leaves, leaf] }, added: true };
  if (Object.is(node.leaves[at]?.value, leaf.value)) return { node, added: false };
  return { node: { ...node, leaves: node.leaves.with(at, leaf) }, added: false };
}

/**
 * A branch holding two nodes of different hashes. Their hashes differ in some
 * bit, so the levels this adds stop before the hash runs out.
 */
function split<TKey extends string, TValue>(
  held: Leaf<TKey, TValue> | Collision<TKey, TValue>,
  leaf: Leaf<TKey, TValue>,
  shift: number,
): Branch<TKey, TValue> {
  const heldSlot = slotOf(held.hash, shift);
  const leafSlot = slotOf(leaf.hash, shift);
  if (heldSlot === leafSlot) {
    return { kind: 'branch', bitmap: 1 << heldSlot, children: [split(held, leaf, shift + BITS)] };
  }
  return {
    kind: 'branch',
    bitmap: (1 << heldSlot) | (1 << leafSlot),
    children: heldSlot < leafSlot ? [held, leaf] : [leaf, held],
  };
}
