/**
 * MossFormer2 SE 48K as this build runs it: the pack's one graph, and the
 * settings of ClearerVoice-Studio's 48 kHz speech enhancement that the
 * processing around it is built on.
 *
 * MossFormer2 SE 48K and ClearerVoice-Studio are by Shengkui Zhao, Zexu Pan and
 * ClearerVoice-Studio's contributors
 * (github.com/modelscope/ClearerVoice-Studio), licensed under the Apache
 * License 2.0; the pack carries the text. The values below are those of
 * `clearvoice/config/inference/MossFormer2_SE_48K.yaml` and of
 * `decode_one_audio_mossformer2_se_48k` in `clearvoice/utils/decode.py`, at
 * commit 6b3774dc.
 */

import { GraphOptimisation } from '@audiogubbins/ml-runtime';

import { PINNED_RUNTIME_SHA256, modelRate, type ModelDefinition } from '../model-definition.js';

/** The graph, by its path within the pack. */
export const MOSSFORMER2_GRAPH = 'model.onnx';

/**
 * The model this build runs: version 1.0.0 of the pack `mossformer2-se-48k`,
 * named by the listing of every file of
 * `tools/model-packs/packs/mossformer2-se-48k.json`, its licence, model card
 * and notice with its graph, which is the file it runs (a test holds both to
 * the definition).
 *
 * Every session is pinned at the graph optimisation level `basic`. Measured on
 * the WebAssembly backend over two segments, each level gave the same bits on
 * every run, and the levels' outputs differed by at most 2·10⁻⁷: `basic` and
 * `extended` (whose bits `layout` and `all` share) took 8.0 to 8.9 s alike,
 * `layout` and `all` a little longer and `disabled` 13 s. Of the two fastest,
 * `basic` only folds and prunes the standard operators the export wrote, where
 * `extended` also fuses them into kernels of the runtime's own, so `basic`
 * rests a render on the fewest of those.
 */
export const MOSSFORMER2_SE_48K_MODEL: ModelDefinition = {
  identity: {
    pack: 'mossformer2-se-48k',
    version: '1.0.0',
    modelHash: '2a8430b232ed702ec63df6060467a5a3c61f4af74beebb637c01469283934e3c',
    runtimeHash: PINNED_RUNTIME_SHA256,
  },
  files: [
    {
      path: MOSSFORMER2_GRAPH,
      sha256: '9f83b49bb27c08ab6d6a2ba83d7aeca08f90945b7b1dce5e157003f733918989',
    },
  ],
  // The only rate the model was trained at (`sampling_rate`).
  sampleRate: modelRate(48_000),
  inference: { graphOptimisation: GraphOptimisation.Basic },
};

/**
 * The analysis, shared by the features and the masked spectrum: a frame of 1
 * 920 samples, 40 ms, every 384 samples, 8 ms (`win_len`, `win_inc`), with a
 * transform as long as the frame (`fft_len`), so the mask has 961 bins.
 */
export const FRAME = 1_920;
export const HOP = 384;
export const BINS = FRAME / 2 + 1;

/**
 * The frames of a signal of `samples` samples: those that lie wholly within it,
 * as both Kaldi's analysis (`snip_edges`) and an STFT without centring take
 * them.
 */
export function framesOf(samples: number): number {
  return samples < FRAME ? 0 : 1 + Math.floor((samples - FRAME) / HOP);
}

/** The mel bands of the filter bank (`num_mels`), and the features a frame gives the graph. */
export const MEL_BANDS = 60;
export const FEATURES = 3 * MEL_BANDS;

/**
 * The analysis of 16-bit samples the features are taken from: the decode scales
 * the stream by 2¹⁵ (`MAX_WAV_VALUE`) before anything else.
 */
export const SAMPLE_SCALE = 32_768;
