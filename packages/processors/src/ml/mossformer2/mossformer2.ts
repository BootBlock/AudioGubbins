/**
 * MossFormer2 SE 48K: speech and dialogue enhancement at 48 kHz by a neural
 * network that removes background noise (ADR-0062), from the model pack
 * `mossformer2-se-48k`, the most thorough and the costliest of the
 * restoration models.
 *
 * MossFormer2 SE 48K is by Shengkui Zhao, Zexu Pan and ClearerVoice-Studio's
 * contributors (github.com/modelscope/ClearerVoice-Studio), under the Apache
 * License 2.0; the processing around its graph is ported from
 * ClearerVoice-Studio's decode, and from the torchaudio and PyTorch
 * functions it calls, as each module here says.
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
 * It has no parameters: ClearerVoice-Studio's decode exposes none, its mask
 * being applied whole.
 */

import { ProcessorCategory, type ProcessorDescriptor } from '@audiogubbins/domain';

import type { ProcessorType } from '../../framework/processor-type.js';
import { modelDescriptor, modelProcessorType, type ModelProcessor } from '../model-processor.js';
import type { ModelServices } from '../model-sessions.js';
import { MOSSFORMER2_SE_48K_MODEL } from './mossformer2-model.js';
import { MossFormer2Stream } from './mossformer2-stream.js';

/** MossFormer2 SE 48K's descriptor, the one the catalogue lists. */
export const MOSSFORMER2_SE_48K_DESCRIPTOR: ProcessorDescriptor = modelDescriptor({
  typeKey: 'mossformer2-se-48k',
  label: 'MossFormer2 SE 48K',
  category: ProcessorCategory.Restoration,
  implementation: 1,
  parameterVersion: 1,
  model: MOSSFORMER2_SE_48K_MODEL,
  parameters: [],
});

/** MossFormer2 SE 48K's definition: its descriptor, model and stream. */
export const MOSSFORMER2_SE_48K: ModelProcessor = {
  descriptor: MOSSFORMER2_SE_48K_DESCRIPTOR,
  model: MOSSFORMER2_SE_48K_MODEL,
  stream: (sessions, run, emit) =>
    new MossFormer2Stream(sessions, run.input.roles.length, run.dsp, emit),
};

/** MossFormer2 SE 48K, as a processor of the rack, running its model through `services`. */
export function mossFormer2Se48k(services: ModelServices): ProcessorType {
  return modelProcessorType(MOSSFORMER2_SE_48K, services);
}
