/**
 * The fingerprint a golden test holds audio to.
 *
 * FNV-1a, 64 bits, over each sample's bits in little-endian order, as the
 * crates' own tests compute it, so a hash printed by `cargo test` and one
 * printed here can be compared by eye (ADR-0032).
 */

/** FNV-1a-64 over the little-endian bits of every sample of `samples`, in order. */
export function fingerprint(samples: Float32Array): bigint {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}
