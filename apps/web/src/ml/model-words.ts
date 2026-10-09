/**
 * What a reader is told of a machine-learning processor that cannot run, by
 * which of REQ-AUDIO-139's conditions holds: its model unavailable, its model
 * incompatible with the runtime this build uses, or this browser or device
 * unable to run it. An update offered is no reason not to run.
 */

import type { PackAvailability } from '@audiogubbins/model-packs';
import type { ProcessorInstance } from '@audiogubbins/domain';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import type { ModelGate } from '../assets/model-gate.js';
import type { Observable } from '../state/observable.js';
import { processorAvailability, type KnownAvailability } from './model-availability.js';

/** Why the processor labelled `label` cannot run, or nothing where it can. */
function modelRefusalWords(label: string, availability: PackAvailability): string | undefined {
  switch (availability.condition) {
    case 'available':
    case 'update-available':
      return undefined;
    case 'required-unavailable':
    case 'optional-unavailable':
      return `${label} cannot run because the model it needs is not available. ${availability.reason.summary}`;
    case 'incompatible':
      return `${label} cannot run because its model is incompatible with the inference runtime this build uses. ${availability.reason.summary}`;
    case 'device-unavailable':
      return `${label} cannot run on this browser or device. ${availability.reason.summary}`;
  }
}

/**
 * The gate of availability as the page knows it: none refused while it is
 * not yet known, since a render that finds a model missing says so itself.
 */
function modelGateOf(known: KnownAvailability): ModelGate {
  if (known.kind === 'unknown') return () => undefined;
  const { context } = known;
  return (processor: ProcessorInstance) => {
    const availability = processorAvailability(processor, context);
    if (availability === undefined) return undefined;
    const label = PROCESSOR_CATALOGUE.get(processor.typeKey)?.label ?? processor.typeKey;
    return modelRefusalWords(label, availability);
  };
}

/**
 * The gate of `availability` as it changes, one gate per value it takes, so a
 * reader that compares gates by identity sees a change only when there is one.
 */
export function modelGates(availability: Observable<KnownAvailability>): Observable<ModelGate> {
  let known = availability.get();
  let gate = modelGateOf(known);
  return {
    get: () => {
      const now = availability.get();
      if (now !== known) {
        known = now;
        gate = modelGateOf(now);
      }
      return gate;
    },
    subscribe: availability.subscribe,
  };
}
