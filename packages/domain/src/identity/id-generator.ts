/**
 * Where new identifiers come from.
 *
 * The domain does not reach for `crypto.randomUUID`. REQ-ARCH-151 requires the
 * domain to stay independently testable without a browser, and REQ-EXEC-216
 * prohibits assuming a browser API is available. Identifier generation is
 * therefore a contract the composition root supplies.
 *
 * It is also what makes golden and reference tests possible: a test that runs
 * the same operations twice must produce the same project, and it cannot if the
 * domain reaches for a global random source of its own.
 */

import { type Branded, isWellFormedId, unsafeBrandId } from './branded-id.js';

/** Supplies fresh identifiers to the domain. */
export interface IdGenerator {
  /**
   * Returns an identifier that has not been returned before by this generator.
   *
   * Implementations must produce a string satisfying `isWellFormedId`.
   */
  next<TBrand extends string>(): Branded<TBrand>;
}

/**
 * A generator backed by a caller-supplied source of randomness.
 *
 * The composition root passes the platform's cryptographic random source. Tests
 * pass a deterministic sequence, which is what makes a reproducible fixture
 * possible (REQ-REPO-191).
 */
export function createIdGenerator(randomBytes: (length: number) => Uint8Array): IdGenerator {
  return {
    next<TBrand extends string>(): Branded<TBrand> {
      const bytes = randomBytes(16);
      if (bytes.length !== 16) {
        throw new Error(
          `IdGenerator requires 16 bytes of randomness, the supplied source returned ${String(bytes.length)}.`,
        );
      }

      let hex = '';
      for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, '0');
      }

      // Grouped for readability in logs and project files. The groups carry no
      // meaning; nothing may parse them.
      const value = `${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}-${hex.slice(24, 32)}`;

      if (!isWellFormedId(value)) {
        throw new Error(`IdGenerator produced a malformed identifier: ${value}`);
      }
      return unsafeBrandId<TBrand>(value);
    },
  };
}

/**
 * A generator producing a fixed, repeatable sequence from a seed.
 *
 * For tests and deterministic fixtures only. It uses a small counter-based
 * mixing function, not a cryptographic one, and must never generate identifiers
 * that reach a user's project.
 */
export function createDeterministicIdGenerator(seed: number): IdGenerator {
  let counter = 0;

  return createIdGenerator((length) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      // A counter-based mix (SplitMix-style constants) so that successive bytes
      // differ visibly, which makes a failing test's identifiers readable.
      counter += 1;
      let mixed = (seed + counter * 0x9e3779b9) >>> 0;
      mixed ^= mixed >>> 16;
      mixed = Math.imul(mixed, 0x21f0aaad) >>> 0;
      mixed ^= mixed >>> 15;
      bytes[index] = mixed & 0xff;
    }
    return bytes;
  });
}
