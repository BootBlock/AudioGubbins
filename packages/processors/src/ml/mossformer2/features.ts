/**
 * MossFormer2 SE 48K's input features, as ClearerVoice-Studio's decode makes
 * them (`decode_one_audio_mossformer2_se_48k` of `clearvoice/utils/decode.py`
 * at commit 6b3774dc, Apache License 2.0, by Shengkui Zhao, Zexu Pan and
 * ClearerVoice-Studio's contributors): the Kaldi filter bank of a segment
 * scaled to the 16-bit range (`kaldi-fbank.ts`), its first deltas, and the
 * deltas of those, each 60 values a frame, joined into the 180 the graph takes
 * for each frame.
 *
 * The deltas are torchaudio's `compute_deltas` with its window of five
 * (torchaudio, BSD 2-Clause licence, by the PyTorch team and its contributors):
 * `d[t] = Σₖ k·(c[t + k] − c[t − k]) / 10` over `k` of 1 and 2, along each
 * band, the segment's first and last frames repeated past its edges. The second
 * deltas are taken over the first, edges repeated again, as the decode takes
 * them.
 */

import type { CanonicalDsp } from '@audiogubbins/audio-engine';

import { KaldiFbank } from './kaldi-fbank.js';
import { FEATURES, MEL_BANDS, SAMPLE_SCALE, framesOf } from './mossformer2-model.js';

/** The sum of `k²` over the window, by which the deltas are divided: `2·(1² + 2²)`. */
const DELTA_DIVISOR = 10;

/**
 * Writes the deltas of `frames` frames of {@link MEL_BANDS} values, read from
 * each frame's {@link FEATURES} in `values` from `from`, to each frame's in
 * `into` from `to`.
 */
function deltas(
  values: Float32Array,
  from: number,
  into: Float32Array,
  to: number,
  frames: number,
): void {
  const at = (frame: number, band: number): number => {
    const held = Math.min(frames - 1, Math.max(0, frame));
    return values[held * FEATURES + from + band] ?? 0;
  };
  for (let frame = 0; frame < frames; frame += 1) {
    for (let band = 0; band < MEL_BANDS; band += 1) {
      const near = at(frame + 1, band) - at(frame - 1, band);
      const far = at(frame + 2, band) - at(frame - 2, band);
      into[frame * FEATURES + to + band] = (near + 2 * far) / DELTA_DIVISOR;
    }
  }
}

/** Makes the graph's features of segments, its arrays reused segment to segment. */
export class FeatureMaker {
  readonly #fbank: KaldiFbank;
  readonly #scaled: Float64Array;
  readonly #energies: Float64Array;

  /** A maker for segments of `samples` samples, on `dsp`'s FFT. */
  constructor(dsp: CanonicalDsp, samples: number) {
    this.#fbank = new KaldiFbank(dsp);
    this.#scaled = new Float64Array(samples);
    this.#energies = new Float64Array(framesOf(samples) * MEL_BANDS);
  }

  /**
   * The features of `segment`, samples of the stream at full scale 1, as
   * `fbanks` takes them: [frames, 180], each frame's 60 log energies, then
   * their deltas, then their second deltas.
   */
  features(segment: Float32Array): Float32Array<ArrayBuffer> {
    const frames = framesOf(segment.length);
    for (let index = 0; index < segment.length; index += 1) {
      this.#scaled[index] = (segment[index] ?? 0) * SAMPLE_SCALE;
    }
    this.#fbank.logEnergies(this.#scaled, frames, this.#energies);
    const features = new Float32Array(frames * FEATURES);
    for (let frame = 0; frame < frames; frame += 1) {
      for (let band = 0; band < MEL_BANDS; band += 1) {
        features[frame * FEATURES + band] = this.#energies[frame * MEL_BANDS + band] ?? 0;
      }
    }
    deltas(features, 0, features, MEL_BANDS, frames);
    deltas(features, MEL_BANDS, features, 2 * MEL_BANDS, frames);
    return features;
  }

  release(): void {
    this.#fbank.release();
  }
}
