/**
 * Spleeter: music source separation at 44.1 kHz by a neural network
 * (ADR-0062), two stems from the model pack `spleeter-2-stems` and four from
 * `spleeter-4-stems`, each its own processor type on one implementation.
 *
 * Spleeter is by Deezer (github.com/deezer/spleeter), Copyright (c)
 * 2019-present Deezer SA, under the MIT licence, its pre-trained models
 * included; the processing around its graph is ported from its own pipeline,
 * as each module here says.
 *
 * It is a whole-pass processor whose pass is its inference. It takes stereo,
 * as the model was trained, or mono, heard as stereo, and refuses any other
 * layout with the reason; the output's layout is the input's, holding the
 * stem its parameter chooses. It runs at 44.1 kHz, converted to and back by
 * the canonical resampler where the stream's rate is another. Its kernel
 * plays back what the pass made, aligned to the input, so its latency is
 * known zero, its lead-in 0 and its frame grid 1. Its determinism is pinned:
 * every quality level runs the pinned session, since no processor chooses a
 * preview's accelerator yet, and the resampling grade is the one quality
 * setting it reads.
 */

import {
  ChannelRole,
  FailureKind,
  ProcessorCategory,
  fail,
  failure,
  succeed,
  unsafeBrandId,
  type ChannelLayout,
  type ChoiceParameterDescriptor,
  type DomainResult,
  type ProcessorDescriptor,
} from '@audiogubbins/domain';

import type { ProcessorType } from '../../framework/processor-type.js';
import { modelDescriptor, modelProcessorType, type ModelProcessor } from '../model-processor.js';
import type { ModelServices } from '../model-sessions.js';
import {
  SPLEETER_2_STEMS_MODEL,
  SPLEETER_4_STEMS_MODEL,
  type SpleeterModel,
} from './spleeter-model.js';
import { SpleeterStream } from './spleeter-stream.js';

/** The key of the parameter that chooses the stem the output holds. */
const STEM = 'stem';

/**
 * The layout the output holds, which is the input's: mono, or a stereo
 * pair, or why the model cannot hear any other.
 */
function outputLayout(input: ChannelLayout): DomainResult<ChannelLayout> {
  const [first, second, ...rest] = input.roles;
  const stereo = first === ChannelRole.Left && second === ChannelRole.Right && rest.length === 0;
  if (second === undefined || stereo) return succeed(input);
  return fail(
    failure(
      'processor.layout-refused',
      FailureKind.Rejected,
      `Spleeter separates a stereo mix, as its models were trained on, or a mono one heard as stereo; this input's ${String(input.roles.length)} channels are not a left and right pair, and a fold to stereo would choose what the mix is. Fold it to stereo first, or separate a stereo or mono stream.`,
    ),
  );
}

/** A Spleeter model's processor: its descriptor, its stem parameter and its stream. */
function spleeterProcessor(
  model: SpleeterModel,
  typeKey: string,
  label: string,
  parameterId: string,
): ModelProcessor {
  const [first, ...others] = model.stems;
  const stem: ChoiceParameterDescriptor = {
    kind: 'choice',
    id: unsafeBrandId<'ParameterId'>(parameterId),
    key: STEM,
    label: 'Stem',
    options: [
      { key: first.key, label: first.label },
      ...others.map(({ key, label: stemLabel }) => ({ key, label: stemLabel })),
    ],
    defaultKey: first.key,
  };
  const descriptor = modelDescriptor({
    typeKey,
    label,
    category: ProcessorCategory.Separation,
    implementation: 1,
    parameterVersion: 1,
    model: model.definition,
    parameters: [stem],
    outputLayout,
  });
  return {
    descriptor,
    model: model.definition,
    stream: (sessions, run, emit) => {
      const chosen = run.parameters.choice(STEM);
      const index = model.stems.findIndex(({ key }) => key === chosen);
      // The instance's values were checked against the stem's options.
      if (index < 0) throw new Error(`${label} has no stem ${chosen}.`);
      return new SpleeterStream(sessions, model, index, run.input.roles.length, run.dsp, emit);
    },
  };
}

/** Spleeter's two-stem definition: vocals and accompaniment. */
export const SPLEETER_2_STEMS: ModelProcessor = spleeterProcessor(
  SPLEETER_2_STEMS_MODEL,
  'spleeter-2-stems',
  'Spleeter, two stems',
  'f3000000-0001',
);

/** Spleeter's four-stem definition: vocals, drums, bass and other. */
export const SPLEETER_4_STEMS: ModelProcessor = spleeterProcessor(
  SPLEETER_4_STEMS_MODEL,
  'spleeter-4-stems',
  'Spleeter, four stems',
  'f3000000-0002',
);

/** Spleeter's two-stem descriptor, the one the catalogue lists. */
export const SPLEETER_2_STEMS_DESCRIPTOR: ProcessorDescriptor = SPLEETER_2_STEMS.descriptor;

/** Spleeter's four-stem descriptor, the one the catalogue lists. */
export const SPLEETER_4_STEMS_DESCRIPTOR: ProcessorDescriptor = SPLEETER_4_STEMS.descriptor;

/** Spleeter's two stems, as a processor of the rack, running its model through `services`. */
export function spleeter2Stems(services: ModelServices): ProcessorType {
  return modelProcessorType(SPLEETER_2_STEMS, services);
}

/** Spleeter's four stems, as a processor of the rack, running its model through `services`. */
export function spleeter4Stems(services: ModelServices): ProcessorType {
  return modelProcessorType(SPLEETER_4_STEMS, services);
}
