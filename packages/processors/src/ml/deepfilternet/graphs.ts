/**
 * One run of DeepFilterNet 3's three graphs over a run's features.
 *
 * The graphs, as their files declare them (opset 12; no recurrent state is
 * an input or an output, so each run starts its recurrent layers from zero):
 *
 * - `enc.onnx` takes `feat_erb` [1×1×S×32] and `feat_spec` [1×2×S×96] and gives
 *   `e0` [1×64×S×32], `e1` [1×64×S×16], `e2` and `e3` [1×64×S×8], `emb`
 *   [1×S×512], `c0` [1×64×S×96] and `lsnr` [1×S×1], the local SNR estimate,
 *   which only libDF's real-time driver reads, to skip frames.
 * - `erb_dec.onnx` takes `emb`, `e3`, `e2`, `e1` and `e0` and gives `m`
 *   [1×1×S×32], each ERB band's gain, from 0 to 1.
 * - `df_dec.onnx` takes `emb` and `c0` and gives `coefs` [1×S×96×10], the deep
 *   filter's five complex taps for each of the lowest 96 bins, real and
 *   imaginary parts interleaved by tap, and a second output, `235`, the
 *   training's filter weight, which inference does not use.
 *
 * Each frame's outputs depend on that frame's inputs and those before it
 * alone, which the chunk schedule's join relies on.
 */

import { succeed, type CancellationSignal, type DomainResult } from '@audiogubbins/domain';
import { tensor, type Tensor } from '@audiogubbins/ml-runtime';

import type { ModelSessions } from '../model-sessions.js';
import {
  DEEP_FILTER_BINS,
  DEEP_FILTER_ORDER,
  DeepFilterNetGraph,
  ERB_BANDS,
} from './deepfilternet-model.js';
import type { EncoderInputs } from './features.js';

/** What a run of the graphs gives: per frame, the band gains and the deep filter's taps. */
export interface GraphOutputs {
  /** [S, 32]. */
  readonly gains: Float32Array;
  /** [S, 96, 5, 2]: per frame and bin, each tap's real and imaginary parts. */
  readonly taps: Float32Array;
}

/**
 * The encoder's outputs the ERB decoder takes beside the embedding, by name,
 * with the values each holds per frame: [1, 64, ·, 8 to 32].
 */
const ERB_DECODER_INPUTS = [
  ['e3', 64 * 8],
  ['e2', 64 * 8],
  ['e1', 64 * 16],
  ['e0', 64 * 32],
] as const;

/** The encoder's outputs, checked, as the two decoders take them. */
interface DecoderInputs {
  /** The ERB decoder's inputs, by name. */
  readonly erbInputs: ReadonlyMap<string, Tensor>;
  /** The deep filter decoder's two inputs. */
  readonly embedding: Tensor;
  readonly pathway: Tensor;
}

/**
 * The decoders' inputs from the encoder's outputs, `encoded`, for a run of
 * `frames` frames, each held to the shape the encoder's file declares.
 */
function decoderInputs(
  sessions: ModelSessions,
  encoded: ReadonlyMap<string, Tensor>,
  frames: number,
): DomainResult<DecoderInputs> {
  const encoder = DeepFilterNetGraph.Encoder;
  const embedding = sessions.output(encoded, encoder, 'emb', frames * 512);
  if (!embedding.ok) return embedding;
  const pathway = sessions.output(encoded, encoder, 'c0', frames * 64 * 96);
  if (!pathway.ok) return pathway;
  // The port takes an input's buffer, and the embedding is the other
  // decoder's input too, so this decoder is given a copy of it.
  const { data, dims } = embedding.value;
  const erbInputs = new Map<string, Tensor>([['emb', { data: data.slice(), dims }]]);
  for (const [name, values] of ERB_DECODER_INPUTS) {
    const found = sessions.output(encoded, encoder, name, frames * values);
    if (!found.ok) return found;
    erbInputs.set(name, found.value);
  }
  return succeed({ erbInputs, embedding: embedding.value, pathway: pathway.value });
}

/** The graphs' gains and taps for a run of `frames` frames, or why the runtime gave none. */
export async function runGraphs(
  sessions: ModelSessions,
  features: EncoderInputs,
  frames: number,
  signal: CancellationSignal | undefined,
): Promise<DomainResult<GraphOutputs>> {
  const erb = tensor(features.erb, [1, 1, frames, ERB_BANDS]);
  if (!erb.ok) return erb;
  const spectrum = tensor(features.spectrum, [1, 2, frames, DEEP_FILTER_BINS]);
  if (!spectrum.ok) return spectrum;
  const encoded = await sessions.of(DeepFilterNetGraph.Encoder).run(
    new Map([
      ['feat_erb', erb.value],
      ['feat_spec', spectrum.value],
    ]),
    signal,
  );
  if (!encoded.ok) return encoded;
  const decoding = decoderInputs(sessions, encoded.value, frames);
  if (!decoding.ok) return decoding;
  const { erbInputs, embedding, pathway } = decoding.value;
  const masked = await sessions.of(DeepFilterNetGraph.ErbDecoder).run(erbInputs, signal);
  if (!masked.ok) return masked;
  const gains = sessions.output(
    masked.value,
    DeepFilterNetGraph.ErbDecoder,
    'm',
    frames * ERB_BANDS,
  );
  if (!gains.ok) return gains;
  const filtered = await sessions.of(DeepFilterNetGraph.DeepFilterDecoder).run(
    new Map([
      ['emb', embedding],
      ['c0', pathway],
    ]),
    signal,
  );
  if (!filtered.ok) return filtered;
  const taps = sessions.output(
    filtered.value,
    DeepFilterNetGraph.DeepFilterDecoder,
    'coefs',
    frames * DEEP_FILTER_BINS * DEEP_FILTER_ORDER * 2,
  );
  if (!taps.ok) return taps;
  return succeed({ gains: gains.value.data, taps: taps.value.data });
}
