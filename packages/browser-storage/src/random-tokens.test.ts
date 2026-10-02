import { describe, expect, it } from 'vitest';

import { randomTokens } from './random-tokens.js';

describe('the tokens what is stored is named by', () => {
  it('writes 16 random bytes as hexadecimal, a handle key the media store accepts', () => {
    const next = randomTokens((length) => Uint8Array.from({ length }, (_, index) => index * 17));
    const token = next();
    expect(token).toBe('00112233445566778899aabbccddeeff');
    expect(token).toMatch(/^[A-Za-z0-9._:-]{1,128}$/u);
  });

  it('refuses a source that gives fewer bytes than asked for', () => {
    expect(() => randomTokens(() => new Uint8Array(4))()).toThrow(/16 random bytes/);
  });
});
