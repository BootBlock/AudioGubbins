/**
 * Kaldi's log mel filter bank, as MossFormer2 SE 48K's decode takes it,
 * ported from torchaudio's `torchaudio.compliance.kaldi.fbank` (torchaudio,
 * BSD 2-Clause licence, by the PyTorch team and its contributors), which
 * reproduces Kaldi's `compute-fbank-feats` (Kaldi, Apache License 2.0, by
 * Johns Hopkins University and its contributors), with the options
 * ClearerVoice-Studio's `compute_fbank` gives it at commit 6b3774dc: a frame
 * of 1 920 samples every 384, 60 mel bands, the Hamming window, and the
 * defaults for the rest.
 *
 * Each frame lies wholly within the signal (`snip_edges`), so a signal of
 * `L` samples has `1 + ⌊(L − 1 920) / 384⌋` frames. A frame has its mean
 * taken off, is pre-emphasised by 0.97 (its first sample by itself), is
 * windowed and padded with zeros to 2 048 samples, the power of two above,
 * and its power spectrum is summed through 60 triangular filters spaced
 * evenly on the mel scale `1127·ln(1 + f/700)` from 20 Hz to the Nyquist
 * frequency, the Nyquist bin in none; each band's energy, floored at the
 * single-precision epsilon, is given as its natural logarithm.
 *
 * ClearerVoice-Studio asks for a dither of 1: Gaussian noise of a standard
 * deviation of one 16-bit step added to every sample first, drawn afresh on
 * every run. A render is the same bits every time it is made, so this port
 * adds none. At about 90 dB under full scale, the dither decides the
 * features of near silence alone.
 *
 * torchaudio computes in single precision; this port computes in doubles,
 * with the canonical FFT and logarithm, so it is the same bits on every
 * machine.
 */

import { ln, type CanonicalDsp, type CanonicalFft } from '@audiogubbins/audio-engine';

import { HAMMING_WINDOW } from './hamming.js';
import { FRAME, HOP, MEL_BANDS } from './mossformer2-model.js';

/** The frame padded with zeros to the power of two at or above it (`round_to_power_of_two`). */
const PADDED = 2_048;

/** The bins the filters cover: every bin of the padded frame's spectrum but the Nyquist bin. */
const FILTERED_BINS = PADDED / 2;

/** The coefficient of the pre-emphasis, `x[n] − 0.97·x[n − 1]`. */
const PRE_EMPHASIS = 0.97;

/** The lowest frequency the filters reach (`low_freq`); the highest is the Nyquist frequency. */
const LOWEST_FREQUENCY = 20;

/** The model's rate, which places the bins and the filters. */
const RATE = 48_000;

/** The floor under a band's energy before its logarithm: `FLT_EPSILON`, 2⁻²³. */
const ENERGY_FLOOR = 2 ** -23;

/** `f` on Kaldi's mel scale. */
function mel(frequency: number): number {
  return 1127 * ln(1 + frequency / 700);
}

/** One triangular filter: its weights over the bins from `first`. */
interface MelFilter {
  readonly first: number;
  readonly weights: Float64Array;
}

/**
 * The filters, as `get_mel_banks` makes them with no warping: band `m`
 * rises from the mel `low + m·δ` to `low + (m + 1)·δ` and falls to
 * `low + (m + 2)·δ`, `δ` being the mel range over 61, each bin weighted by
 * where its frequency's mel lies on that triangle. Only the bins a filter
 * weights are kept.
 */
function melFilters(): readonly MelFilter[] {
  const low = mel(LOWEST_FREQUENCY);
  const step = (mel(RATE / 2) - low) / (MEL_BANDS + 1);
  const binMel = Float64Array.from({ length: FILTERED_BINS }, (_, bin) =>
    mel((bin * RATE) / PADDED),
  );
  return Array.from({ length: MEL_BANDS }, (_, band) => {
    const left = low + band * step;
    const centre = low + (band + 1) * step;
    const right = low + (band + 2) * step;
    const weights: number[] = [];
    let first = -1;
    for (let bin = 0; bin < FILTERED_BINS; bin += 1) {
      const at = binMel[bin] ?? 0;
      const weight = Math.max(
        0,
        Math.min((at - left) / (centre - left), (right - at) / (right - centre)),
      );
      if (weight === 0 && first < 0) continue;
      if (weight === 0) break;
      if (first < 0) first = bin;
      weights.push(weight);
    }
    return { first, weights: Float64Array.from(weights) };
  });
}

/** The filters, the same for every frame of every pass. */
const MEL_FILTERS: readonly MelFilter[] = melFilters();

/** Takes the filter bank of signals on the canonical FFT, its arrays reused frame to frame. */
export class KaldiFbank {
  readonly #fft: CanonicalFft;
  readonly #frame = new Float64Array(PADDED);
  readonly #real = new Float64Array(PADDED / 2 + 1);
  readonly #imaginary = new Float64Array(PADDED / 2 + 1);

  /** A filter bank on `dsp`'s FFT; throws where the FFT cannot be made. */
  constructor(dsp: CanonicalDsp) {
    const fft = dsp.createFft(PADDED);
    // The size is a constant here and a power of two, which the FFT takes,
    // so a refusal is a fault in the DSP.
    if (!fft.ok) throw new Error(`No FFT of ${String(PADDED)} samples could be made.`);
    this.#fft = fft.value;
  }

  /**
   * Writes the log energies of the {@link MEL_BANDS} bands of each of the
   * first `frames` frames of `signal` to `into`, frame after frame.
   */
  logEnergies(signal: Float64Array, frames: number, into: Float64Array): void {
    for (let frame = 0; frame < frames; frame += 1) {
      this.#analyse(signal, frame * HOP);
      for (let band = 0; band < MEL_BANDS; band += 1) {
        const filter = MEL_FILTERS[band];
        if (filter === undefined) continue;
        const { first, weights } = filter;
        let energy = 0;
        for (let index = 0; index < weights.length; index += 1) {
          const real = this.#real[first + index] ?? 0;
          const imaginary = this.#imaginary[first + index] ?? 0;
          energy += (real * real + imaginary * imaginary) * (weights[index] ?? 0);
        }
        into[frame * MEL_BANDS + band] = ln(Math.max(energy, ENERGY_FLOOR));
      }
    }
  }

  release(): void {
    this.#fft.release();
  }

  /** Leaves the spectrum of the frame of `signal` from `start` in the real and imaginary parts. */
  #analyse(signal: Float64Array, start: number): void {
    const frame = this.#frame;
    let sum = 0;
    for (let n = 0; n < FRAME; n += 1) sum += signal[start + n] ?? 0;
    const mean = sum / FRAME;
    for (let n = 0; n < FRAME; n += 1) {
      const sample = (signal[start + n] ?? 0) - mean;
      const before = n === 0 ? sample : (signal[start + n - 1] ?? 0) - mean;
      frame[n] = (sample - PRE_EMPHASIS * before) * (HAMMING_WINDOW[n] ?? 0);
    }
    frame.fill(0, FRAME);
    this.#fft.forwardReal(frame, this.#real, this.#imaginary);
  }
}
