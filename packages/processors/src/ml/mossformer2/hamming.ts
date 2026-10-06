/**
 * The window MossFormer2's features and its masked spectrum are both taken
 * with: the symmetric Hamming window of a frame,
 * `0.54 − 0.46·cos(2πn/(N − 1))`, which is
 * `torch.hamming_window(N, periodic=False)`, as ClearerVoice-Studio's `stft`
 * and `istft` ask for it, and Kaldi's `hamming` window, as torchaudio's
 * `kaldi.fbank` makes it. The cosine is the canonical one, of a number of
 * turns, so the window is the same bits on every machine.
 */

import { cosineOfTurns } from '@audiogubbins/audio-engine';

import { FRAME } from './mossformer2-model.js';

function hammingWindow(): Float64Array {
  const window = new Float64Array(FRAME);
  for (let n = 0; n < FRAME; n += 1) {
    window[n] = 0.54 - 0.46 * cosineOfTurns(n / (FRAME - 1));
  }
  return window;
}

/** The window of {@link FRAME} samples. */
export const HAMMING_WINDOW: Float64Array = hammingWindow();
