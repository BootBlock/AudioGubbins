/**
 * Spleeter as this build runs it: the two packs' graphs, the stems each
 * gives, and the settings of Spleeter's own configuration that the
 * processing around the graph is built on.
 *
 * Spleeter is by Deezer (github.com/deezer/spleeter), Copyright (c)
 * 2019-present Deezer SA, under the MIT licence; the pack carries its text.
 * The values below are those of `spleeter/resources/2stems.json` and
 * `4stems.json` and of `spleeter/model/__init__.py` at the v1.4.0 release's
 * commit 556ef212, which made the checkpoints, and are unchanged on the
 * project's main line at c8854001.
 */

import { GraphOptimisation } from '@audiogubbins/ml-runtime';

import { PINNED_RUNTIME_SHA256, modelRate, type ModelDefinition } from '../model-definition.js';

/** The graph, by its path within either pack. */
export const SPLEETER_GRAPH = 'model.onnx';

/**
 * How every session is opened: pinned at the graph optimisation level
 * `disabled`, the graph's arithmetic as it was exported. On the WebAssembly
 * backend every level gave the same bits for both packs and ran a segment in
 * the same time, within a few per cent, so no fusion earns its place.
 */
const PINNED = {
  graphOptimisation: GraphOptimisation.Disabled,
} as const;

/** A Spleeter model: its definition and its stems, in the order its graph gives them. */
export interface SpleeterModel {
  readonly definition: ModelDefinition;
  /** Each stem's key, its graph's output name, and its label. */
  readonly stems: readonly [SpleeterStem, ...SpleeterStem[]];
}

/** One stem a model separates. */
export interface SpleeterStem {
  /** The graph's output of the stem's estimated magnitude, and the parameter's option key. */
  readonly key: string;
  readonly label: string;
}

/**
 * The two-stem model: version 1.0.1 of the pack `spleeter-2-stems`, named by
 * the listing of every file of `tools/model-packs/packs/spleeter-2-stems.json`,
 * its licence and notice with its graph, which is the file it runs (a test
 * holds both to the definition).
 */
export const SPLEETER_2_STEMS_MODEL: SpleeterModel = {
  definition: {
    identity: {
      pack: 'spleeter-2-stems',
      version: '1.0.1',
      modelHash: '3e11bc388306ca1271daf8f26c70f89a7659cc281d96a9dafb2dcb6d275901bf',
      runtimeHash: PINNED_RUNTIME_SHA256,
    },
    files: [
      {
        path: SPLEETER_GRAPH,
        sha256: '6059919bb51cf53e12ebe732aeca45de99190f90bd2ec46b1e9e6328a3b051df',
      },
    ],
    // The only rate the models were trained at (`sample_rate`).
    sampleRate: modelRate(44_100),
    inference: PINNED,
  },
  stems: [
    { key: 'vocals', label: 'Vocals' },
    { key: 'accompaniment', label: 'Accompaniment' },
  ],
};

/**
 * The four-stem model: version 1.0.1 of the pack `spleeter-4-stems`, named
 * likewise by the listing of every file of its definition.
 */
export const SPLEETER_4_STEMS_MODEL: SpleeterModel = {
  definition: {
    identity: {
      pack: 'spleeter-4-stems',
      version: '1.0.1',
      modelHash: 'ef22eebf76a5895bc86a458c1a6994122476abf4a2e3a9652959be6a8164df94',
      runtimeHash: PINNED_RUNTIME_SHA256,
    },
    files: [
      {
        path: SPLEETER_GRAPH,
        sha256: '0a67e86b287b682fd71f8f1f2cceaa09d099ed1276c826e53c9c3183f54f0b68',
      },
    ],
    // The only rate the models were trained at (`sample_rate`).
    sampleRate: modelRate(44_100),
    inference: PINNED,
  },
  stems: [
    { key: 'vocals', label: 'Vocals' },
    { key: 'drums', label: 'Drums' },
    { key: 'bass', label: 'Bass' },
    { key: 'other', label: 'Other' },
  ],
};

/** The analysis: a 4 096-sample frame every 1 024 samples (`frame_length`, `frame_step`). */
export const FRAME = 4_096;
export const HOP = 1_024;
export const BINS = FRAME / 2 + 1;

/**
 * The bins the graph hears and estimates (`F`), 0 to 11 kHz; every bin above
 * is given a mask of zero, Spleeter's `mask_extension` of `zeros`.
 */
export const MODEL_BINS = 1_024;

/** The frames of one segment the graph hears at once (`T`), about 11.9 seconds. */
export const SEGMENT_FRAMES = 512;

/** The channels the graph hears: it was trained on stereo alone (`n_channels`). */
export const MODEL_CHANNELS = 2;

/** The floor of the ratio masks' sum, Spleeter's `EPSILON`. */
export const MASK_EPSILON = 1e-10;

/**
 * The scale of the inverse transform, Spleeter's `WINDOW_COMPENSATION_FACTOR`:
 * the periodic Hann windows of analysis and synthesis, a quarter frame apart,
 * multiply and overlap to 3/2.
 */
export const SYNTHESIS_SCALE = 2 / 3;
