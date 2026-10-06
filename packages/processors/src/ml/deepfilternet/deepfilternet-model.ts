/**
 * DeepFilterNet 3 as this build runs it: the pack's three graphs, and the
 * settings of the model's `config.ini` and of libDF that the processing
 * around them is built on.
 *
 * DeepFilterNet is by Hendrik Schröter and its contributors
 * (github.com/Rikorose/DeepFilterNet), licensed under the MIT licence or the
 * Apache License 2.0, at the user's option; the pack carries both texts. The
 * values below are those of the model's `config.ini` at commit d375b2d8, and
 * of libDF (`libDF/src/lib.rs`, `libDF/src/tract.rs`) at the same commit.
 */

import { sampleRate, type SampleRate } from '@audiogubbins/domain';
import { GraphOptimisation, InferenceMode } from '@audiogubbins/ml-runtime';

import { PINNED_RUNTIME_SHA256, type ModelDefinition } from '../model-definition.js';

/** 48 kHz, the only rate the model was trained at. */
function modelRate(): SampleRate {
  const rate = sampleRate(48_000);
  if (!rate.ok) throw new Error('48 000 is a sample rate.');
  return rate.value;
}

/** The graphs, by their paths within the pack. */
export const DeepFilterNetGraph = {
  Encoder: 'enc.onnx',
  ErbDecoder: 'erb_dec.onnx',
  DeepFilterDecoder: 'df_dec.onnx',
} as const;

/**
 * The model this build runs: version 1.0.0 of the pack `deepfilternet-3`,
 * whose files are `tools/model-packs/packs/deepfilternet-3.json`'s (a test
 * holds them to it), named by the hash of their listing.
 *
 * Every session is pinned at the graph optimisation level `extended`, whose
 * output was found bit for bit that of `disabled`, `basic` and `all` on the
 * WebAssembly backend and was the fastest of the four.
 */
export const DEEPFILTERNET_3_MODEL: ModelDefinition = {
  identity: {
    pack: 'deepfilternet-3',
    version: '1.0.0',
    modelHash: 'ce0e480b2972cb92a5f22de3c01795baa29a377c680a2932bb6b9c69f1372ee8',
    runtimeHash: PINNED_RUNTIME_SHA256,
  },
  files: [
    {
      path: DeepFilterNetGraph.DeepFilterDecoder,
      sha256: '23114ce3b0f6464b763ee62f7bb8aab6b2a129a21eabd5bcfe59413db05f278a',
    },
    {
      path: DeepFilterNetGraph.Encoder,
      sha256: '7c5399d3da8a50ebef1c1a0ae421b33376aa5e45d0e92df16da7e83c9c131916',
    },
    {
      path: DeepFilterNetGraph.ErbDecoder,
      sha256: 'ab669a1d10afe20911728b33053a452071042317a90581092b325da7b2f9d895',
    },
  ],
  sampleRate: modelRate(),
  inference: { kind: InferenceMode.Pinned, graphOptimisation: GraphOptimisation.Extended },
};

/** The analysis: a 960-sample frame every 480 samples, 481 bins (`[df]` of `config.ini`). */
export const FRAME = 960;
export const HOP = 480;
export const BINS = FRAME / 2 + 1;

/** The ERB bands the gains are made in, and the bins the deep filter and its features cover. */
export const ERB_BANDS = 32;
export const DEEP_FILTER_BINS = 96;

/** The deep filter's taps over frames, and how many of them lie ahead of the frame filtered. */
export const DEEP_FILTER_ORDER = 5;
export const DEEP_FILTER_LOOKAHEAD = 2;

/** How many frames ahead the encoder hears each frame's features (`conv_lookahead`). */
export const FEATURE_LOOKAHEAD = 2;

/**
 * The bins in each ERB band, low to high: libDF's `erb_fb(48000, 960, 32, 2)`,
 * which spaces 32 bands evenly on the ERB scale and gives each at least two
 * bins. They sum to {@link BINS}.
 */
export const ERB_WIDTHS: readonly number[] = [
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 5, 7, 7, 8, 10, 12, 13, 15, 18, 20, 24, 28, 31, 37, 42,
  50, 56, 67,
];

/**
 * The running normalisation's weight of the past: libDF's `calc_norm_alpha`
 * of a one-second `norm_tau` at a 10 ms hop, `exp(−0.01)` rounded to the
 * fewest decimal places below 1, as the model was trained with.
 */
export const NORMALISATION_ALPHA = 0.99;

/** Where each running normalisation starts: libDF's `MEAN_NORM_INIT` and `UNIT_NORM_INIT`. */
export const ERB_NORMALISATION_START = [-60, -90] as const;
export const SPECTRUM_NORMALISATION_START = [0.001, 0.0001] as const;
