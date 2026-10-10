/**
 * G.711's encoders as the ITU's own software gives them (G.191's
 * `alaw_compress` and `ulaw_compress`), and IMA ADPCM encoders written from the
 * IMA's recommended practice of 1992, in
 * WAV's block layout and AIFF-C `ima4`'s packets, apart from the package's own,
 * so a test holds the writer's bytes to the standard's encoder rather than to
 * itself. Microsoft ADPCM has no reference encoder: its specification leaves
 * the choice of each block's coefficients to the encoder.
 */

const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_STEPS = [-1, -1, -1, -1, 2, 4, 6, 8];

interface Coder {
  predictor: number;
  index: number;
}

/** The recommended practice's encoder of one sample: the nibble, and the decoder's step after it. */
function encodeSample(coder: Coder, sample: number): number {
  const step = STEPS[coder.index] ?? Number.NaN;
  let difference = sample - coder.predictor;
  const sign = difference < 0 ? 8 : 0;
  if (sign !== 0) difference = -difference;
  let nibble = 0;
  let quantised = step >> 3;
  if (difference >= step) {
    nibble |= 4;
    difference -= step;
    quantised += step;
  }
  if (difference >= step >> 1) {
    nibble |= 2;
    difference -= step >> 1;
    quantised += step >> 1;
  }
  if (difference >= step >> 2) {
    nibble |= 1;
    quantised += step >> 2;
  }
  const next = sign !== 0 ? coder.predictor - quantised : coder.predictor + quantised;
  coder.predictor = Math.min(32_767, Math.max(-32_768, next));
  coder.index = Math.min(88, Math.max(0, coder.index + (INDEX_STEPS[nibble & 7] ?? Number.NaN)));
  return nibble | sign;
}

/** The bytes of WAV IMA blocks of `framesPerBlock` frames coding 16-bit `channels`, padded with silence. */
export function referenceImaWavEncode(
  channels: readonly (readonly number[])[],
  framesPerBlock: number,
): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const blocks = Math.ceil(frames / framesPerBlock);
  const blockAlign = (4 + ((framesPerBlock - 1) / 8) * 4) * count;
  const out = new Uint8Array(blocks * blockAlign);
  const coders = channels.map((): Coder => ({ predictor: 0, index: 0 }));
  for (let block = 0; block < blocks; block += 1) {
    const base = block * blockAlign;
    channels.forEach((channel, index) => {
      const coder = coders[index] ?? { predictor: 0, index: 0 };
      const first = channel[block * framesPerBlock] ?? 0;
      coder.predictor = first;
      out[base + 4 * index] = first & 0xff;
      out[base + 4 * index + 1] = (first >> 8) & 0xff;
      out[base + 4 * index + 2] = coder.index;
      for (let sample = 1; sample < framesPerBlock; sample += 1) {
        const nibble = encodeSample(coder, channel[block * framesPerBlock + sample] ?? 0);
        const at =
          base +
          4 * count +
          Math.floor((sample - 1) / 8) * 4 * count +
          4 * index +
          Math.floor(((sample - 1) % 8) / 2);
        out[at] = (out[at] ?? 0) | ((sample - 1) % 2 === 0 ? nibble : nibble << 4);
      }
    });
  }
  return out;
}

/** The bytes of AIFF-C `ima4` packets coding 16-bit `channels`, padded with silence. */
export function referenceIma4Encode(channels: readonly (readonly number[])[]): Uint8Array {
  const count = channels.length;
  const packets = Math.ceil((channels[0]?.length ?? 0) / 64);
  const out = new Uint8Array(packets * count * 34);
  const coders = channels.map((): Coder => ({ predictor: 0, index: 0 }));
  for (let packet = 0; packet < packets; packet += 1) {
    channels.forEach((channel, index) => {
      const coder = coders[index] ?? { predictor: 0, index: 0 };
      const base = (packet * count + index) * 34;
      // Apple's header keeps the predictor's top nine bits, and its decoder resumes from them.
      const top = coder.predictor & 0xff80;
      out[base] = (top >> 8) & 0xff;
      out[base + 1] = (top & 0x80) | coder.index;
      coder.predictor = top >= 0x8000 ? top - 0x10000 : top;
      for (let sample = 0; sample < 64; sample += 1) {
        const nibble = encodeSample(coder, channel[packet * 64 + sample] ?? 0);
        const at = base + 2 + Math.floor(sample / 2);
        out[at] = (out[at] ?? 0) | (sample % 2 === 0 ? nibble : nibble << 4);
      }
    });
  }
  return out;
}

/** G.191's `alaw_compress` of one 16-bit sample. */
export function referenceAlawCompress(linear: number): number {
  let ix = (linear < 0 ? ~linear : linear) >> 4;
  if (ix > 15) {
    let exponent = 1;
    while (ix > 16 + 15) {
      ix >>= 1;
      exponent += 1;
    }
    ix -= 16;
    ix += exponent << 4;
  }
  if (linear >= 0) ix |= 0x80;
  return ix ^ 0x55;
}

/** G.191's `ulaw_compress` of one 16-bit sample. */
export function referenceUlawCompress(linear: number): number {
  const absolute = Math.min(((linear < 0 ? ~linear : linear) >> 2) + 33, 0x1fff);
  let segment = 1;
  for (let rest = absolute >> 6; rest !== 0; rest >>= 1) segment += 1;
  const code = ((8 - segment) << 4) | (15 - ((absolute >> segment) & 15));
  return linear >= 0 ? code | 0x80 : code;
}
