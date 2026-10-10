/**
 * Decoders of G.711 and ADPCM written from the standards' own descriptions,
 * apart from the package's: ITU-T G.711's segment and step formulas, the IMA's
 * recommended practice, and Microsoft's ADPCM specification, each reading its
 * block layout itself. A test checks the package's readers, and its writers'
 * output, against these, so the two are never checked against themselves.
 */

/** G.711 A-law by ITU-T G.711: even bits inverted, sign set for positive, 13-bit magnitude. */
export function referenceAlaw(byte: number): number {
  const code = byte ^ 0x55;
  const segment = (code >> 4) & 7;
  const step = code & 15;
  const magnitude = segment === 0 ? 2 * step + 1 : (2 * step + 33) * 2 ** (segment - 1);
  return ((code & 0x80) === 0 ? -1 : 1) * magnitude * 8;
}

/** G.711 µ-law by ITU-T G.711: all bits inverted, sign set for negative, 14-bit magnitude. */
export function referenceUlaw(byte: number): number {
  const code = ~byte & 0xff;
  const segment = (code >> 4) & 7;
  const step = code & 15;
  const magnitude = (2 * step + 33) * 2 ** segment - 33;
  return ((code & 0x80) === 0 ? 1 : -1) * magnitude * 4;
}

/** The IMA step table of the recommended practice. */
const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX_STEPS = [-1, -1, -1, -1, 2, 4, 6, 8];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The IMA decoder of the recommended practice, over a channel's nibbles from a starting state. */
function referenceIma(predictor: number, index: number, nibbles: readonly number[]): number[] {
  const out: number[] = [];
  let sample = predictor;
  let at = index;
  for (const nibble of nibbles) {
    const step = STEPS[at] ?? Number.NaN;
    let difference = step >> 3;
    if (nibble & 4) difference += step;
    if (nibble & 2) difference += step >> 1;
    if (nibble & 1) difference += step >> 2;
    sample = clamp(nibble & 8 ? sample - difference : sample + difference, -32768, 32767);
    at = clamp(at + (INDEX_STEPS[nibble & 7] ?? Number.NaN), 0, 88);
    out.push(sample);
  }
  return out;
}

/** A WAV IMA file's samples, block by block, channel by channel, read from its layout. */
export function referenceImaWav(
  data: Uint8Array,
  channels: number,
  blockAlign: number,
  framesPerBlock: number,
  frames: number,
): number[][] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: number[][] = Array.from({ length: channels }, () => []);
  for (let block = 0; block * framesPerBlock < frames; block += 1) {
    const base = block * blockAlign;
    for (let channel = 0; channel < channels; channel += 1) {
      const predictor = view.getInt16(base + 4 * channel, true);
      const index = view.getUint8(base + 4 * channel + 2);
      const nibbles: number[] = [];
      for (let sample = 0; sample < framesPerBlock - 1; sample += 1) {
        const word = Math.floor(sample / 8);
        const byte =
          data[
            base + 4 * channels + word * 4 * channels + 4 * channel + Math.floor((sample % 8) / 2)
          ] ?? 0;
        nibbles.push(sample % 2 === 0 ? byte & 15 : byte >> 4);
      }
      out[channel]?.push(predictor, ...referenceIma(predictor, index, nibbles));
    }
  }
  return out.map((channel) => channel.slice(0, frames));
}

/** An AIFF-C `ima4` file's samples, packet by packet, from Apple's packet layout. */
export function referenceIma4(data: Uint8Array, channels: number, packets: number): number[][] {
  const out: number[][] = Array.from({ length: channels }, () => []);
  for (let packet = 0; packet < packets; packet += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const base = (packet * channels + channel) * 34;
      const header = ((data[base] ?? 0) << 8) | (data[base + 1] ?? 0);
      const predictor = header & 0x8000 ? (header & 0xff80) - 0x10000 : header & 0xff80;
      const nibbles = Array.from({ length: 64 }, (_, sample) => {
        const byte = data[base + 2 + Math.floor(sample / 2)] ?? 0;
        return sample % 2 === 0 ? byte & 15 : byte >> 4;
      });
      out[channel]?.push(...referenceIma(predictor, header & 0x7f, nibbles));
    }
  }
  return out;
}

const MS_ADAPTATION = [
  230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230,
];
export const MS_STANDARD: readonly (readonly [number, number])[] = [
  [256, 0],
  [512, -256],
  [0, 0],
  [192, 64],
  [240, 0],
  [460, -208],
  [392, -232],
];

/** A Microsoft ADPCM file's samples, by the specification's decoder and block layout. */
export function referenceMs(
  data: Uint8Array,
  channels: number,
  blockAlign: number,
  framesPerBlock: number,
  frames: number,
  coefficients: readonly (readonly [number, number])[],
): number[][] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: number[][] = Array.from({ length: channels }, () => []);
  for (let block = 0; block * framesPerBlock < frames; block += 1) {
    const base = block * blockAlign;
    const state = Array.from({ length: channels }, (_, channel) => {
      const [first, second] = coefficients[view.getUint8(base + channel)] ?? [
        Number.NaN,
        Number.NaN,
      ];
      return {
        first,
        second,
        delta: view.getInt16(base + channels + 2 * channel, true),
        sample1: view.getInt16(base + 3 * channels + 2 * channel, true),
        sample2: view.getInt16(base + 5 * channels + 2 * channel, true),
      };
    });
    state.forEach((channel, index) => out[index]?.push(channel.sample2, channel.sample1));
    for (let nibbleIndex = 0; nibbleIndex < (framesPerBlock - 2) * channels; nibbleIndex += 1) {
      const byte = data[base + 7 * channels + Math.floor(nibbleIndex / 2)] ?? 0;
      const nibble = nibbleIndex % 2 === 0 ? byte >> 4 : byte & 15;
      const channel = state[nibbleIndex % channels];
      if (channel === undefined)
        throw new RangeError('A nibble belongs to a channel of the block.');
      const predicted = Math.trunc(
        (channel.sample1 * channel.first + channel.sample2 * channel.second) / 256,
      );
      const sample = clamp(
        predicted + (nibble >= 8 ? nibble - 16 : nibble) * channel.delta,
        -32768,
        32767,
      );
      channel.sample2 = channel.sample1;
      channel.sample1 = sample;
      channel.delta = Math.max(
        16,
        Math.floor(((MS_ADAPTATION[nibble] ?? Number.NaN) * channel.delta) / 256),
      );
      out[nibbleIndex % channels]?.push(sample);
    }
  }
  return out.map((channel) => channel.slice(0, frames));
}
