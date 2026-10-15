import { describe, expect, it } from 'vitest';

import { safeFileName, safeFolderName } from './file-name-safety.js';

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe('a safe folder name', () => {
  it('leaves a name every common file system takes as it is', () => {
    for (const segment of ['audio', 'Foot steps', 'grass_01', 'Café', 'v1.2']) {
      expect(safeFolderName(segment)).toBe(segment);
    }
  });

  it("holds a folder to a file stem's rules", () => {
    for (const segment of ['a<b', 'a/b', ' lead', 'trail.', '.hidden', 'CON', 'lpt1.x', '']) {
      expect(safeFolderName(segment)).toBe(
        safeFileName({ stem: segment, extension: 'x' }).slice(0, -'.x'.length),
      );
      expect(safeFolderName(segment)).not.toBe(segment);
    }
  });

  it('writes the name as NFC', () => {
    expect(safeFolderName('Café')).toBe('Café');
  });

  it('keeps the whole 255 bytes for the name, with no extension to make room for', () => {
    expect(safeFolderName('a'.repeat(255))).toBe('a'.repeat(255));
    expect(safeFolderName('é'.repeat(200))).toBe('é'.repeat(127));
    expect(utf8Bytes(safeFolderName('🔊'.repeat(100)))).toBe(252);
  });
});
