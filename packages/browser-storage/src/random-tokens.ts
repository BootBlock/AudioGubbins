/**
 * The tokens kept handles and stored objects are named by: 128 random bits from
 * the platform's cryptographic source, written as hexadecimal.
 *
 * Random rather than counted, because two tabs name things in one storage
 * without asking each other, and a name one tab chose must never be one the
 * other chooses (REQ-STOR-104). Opaque, so a token says nothing of the file or
 * the path it names. The source is read by the capabilities package and passed
 * in, as the domain's identifier generator takes it.
 */

import type { TokenSource } from '@audiogubbins/media-store';

const TOKEN_BYTES = 16;

/** Tokens made from the random source. */
export function randomTokens(randomBytes: (length: number) => Uint8Array): TokenSource {
  return () => {
    const bytes = randomBytes(TOKEN_BYTES);
    if (bytes.length !== TOKEN_BYTES) {
      throw new Error(`A token needs ${String(TOKEN_BYTES)} random bytes.`);
    }
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  };
}
