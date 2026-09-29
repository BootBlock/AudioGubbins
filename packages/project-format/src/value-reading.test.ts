import { describe, expect, it } from 'vitest';

import { startReading } from './document-reading.js';
import { asMediaType, asWholeQuantity, isMediaType, isWholeQuantity } from './value-reading.js';

/** Whether a converter's reading of the value found no problem. */
function reads(convert: typeof asMediaType | typeof asWholeQuantity, value: string | number) {
  const reading = startReading();
  convert(reading, value, '', 'value');
  return reading.outcome(true).ok;
}

describe('the checks offered beside the readers', () => {
  it('takes a media type the reader takes, and nothing else', () => {
    const cases = [
      ['audio/wav', true],
      ['audio/x-wav', true],
      ['application/octet-stream', true],
      [`audio/${'x'.repeat(249)}`, true],
      [`audio/${'x'.repeat(250)}`, false],
      ['Audio/WAV', false],
      ['audio', false],
      ['audio/wav/extra', false],
      ['audio/ogg; codecs=opus', false],
      ['', false],
    ] as const;
    for (const [text, taken] of cases) {
      expect(isMediaType(text), text).toBe(taken);
      expect(reads(asMediaType, text), text).toBe(taken);
    }
  });

  it('takes a whole quantity the reader takes, and nothing else', () => {
    const cases = [
      [0, true],
      [1_780_000_000_000, true],
      [Number.MAX_SAFE_INTEGER, true],
      [-1, false],
      [1.5, false],
      [2 ** 53, false],
      [Number.NaN, false],
      [Number.POSITIVE_INFINITY, false],
    ] as const;
    for (const [value, taken] of cases) {
      expect(isWholeQuantity(value), String(value)).toBe(taken);
      expect(reads(asWholeQuantity, value), String(value)).toBe(taken);
    }
  });
});
