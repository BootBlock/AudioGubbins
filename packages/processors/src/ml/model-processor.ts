/**
 * A machine-learning processor type: a whole-pass processor whose pass is
 * its inference and whose kernel plays the pass's output back (ADR-0062,
 * decision 19 of the phase), made with the inference port and the model
 * library it runs its model through.
 *
 * Its descriptor is a module constant, so the catalogue the domain checks
 * chains against lists it with no runtime at hand; only the type that runs it
 * needs the services, injected once.
 */

import type { ProcessorDescriptor } from '@audiogubbins/domain';

import { processorType, type ProcessorType } from '../framework/processor-type.js';
import type { ModelDefinition } from './model-definition.js';
import { ModelPass, type ModelStreamOf } from './model-pass.js';
import { playbackKernel } from './model-playback.js';
import type { ModelServices } from './model-sessions.js';

/** What a machine-learning processor is defined by. */
export interface ModelProcessor {
  /** Whole-pass, not real-time, pinned, with the model's identity as its version's. */
  readonly descriptor: ProcessorDescriptor;
  readonly model: ModelDefinition;
  readonly stream: ModelStreamOf;
}

/** The processor type `processor` defines, running its model through `services`. */
export function modelProcessorType(
  processor: ModelProcessor,
  services: ModelServices,
): ProcessorType {
  const { descriptor, model, stream } = processor;
  const label = descriptor.label;
  return processorType({
    descriptor,
    kernel: (run) => playbackKernel(run, label),
    measure: (run) => new ModelPass(run, model, services, stream),
  });
}
