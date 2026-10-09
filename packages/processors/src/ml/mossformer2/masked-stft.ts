/**
 * MossFormer2 SE 48K's mask applied to a segment's spectrum and the segment
 * made again from it, as ClearerVoice-Studio's decode does (`stft` and
 * `istft` of `clearvoice/utils/misc.py` and their use in
 * `decode_one_audio_mossformer2_se_48k`, at commit 6b3774dc, Apache License
 * 2.0, by Shengkui Zhao, Zexu Pan and ClearerVoice-Studio's contributors),
 * ported from the `torch.stft` and `torch.istft` they call (PyTorch, BSD
 * 3-Clause licence, by the PyTorch team and its contributors) with their
 * arguments: no centring, no normalisation, one-sided.
 *
 * Frame `t` is the segment's 1 920 samples from `384·t`, windowed by the
 * symmetric Hamming window and transformed, 961 bins; its real and imaginary
 * parts are each scaled by the graph's mask of that frame and bin. Each
 * masked spectrum is transformed back, scaled by `1/N`, windowed again and
 * overlapped and added at its place, and each sample is divided by the sum
 * of the squared windows of the frames that cover it, which is how
 * `torch.istft` undoes the windows: a mask of one everywhere gives the
 * segment back, its edges too. A segment is a whole number of hops past one
 * frame, so every sample is covered.
 *
 * The transform of 1 920 samples, no power of two, is `../real-dft.ts`'s on the
 * canonical FFT. The decode scales the segment by 2¹⁵ before its transform and
 * the output back after; that is a power of two, which changes no bit of a
 * linear transform's answer, so the segment is transformed as it is.
 */

import type { CanonicalDsp } from '@audiogubbins/audio-engine';

import { RealDft } from '../real-dft.js';
import { emptySpectrum, type Spectrum } from '../spectrum.js';
import { HAMMING_WINDOW } from './hamming.js';
import { BINS, FRAME, HOP, framesOf } from './mossformer2-model.js';

/**
 * The sum of the squared windows over every frame of a segment of `samples`
 * samples, at each of its samples.
 */
function windowEnvelope(samples: number): Float64Array {
  const envelope = new Float64Array(samples);
  for (let frame = 0; frame < framesOf(samples); frame += 1) {
    for (let n = 0; n < FRAME; n += 1) {
      const weight = HAMMING_WINDOW[n] ?? 0;
      envelope[frame * HOP + n] = (envelope[frame * HOP + n] ?? 0) + weight * weight;
    }
  }
  return envelope;
}

/** Masks the spectra of segments of one length and makes them again, its arrays reused. */
export class MaskedStft {
  readonly #dft: RealDft;
  readonly #envelope: Float64Array;
  readonly #frame = new Float64Array(FRAME);
  readonly #spectrum = emptySpectrum(BINS);

  /** For segments of `samples` samples, a whole number of hops past a frame, on `dsp`'s FFT. */
  constructor(dsp: CanonicalDsp, samples: number) {
    this.#dft = RealDft.of(dsp, FRAME);
    this.#envelope = windowEnvelope(samples);
  }

  /** Writes the spectrum of frame `frame` of `segment`, windowed, to `into`. */
  spectrum(segment: Float32Array, frame: number, into: Spectrum): void {
    const start = frame * HOP;
    for (let n = 0; n < FRAME; n += 1) {
      this.#frame[n] = (segment[start + n] ?? 0) * (HAMMING_WINDOW[n] ?? 0);
    }
    this.#dft.forward(this.#frame, into.real, into.imaginary);
  }

  /**
   * Writes to `into` the segment `segment` made again with each frame's
   * spectrum scaled by `mask`, [frames, 961], row by row.
   */
  masked(segment: Float32Array, mask: Float32Array, into: Float64Array): void {
    into.fill(0);
    const frames = framesOf(segment.length);
    for (let frame = 0; frame < frames; frame += 1) {
      const { real, imaginary } = this.#spectrum;
      this.spectrum(segment, frame, this.#spectrum);
      const row = frame * BINS;
      for (let bin = 0; bin < BINS; bin += 1) {
        const gain = mask[row + bin] ?? 0;
        real[bin] = (real[bin] ?? 0) * gain;
        imaginary[bin] = (imaginary[bin] ?? 0) * gain;
      }
      this.#dft.inverse(real, imaginary, this.#frame);
      const start = frame * HOP;
      for (let n = 0; n < FRAME; n += 1) {
        const sample = ((this.#frame[n] ?? 0) / FRAME) * (HAMMING_WINDOW[n] ?? 0);
        into[start + n] = (into[start + n] ?? 0) + sample;
      }
    }
    for (let n = 0; n < segment.length; n += 1) {
      into[n] = (into[n] ?? 0) / (this.#envelope[n] ?? 1);
    }
  }

  release(): void {
    this.#dft.release();
  }
}
