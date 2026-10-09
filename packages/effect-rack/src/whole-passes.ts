/**
 * Which processors of a chain measure their whole input, and what their
 * measurements hold in memory over a stream: the rack measures each before it
 * runs the chain (`chain-run.ts`), and a cache of renders counts what they
 * hold against its bound before it starts one.
 */

import { processorsOf } from '@audiogubbins/domain';
import type { ChainRequest } from '@audiogubbins/audio-engine';
import type { ProcessorType } from '@audiogubbins/processors';

import type { ChainGraph } from './chain-graph.js';

/** The chain's applied processors that measure their whole input, in signal order. */
export function measuredProcessors(
  built: ChainGraph,
  request: Pick<ChainRequest, 'chain'>,
  types: ReadonlyMap<string, ProcessorType>,
) {
  return [...processorsOf(request.chain.slots)].filter(
    (processor) =>
      built.processors.has(processor.id) &&
      types.get(processor.typeKey)?.descriptor.wholePass === true,
  );
}

/**
 * The most bytes the whole passes of `built`'s chain hold over a stream of
 * `frames` frames: every measurement is kept until the run ends, so they add.
 */
export function measurementBytesOf(
  built: ChainGraph,
  request: Pick<ChainRequest, 'chain'>,
  types: ReadonlyMap<string, ProcessorType>,
  frames: number,
): number {
  let bytes = 0;
  for (const processor of measuredProcessors(built, request, types)) {
    const counted = types.get(processor.typeKey)?.measurementBytes;
    const id = built.processors.get(processor.id);
    const node = built.graph.nodes.find((one) => one.id === id);
    const output = node?.kind === 'processing' ? node.outputs[0]?.layout : undefined;
    if (counted !== undefined && output !== undefined) bytes += counted(frames, output);
  }
  return bytes;
}
