import { describe, expect, it } from 'vitest';

import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { busName } from './bus-name.js';

describe('a bus’s name (ADR-0101)', () => {
  it.each(['SFX', 'Music & Ambience', 'Ωμέγα', 'x'.repeat(64)])('takes %s as it is', (text) => {
    expect(expectSuccess(busName(text))).toBe(text);
  });

  it.each([
    ['empty', ''],
    ['longer than 64', 'x'.repeat(65)],
    ['holding a control character', 'SFX\n'],
    ['decomposed, not NFC', 'Café'],
  ])('refuses one %s', (_, text) => {
    expect(expectFailureCode(busName(text))).toBe('game.bus-name-invalid');
  });
});
