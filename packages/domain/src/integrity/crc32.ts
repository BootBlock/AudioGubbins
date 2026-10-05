/**
 * CRC-32 as ZIP and zlib define it: the reflected polynomial 0xEDB88320,
 * initialised and finished by inversion (REQ-STOR-026).
 *
 * Every entry of a portable bundle carries one, computed while the entry is
 * written and checked while it is read, so a byte changed in transit is found
 * without holding an entry whole (REQ-EXEC-216), and a peak cache closes with
 * one, so a cache torn or changed on disk is refused. It lives in the domain,
 * which depends on nothing, because the project format and the waveform both
 * check bytes by it and neither may depend on the other. Bundles hold hours of
 * audio, so the CRC is taken eight bytes at a time (slicing-by-8), which runs
 * at more than twice the speed of a byte at a time.
 */

/** The reflected ZIP polynomial. */
const POLYNOMIAL = 0xedb88320;

/**
 * Eight tables of 256 remainders, computed once for the module (G5). Table `k`
 * holds the remainder of a byte followed by `k` zero bytes, so eight bytes are
 * folded in with eight lookups and no shifting between them.
 */
const TABLES: Uint32Array = (() => {
  const tables = new Uint32Array(8 * 256);
  for (let value = 0; value < 256; value += 1) {
    let remainder = value;
    for (let bit = 0; bit < 8; bit += 1) {
      remainder = remainder & 1 ? (remainder >>> 1) ^ POLYNOMIAL : remainder >>> 1;
    }
    tables[value] = remainder;
  }
  for (let offset = 256; offset < tables.length; offset += 1) {
    const previous = tables[offset - 256] ?? 0;
    tables[offset] = (previous >>> 8) ^ (tables[previous & 0xff] ?? 0);
  }
  return tables;
})();

/** The remainder at `index` of {@link TABLES}, every index of which exists. */
function remainderAt(index: number): number {
  return TABLES[index] ?? 0;
}

/**
 * The CRC-32 of `bytes` following bytes whose CRC-32 was `previous`, so a
 * stream is checked chunk by chunk: the CRC of `a` then `b` is
 * `crc32(b, crc32(a))`. The CRC of nothing is 0.
 */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let remainder = ~previous;
  const byte = (index: number): number => bytes[index] ?? 0;
  const whole = bytes.length - (bytes.length % 8);

  let index = 0;
  for (; index < whole; index += 8) {
    const low =
      remainder ^
      (byte(index) | (byte(index + 1) << 8) | (byte(index + 2) << 16) | (byte(index + 3) << 24));
    remainder =
      remainderAt(1792 + (low & 0xff)) ^
      remainderAt(1536 + ((low >>> 8) & 0xff)) ^
      remainderAt(1280 + ((low >>> 16) & 0xff)) ^
      remainderAt(1024 + (low >>> 24)) ^
      remainderAt(768 + byte(index + 4)) ^
      remainderAt(512 + byte(index + 5)) ^
      remainderAt(256 + byte(index + 6)) ^
      remainderAt(byte(index + 7));
  }
  for (; index < bytes.length; index += 1) {
    remainder = (remainder >>> 8) ^ remainderAt((remainder ^ byte(index)) & 0xff);
  }
  return ~remainder >>> 0;
}
