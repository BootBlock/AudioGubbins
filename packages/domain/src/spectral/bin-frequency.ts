/**
 * Where the bins of a real transform lie in frequency (ADR-0081): bin `k` of
 * a transform of `N` samples at `rate` is centred at `k · rate / N`. The edit
 * weighs its frames at these frequencies and the spectrogram draws its rows
 * from them, so both take them from here, the product taken before the
 * quotient, and a bin drawn under a mask is the bin the edit weighs there.
 */

/** The centre frequency of `bin` of a transform of `size` samples at `sampleRate`. */
export function binFrequency(bin: number, sampleRate: number, size: number): number {
  return (bin * sampleRate) / size;
}

/** The bin of a transform of `size` samples at `sampleRate` whose centre lies nearest `frequency`. */
export function nearestBin(frequency: number, sampleRate: number, size: number): number {
  return Math.round((frequency * size) / sampleRate);
}
