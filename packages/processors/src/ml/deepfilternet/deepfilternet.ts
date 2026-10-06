/**
 * DeepFilterNet 3: broadband noise removal and speech enhancement at 48 kHz
 * by a neural network (ADR-0062), from the model pack `deepfilternet-3`.
 *
 * DeepFilterNet is by Hendrik Schröter and its contributors
 * (github.com/Rikorose/DeepFilterNet), under the MIT licence or the Apache
 * License 2.0, at the user's option; the processing around its graphs is
 * ported from its libDF and Python pipeline, as each module here says.
 *
 * It is a whole-pass processor whose pass is its inference: every channel of
 * any layout is enhanced on its own, at 48 kHz, converted to and back by the
 * canonical resampler where the stream's rate is another, and the output's
 * layout is the input's. Its kernel plays back what the pass made, aligned to
 * the input, so its latency is known zero, its lead-in 0 and its frame grid
 * 1. Its determinism is pinned: every quality level runs the pinned session,
 * since no processor chooses a preview's accelerator yet, and the resampling
 * grade is the one quality setting it reads.
 *
 * Its parameters are libDF's, with libDF's defaults: the attenuation limit, the
 * most the noise is lowered, in decibels, where 100 dB or more is no limit and
 * less than 0.01 dB leaves the input as it was; and the post-filter, off by
 * default, which deepens the attenuation of bins the model judged mostly noise,
 * by its β.
 */

import {
  DeterminismClass,
  ParameterTaper,
  ProcessorCategory,
  ZERO_SAMPLES,
  succeed,
  unsafeBrandId,
  type NumericParameterDescriptor,
  type ProcessorDescriptor,
  type ToggleParameterDescriptor,
} from '@audiogubbins/domain';
import { decibelsToGain } from '@audiogubbins/audio-engine';

import type { ParameterReader, ProcessorType } from '../../framework/processor-type.js';
import { CANONICAL_RESAMPLER_VERSION } from '../model-definition.js';
import { modelProcessorType, type ModelProcessor } from '../model-processor.js';
import type { ModelServices } from '../model-sessions.js';
import { DEEPFILTERNET_3_MODEL } from './deepfilternet-model.js';
import { DeepFilterNetStream } from './deepfilternet-stream.js';
import type { Finishing } from './enhancement.js';

const attenuationLimit: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('f1000000-0001'),
  key: 'attenuation-limit',
  label: 'Attenuation limit',
  minimum: 0,
  maximum: 100,
  defaultValue: 100,
  taper: ParameterTaper.Linear,
  unit: 'dB',
  step: 0.5,
};

const postFilter: ToggleParameterDescriptor = {
  kind: 'toggle',
  id: unsafeBrandId<'ParameterId'>('f1000000-0002'),
  key: 'post-filter',
  label: 'Post-filter',
  defaultValue: false,
};

const postFilterBeta: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('f1000000-0003'),
  key: 'post-filter-beta',
  label: 'Post-filter strength',
  minimum: 0.001,
  maximum: 0.1,
  defaultValue: 0.02,
  taper: ParameterTaper.Linear,
  step: 0.001,
};

/** libDF's attenuation limit at or above which there is none, and below which nothing is lowered. */
const NO_LIMIT = 100;
const NO_ATTENUATION = 0.01;

/** How the enhanced spectrum is finished, from the parameters, as libDF reads them. */
function finishingOf(parameters: ParameterReader): Finishing {
  const limit = parameters.number(attenuationLimit.key);
  return {
    postFilter: parameters.toggle(postFilter.key)
      ? parameters.number(postFilterBeta.key)
      : undefined,
    limit: limit >= NO_LIMIT ? undefined : limit < NO_ATTENUATION ? 1 : decibelsToGain(-limit),
  };
}

/** DeepFilterNet 3's descriptor, the one the catalogue lists. */
export const DEEPFILTERNET_3_DESCRIPTOR: ProcessorDescriptor = {
  typeKey: 'deepfilternet-3',
  label: 'DeepFilterNet 3',
  category: ProcessorCategory.Restoration,
  version: {
    implementation: 1,
    parameters: 1,
    resampler: CANONICAL_RESAMPLER_VERSION,
    model: DEEPFILTERNET_3_MODEL.identity,
  },
  parameters: [attenuationLimit, postFilter, postFilterBeta],
  qualitySettings: ['resampling'],
  determinism: DeterminismClass.Pinned,
  wholePass: true,
  realTime: false,
  outputLayout: (input) => succeed(input),
  latency: () => ({ kind: 'known', frames: ZERO_SAMPLES }),
  leadIn: () => 0,
  frameGrid: () => 1,
};

/** DeepFilterNet 3's definition: its descriptor, model and stream. */
export const DEEPFILTERNET_3: ModelProcessor = {
  descriptor: DEEPFILTERNET_3_DESCRIPTOR,
  model: DEEPFILTERNET_3_MODEL,
  stream: (sessions, run, emit) =>
    new DeepFilterNetStream(
      sessions,
      run.input.roles.length,
      run.dsp,
      finishingOf(run.parameters),
      emit,
    ),
};

/** DeepFilterNet 3, as a processor of the rack, running its model through `services`. */
export function deepFilterNet3(services: ModelServices): ProcessorType {
  return modelProcessorType(DEEPFILTERNET_3, services);
}
