/**
 * The fingerprint a golden test holds audio to.
 *
 * FNV-1a, 64 bits, over each sample's bits in little-endian order, as the
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
