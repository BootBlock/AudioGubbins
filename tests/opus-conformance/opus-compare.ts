/**
 * The Opus conformance comparison: `opus_compare`'s algorithm (the reference
 * implementation's `src/opus_compare.c`), which RFC 6716 and RFC 8251 name as
 * the test of a decoder's output against the reference decoder's.
 *
 * Both signals are cut into 480-sample windows every 120 samples, each window's
 * power taken in 240 bins and summed into 21 bands of the CELT layout. The
 * reference's band energies, spread across bands and frames as masking, set how
 * much difference each bin may hide; the weighted error is folded into a
 * quality figure, and a decoder conforms where it is at least 0. Written again
 * here from the algorithm, at 48 kHz, the rate every vector is decoded at; sums
 * are kept in single precision where the reference keeps them so, by
 * `Math.fround`.
 */

/** Bands, and the bins they end at. */
const BANDS = [
  0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 68, 80, 96, 120, 156, 200,
];
const BAND_COUNT = BANDS.length - 1;
const BINS = 240;
const WINDOW = 480;
const STEP = 120;

/** The Hann window and the DFT's cosines and sines, at single precision. */
const PI = Math.fround(3.14159265);
const HANN = Float32Array.from({ length: WINDOW }, (_, index) =>
  Math.fround(0.5 - 0.5 * Math.cos(((2 * PI) / (WINDOW - 1)) * index)),
);
const COSINES = Float32Array.from({ length: WINDOW }, (_, index) =>
  Math.cos(((2 * PI) / WINDOW) * index),
);
const SINES = Float32Array.from({ length: WINDOW }, (_, index) =>
  Math.sin(((2 * PI) / WINDOW) * index),
);

/**
 * The power of each bin of each frame, interleaved by channel, and where
 * `bands` is given, each band's mean power.
 */
function bandEnergy(
  signal: Float32Array,
  channels: number,
  frames: number,
  bands: Float32Array | undefined,
): Float32Array {
  const power = new Float32Array(frames * BINS * channels);
  const windowed = new Float32Array(WINDOW * channels);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      for (let at = 0; at < WINDOW; at += 1) {
        windowed[channel * WINDOW + at] = Math.fround(
          (HANN[at] ?? 0) * (signal[(frame * STEP + at) * channels + channel] ?? 0),
        );
      }
    }
    for (let band = 0, bin = 0; band < BAND_COUNT; band += 1) {
      const sums = [0, 0];
      for (; bin < (BANDS[band + 1] ?? 0); bin += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          let re = 0;
          let im = 0;
          for (let at = 0, turn = 0; at < WINDOW; at += 1) {
            const sample = windowed[channel * WINDOW + at] ?? 0;
            re = Math.fround(re + Math.fround((COSINES[turn] ?? 0) * sample));
            im = Math.fround(im - Math.fround((SINES[turn] ?? 0) * sample));
            turn += bin;
            if (turn >= WINDOW) turn -= WINDOW;
          }
          const value = Math.fround(re * re + im * im + 100_000);
          power[(frame * BINS + bin) * channels + channel] = value;
          sums[channel] = Math.fround((sums[channel] ?? 0) + value);
        }
      }
      if (bands !== undefined) {
        const width = (BANDS[band + 1] ?? 0) - (BANDS[band] ?? 0);
        for (let channel = 0; channel < channels; channel += 1) {
          bands[(frame * BAND_COUNT + band) * channels + channel] = (sums[channel] ?? 0) / width;
        }
      }
    }
  }
  return power;
}

/**
 * The quality of `decoded` against `reference`, both interleaved 16-bit scaled
 * samples at 48 kHz: `reference` always stereo, as the vectors' outputs are,
 * and averaged to one channel where `channels` is 1, as `opus_compare` does. At
 * least 0 conforms; `undefined` where the lengths differ.
 */
