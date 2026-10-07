/**
 * How the effect rack answers how a chain is heard (ADR-0061): by the
 * domain's one rule (`chainListening`), which reads only the descriptors of
 * the processors the chain applies, so the page that shows the person how a
 * chain is heard and the threads that play it cannot disagree, and playback
 * never runs live what it would refuse to change running.
 */

import {
  chainListening,
  processorsOf,
  type ChainListening,
  type ProcessorDescriptor,
  type ProcessorId,
} from '@audiogubbins/domain';
import type { ChainRequest, ListeningRequest } from '@audiogubbins/audio-engine';
import type { ProcessorType } from '@audiogubbins/processors';

/** The descriptor of each processor of the request's chain, by instance. */
export function descriptorsOf(
  request: Pick<ChainRequest, 'chain'>,
  types: ReadonlyMap<string, ProcessorType>,
): ReadonlyMap<ProcessorId, ProcessorDescriptor> {
  const descriptors = new Map<ProcessorId, ProcessorDescriptor>();
  for (const processor of processorsOf(request.chain.slots)) {
    const descriptor = types.get(processor.typeKey)?.descriptor;
    if (descriptor !== undefined) descriptors.set(processor.id, descriptor);
  }
  return descriptors;
}

/** The descriptor of every type of `types`, by type key, as the domain's rule reads them. */
export function descriptorsByKey(
  types: ReadonlyMap<string, ProcessorType>,
): ReadonlyMap<string, ProcessorDescriptor> {
  return new Map([...types].map(([key, type]) => [key, type.descriptor] as const));
}

/**
 * How playback hears the request's chain, for a chain this build can build:
 * the domain's rule over the descriptors of `descriptors`.
 */
export function listening(
  request: ListeningRequest,
  descriptors: ReadonlyMap<string, ProcessorDescriptor>,
): ChainListening {
  return chainListening(request.chain, descriptors, {
    sampleRate: request.sampleRate,
    quality: request.quality,
  });
}
