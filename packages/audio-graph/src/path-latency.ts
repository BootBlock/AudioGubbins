/**
 * How late the audio on a path through a graph is.
 *
 * A path's latency is the sum of the latencies of the nodes along it. Where a
 * node on it cannot say its latency, the sum is not a number: it is the frames
 * that are known together with the nodes that are not, each with its reason, so
 * that a monitoring display can say which processor makes its figure uncertain
 * (REQ-ARCH-144). Keeping the unknown nodes, rather than a flag, is also what
 * lets the analysis tell two paths that share one unknown node, which are still
 * aligned to each other, from two that do not.
 */

import type { SampleCount } from '@audiogubbins/domain';

import type { NodeId } from './node-id.js';

/** A node on a path whose latency is not known, and why. */
export interface UnknownLatencyCause {
  readonly node: NodeId;
  readonly reason: string;
}

/** The latency of a path: frames, or the frames known and the nodes not. */
export type PathLatency =
  | { readonly kind: 'known'; readonly frames: SampleCount }
  | {
      readonly kind: 'unknown';
      readonly knownFrames: SampleCount;
      readonly causes: readonly [UnknownLatencyCause, ...UnknownLatencyCause[]];
    };

/** The frames of a path's latency that are known. */
export function framesOf(path: PathLatency): SampleCount {
  return path.kind === 'known' ? path.frames : path.knownFrames;
}

/** The nodes on a path whose latency is not known, in running order. */
export function causesOf(path: PathLatency): readonly UnknownLatencyCause[] {
  return path.kind === 'known' ? [] : path.causes;
}

/** A path's latency from its known frames and its unknown nodes. */
export function pathLatency(
  frames: SampleCount,
  causes: readonly UnknownLatencyCause[],
): PathLatency {
  const [first, ...rest] = causes;
  return first === undefined
    ? { kind: 'known', frames }
    : { kind: 'unknown', knownFrames: frames, causes: [first, ...rest] };
}

/** Whether two paths pass through the same nodes of unknown latency. */
export function sameCauses(one: PathLatency, other: PathLatency): boolean {
  const [ours, theirs] = [causesOf(one), causesOf(other)];
  return (
    ours.length === theirs.length &&
    ours.every((cause, index) => cause.node === theirs[index]?.node)
  );
}

/**
 * Every node of unknown latency on any of the paths, once each, in running
 * order as `rank` gives it.
 */
export function unionOfCauses(
  paths: readonly PathLatency[],
  rank: ReadonlyMap<NodeId, number>,
): readonly UnknownLatencyCause[] {
  const byNode = new Map<NodeId, UnknownLatencyCause>();
  for (const cause of paths.flatMap(causesOf)) byNode.set(cause.node, cause);
  return [...byNode.values()].toSorted(
    (one, other) => (rank.get(one.node) ?? 0) - (rank.get(other.node) ?? 0),
  );
}

/**
 * The latest of several paths: the most known frames, and every unknown node
 * on any of them, since the unknown part could make any one the latest.
 */
export function latestOf(
  paths: readonly PathLatency[],
  rank: ReadonlyMap<NodeId, number>,
  none: SampleCount,
): PathLatency {
  const frames = paths.map(framesOf).reduce((most, one) => (one > most ? one : most), none);
  return pathLatency(frames, unionOfCauses(paths, rank));
}
