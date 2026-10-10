/**
 * Planar 32-bit float frames written interleaved, little-endian, in channel
 * order: the data of a 32-bit float WAV file, which a recording's chunks and a
 * decoded rendition both hold (ADR-0071, ADR-0090).
 */

/** The bytes one sample takes: a 32-bit float. */
export const FLOAT_SAMPLE_BYTES = 4;

/**
 * Writes `frames` frames of `channels` from frame `from` into `view` at byte
 * `offset`, interleaved, and answers the offset after them. A channel shorter
 * than the frames asked gives silence past its end.
 */
export function interleaveFloats(
  channels: readonly Float32Array[],
  from: number,
  frames: number,
  view: DataView,
  offset: number,
): number {
  let at = offset;
  for (let frame = from; frame < from + frames; frame += 1) {
    for (const channel of channels) {
      view.setFloat32(at, channel[frame] ?? 0, true);
      at += FLOAT_SAMPLE_BYTES;
    }
  }
  return at;
}
