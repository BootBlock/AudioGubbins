/**
 * G.711 compression against the standard's expansion: every code compresses
 * back to itself from its own value, and every 16-bit sample compresses to a
 * code whose value lies within that code's step of it, so a writer's A-law and
 * µ-law are held to ITU-T G.711 rather than to the package's expansion tables.
 */

import { describe, expect, it } from 'vitest';

import { ALAW_EXPANSION, ULAW_EXPANSION, compressAlaw, compressUlaw } from './g711.js';
import { referenceAlaw, referenceUlaw } from './testing/reference-decoders.js';
import { referenceAlawCompress, referenceUlawCompress } from './testing/reference-encoders.js';

describe.each([
  {
    name: 'A-law',
    compress: compressAlaw,
    reference: referenceAlaw,
    referenceCompress: referenceAlawCompress,
    table: ALAW_EXPANSION,
    mask: 0x55,
  },
  {
    name: 'µ-law',
    compress: compressUlaw,
    reference: referenceUlaw,
    referenceCompress: referenceUlawCompress,
    table: ULAW_EXPANSION,
    mask: 0xff,
  },
])('$name', ({ compress, reference, referenceCompress, table, mask }) => {
  /** The width, in 16-bit units, of the step of the segment a code lies in. */
  const stepOf = (code: number) => {
    const segment = ((code ^ mask) >> 4) & 7;
    return mask === 0x55 ? 16 * 2 ** Math.max(0, segment - 1) : 8 * 2 ** segment;
  };

  it('expands every code to the value the standard gives it', () => {
    for (let code = 0; code < 256; code += 1) expect(table[code]).toBe(reference(code) + 0);
  });

  it('compresses every code’s own value back to that code, the two zeros of µ-law to one', () => {
    for (let code = 0; code < 256; code += 1) {
      const back = compress(reference(code) + 0);
      expect(reference(back) + 0).toBe(reference(code) + 0);
    }
  });

  it('compresses every 16-bit sample to the code the ITU’s encoder gives it', () => {
    for (let sample = -32_768; sample <= 32_767; sample += 1) {
      if (compress(sample) !== referenceCompress(sample)) {
        expect({ sample, code: compress(sample) }).toEqual({
          sample,
          code: referenceCompress(sample),
        });
      }
    }
  });

  it('compresses every 16-bit sample within its code’s step, never out of order', () => {
    let previous = -Infinity;
    for (let sample = -32_768; sample <= 32_767; sample += 1) {
      const code = compress(sample);
      const value = reference(code) + 0;
      expect(Math.abs(value - sample)).toBeLessThanOrEqual(stepOf(code));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
