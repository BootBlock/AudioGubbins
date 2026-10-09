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

import {
  DeterminismClass,
  ZERO_SAMPLES,
  succeed,
  type ChannelLayout,
  type ParameterDescriptor,
  type ProcessorCategory,
  type ProcessorDescriptor,
} from '@audiogubbins/domain';
import { CANONICAL_RESAMPLER_VERSION } from '@audiogubbins/audio-engine';

import { processorType, type ProcessorType } from '../framework/processor-type.js';
import type { ModelDefinition } from './model-definition.js';
import { ModelPass, type ModelStreamOf } from './model-pass.js';
import { playbackKernel } from './model-playback.js';
import type { ModelServices } from './model-sessions.js';

/** What one machine-learning type's descriptor says that another's need not. */
export interface ModelDescription {
  readonly typeKey: string;
  readonly label: string;
  readonly category: ProcessorCategory;
  /** The implementation's and the parameters' versions, which rise apart. */
  readonly implementation: number;
  readonly parameterVersion: number;
  readonly model: ModelDefinition;
  readonly parameters: readonly ParameterDescriptor[];
  /** The output's layout from the input's, or why the model cannot hear it: the input's where not given. */
  readonly outputLayout?: ProcessorDescriptor['outputLayout'];
}

/**
 * The descriptor of the machine-learning type `description` describes, whatever
 * every such type states alike: a whole pass that is its inference, never
 * real-time, pinned on every quality level since no processor offers a preview
 * path, the resampling grade the one quality setting it reads, the canonical
 * resampler's and the model's identities in its version, and a kernel that
 * plays the pass back aligned to the input, so its latency is known zero, its
 * lead-in 0 and its frame grid 1.
 */
export function modelDescriptor(description: ModelDescription): ProcessorDescriptor {
  const { typeKey, label, category, model, parameters } = description;
  return {
    typeKey,
    label,
    category,
    version: {
      implementation: description.implementation,
      parameters: description.parameterVersion,
      resampler: CANONICAL_RESAMPLER_VERSION,
      model: model.identity,
    },
    parameters,
    qualitySettings: ['resampling'],
    determinism: DeterminismClass.Pinned,
    wholePass: true,
    realTime: false,
    outputLayout: description.outputLayout ?? ((input) => succeed(input)),
    latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
    leadIn: () => 0,
    frameGrid: () => 1,
  };
}

/**
 * The most a model's pass holds over `frames` frames: its output over the
 * whole stream, frame for frame, twice at the moment it is made planar
 * (`PlanarOutput`), after which the planar copy alone is kept for the run.
 */
function modelPassBytes(frames: number, output: ChannelLayout): number {
  return 2 * frames * output.roles.length * Float32Array.BYTES_PER_ELEMENT;
}

/** What a machine-learning processor is defined by. */
export interface ModelProcessor {
  /** Its {@link modelDescriptor}. */
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
    measurementBytes: modelPassBytes,
  });
}
