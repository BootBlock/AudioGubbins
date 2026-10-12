/**
 * The fingerprint a golden test holds audio, and the doubles a measuring or
 * transforming object writes, to.
 *
 * FNV-1a, 64 bits, over each value's bits in little-endian order, as the
 * crates' own tests compute it, so a hash printed by `cargo test` and one
 * printed here can be compared by eye (ADR-0032). The bytes are read through a
 * `DataView` rather than a byte view of the samples' buffer, which would give
 * them in the host's order and a different hash on a big-endian machine.
 */

/** FNV-1a-64 over the little-endian bits of every sample of `samples`, in order. */
export function fingerprint(samples: Float32Array): bigint {
  const bits = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);
  let hash = 0xcbf29ce484222325n;
  for (let sample = 0; sample < samples.length; sample += 1) {
    const word = bits.getUint32(sample * 4, true);
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= BigInt((word >>> shift) & 0xff);
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
  }
  return hash;
}

/** FNV-1a-64 over the little-endian bits of every double of `values`, in order. */
export function doublesFingerprint(values: Float64Array | readonly number[]): bigint {
  const doubles = values instanceof Float64Array ? values : Float64Array.from(values);
  const bits = new DataView(doubles.buffer, doubles.byteOffset, doubles.byteLength);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < doubles.length; index += 1) {
    const word = bits.getBigUint64(index * 8, true);
    for (let shift = 0n; shift < 64n; shift += 8n) {
      hash ^= (word >> shift) & 0xffn;
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
  }
  return hash;
}