export function opusQuality(
  reference: Float32Array,
  decoded: Float32Array,
  channels: 1 | 2,
): number | undefined {
  const length = reference.length / 2;
  if (decoded.length / channels !== length || length < WINDOW) return undefined;
  const source =
    channels === 2
      ? reference
      : Float32Array.from(
          { length },
          (_, index) => 0.5 * ((reference[2 * index] ?? 0) + (reference[2 * index + 1] ?? 0)),
        );
  const frames = Math.floor((length - WINDOW + STEP) / STEP);
  const bands = new Float32Array(frames * BAND_COUNT * channels);
  const x = bandEnergy(source, channels, frames, bands);
  const y = bandEnergy(decoded, channels, frames, undefined);
  const at = (frame: number, band: number, channel: number): number =>
    (frame * BAND_COUNT + band) * channels + channel;
  for (let frame = 0; frame < frames; frame += 1) {
    // Masking from low to high bands, 10 dB a Bark, and high to low, 15.
    for (let band = 1; band < BAND_COUNT; band += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        bands[at(frame, band, channel)] =
          (bands[at(frame, band, channel)] ?? 0) +
          Math.fround(0.1 * (bands[at(frame, band - 1, channel)] ?? 0));
      }
    }
    for (let band = BAND_COUNT - 2; band >= 0; band -= 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        bands[at(frame, band, channel)] =
          (bands[at(frame, band, channel)] ?? 0) +
          Math.fround(0.03 * (bands[at(frame, band + 1, channel)] ?? 0));
      }
    }
    // Temporal masking, -3 dB in 2.5 ms.
    if (frame > 0) {
      for (let band = 0; band < BAND_COUNT; band += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          bands[at(frame, band, channel)] =
            (bands[at(frame, band, channel)] ?? 0) +
            Math.fround(0.5 * (bands[at(frame - 1, band, channel)] ?? 0));
        }
      }
    }
    // Some cross-talk allowed between the channels.
    if (channels === 2) {
      for (let band = 0; band < BAND_COUNT; band += 1) {
        const left = bands[at(frame, band, 0)] ?? 0;
        const right = bands[at(frame, band, 1)] ?? 0;
        bands[at(frame, band, 0)] = left + Math.fround(0.01 * right);
        bands[at(frame, band, 1)] = right + Math.fround(0.01 * left);
      }
    }
    for (let band = 0; band < BAND_COUNT; band += 1) {
      for (let bin = BANDS[band] ?? 0; bin < (BANDS[band + 1] ?? 0); bin += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const mask = Math.fround(0.1 * (bands[at(frame, band, channel)] ?? 0));
          const index = (frame * BINS + bin) * channels + channel;
          x[index] = (x[index] ?? 0) + mask;
          y[index] = (y[index] ?? 0) + mask;
        }
      }
    }
  }
  // Each frame's bins summed with the frame before, so a single frame's
  // difference counts less.
  for (let bin = 0; bin < (BANDS[BAND_COUNT] ?? 0); bin += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      let previousX = x[bin * channels + channel] ?? 0;
      let previousY = y[bin * channels + channel] ?? 0;
      for (let frame = 1; frame < frames; frame += 1) {
        const index = (frame * BINS + bin) * channels + channel;
        const currentX = x[index] ?? 0;
        const currentY = y[index] ?? 0;
        x[index] = currentX + previousX;
        y[index] = currentY + previousY;
        previousX = currentX;
        previousY = currentY;
      }
    }
  }
  let error = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let frameError = 0;
    for (let band = 0; band < BAND_COUNT; band += 1) {
      let bandError = 0;
      for (let bin = BANDS[band] ?? 0; bin < (BANDS[band + 1] ?? 0); bin += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const index = (frame * BINS + bin) * channels + channel;
          const ratio = Math.fround((y[index] ?? 0) / (x[index] ?? 1));
          let difference = Math.fround(ratio - Math.log(ratio) - 1);
          // Less weight around the SILK and CELT cross-over, where either
          // mode's filters may be used.
          if (bin >= 79 && bin <= 81) difference = Math.fround(difference * 0.1);
          if (bin === 80) difference = Math.fround(difference * 0.1);
          bandError += difference;
        }
      }
      bandError /= ((BANDS[band + 1] ?? 0) - (BANDS[band] ?? 0)) * channels;
      frameError += bandError * bandError;
    }
    frameError /= BAND_COUNT;
    frameError *= frameError;
    error += frameError * frameError;
  }
  const weighted = (error / frames) ** (1 / 16);
  return 100 * (1 - (0.5 * Math.log(1 + weighted)) / Math.log(1.13));
}
