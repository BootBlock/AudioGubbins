/**
 * Base64 (RFC 4648, section 4), which a Vorbis comment carries a picture in as
 * `METADATA_BLOCK_PICTURE`.
 *
 * Written out because this package compiles against the ES2023 library alone,
 * where neither `btoa` nor `Uint8Array.fromBase64` exists. Both directions work
 * on the ASCII bytes a comment holds, never on a string, so a picture of many
 * megabytes is never held as millions of characters. Decoding is strict about
 * the alphabet and the padding, since its input is a file's untrusted bytes,
 * and answers `undefined` for anything that is not base64.
 */

const ALPHABET = Uint8Array.from(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  (character) => character.charCodeAt(0),
);

/** `=`, which pads the last group. */
const PAD = 0x3d;

/** Each byte's six bits, or -1 for a byte outside the alphabet. */
const SEXTETS: Int8Array = (() => {
  const table = new Int8Array(256).fill(-1);
  ALPHABET.forEach((code, index) => {
    table[code] = index;
  });
  return table;
})();

const letter = (sextet: number): number => ALPHABET[sextet & 0x3f] ?? PAD;

/** The base64 text of `bytes`, padded, as ASCII bytes. */
export function encodeBase64(bytes: Uint8Array): Uint8Array {
  const text = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let written = 0;
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const remaining = bytes.length - offset;
    const triple =
      ((bytes[offset] ?? 0) << 16) | ((bytes[offset + 1] ?? 0) << 8) | (bytes[offset + 2] ?? 0);
    text[written] = letter(triple >> 18);
    text[written + 1] = letter(triple >> 12);
    text[written + 2] = remaining > 1 ? letter(triple >> 6) : PAD;
    text[written + 3] = remaining > 2 ? letter(triple) : PAD;
    written += 4;
  }
  return text;
}

/** The bytes of padded base64 text given as ASCII bytes, or `undefined` where it is not base64. */
export function decodeBase64(text: Uint8Array): Uint8Array | undefined {
  if (text.length % 4 !== 0) return undefined;
  const padding = text[text.length - 2] === PAD ? 2 : text[text.length - 1] === PAD ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let written = 0;
  for (let offset = 0; offset < text.length; offset += 4) {
    let quad = 0;
    for (let index = 0; index < 4; index += 1) {
      const at = offset + index;
      const code = text[at] ?? PAD;
      const sextet = at >= text.length - padding ? (code === PAD ? 0 : -1) : (SEXTETS[code] ?? -1);
      if (sextet < 0) return undefined;
      quad = (quad << 6) | sextet;
    }
    for (let index = 0; index < 3 && written < bytes.length; index += 1) {
      bytes[written] = (quad >> (16 - 8 * index)) & 0xff;
      written += 1;
    }
  }
  return bytes;
}
