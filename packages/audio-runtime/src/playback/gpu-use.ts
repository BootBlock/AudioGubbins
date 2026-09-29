/**
 * Whether playback's graph runs anything on the GPU, as the Audio engine panel
 * says it.
 *
 * The engine chooses each node's path (`selectNodePaths`) from what the page
 * was told it may use, and this is that choice summed up for one graph: the
 * GPU the browser does not offer, offered and used by no processor of the
 * graph, or used by the processors named. Reported as chosen, so the panel
 * never claims more acceleration than the graph runs.
 */

import type { NodeId } from '@audiogubbins/audio-graph';
import { Accelerator, type NodePath } from '@audiogubbins/audio-engine';

/** Whether a graph runs anything on the GPU. */
export const GpuUseKind = {
  /** The browser offers the engine no GPU. */
  Unavailable: 'unavailable',
  /** A GPU is offered, and no processor of the graph has a path that runs on it. */
  Unused: 'unused',
  /** The processors named run on the GPU. */
  Used: 'used',
} as const;

export type GpuUseKind = (typeof GpuUseKind)[keyof typeof GpuUseKind];

export type GpuUse =
  | { readonly kind: typeof GpuUseKind.Unavailable }
  | { readonly kind: typeof GpuUseKind.Unused }
  | { readonly kind: typeof GpuUseKind.Used; readonly nodes: readonly NodeId[] };

/** What `paths`, chosen where the GPU was `offered` or not, run on it. */
export function gpuUseOf(paths: readonly NodePath[], offered: boolean): GpuUse {
  if (!offered) return { kind: GpuUseKind.Unavailable };
  const nodes = paths
    .filter((path) => path.accelerator === Accelerator.Gpu)
    .map(({ node }) => node);
  return nodes.length === 0 ? { kind: GpuUseKind.Unused } : { kind: GpuUseKind.Used, nodes };
}
