import { describe, expect, it } from 'vitest';

import { inCase } from './case-modifiers.js';

describe('the case modifiers', () => {
  it('map the whole text for lower and upper, separators and all', () => {
    expect(inCase('Foot Steps-01', 'lower')).toBe('foot steps-01');
    expect(inCase('Foot Steps-01', 'upper')).toBe('FOOT STEPS-01');
  });

  it('join the words in lower case for snake and kebab, dropping what separates them', () => {
    expect(inCase('  Foot Steps -- Grass (wet) 01! ', 'snake')).toBe('foot_steps_grass_wet_01');
    expect(inCase('  Foot Steps -- Grass (wet) 01! ', 'kebab')).toBe('foot-steps-grass-wet-01');
  });

  it("writes each word's first code point upper and the rest lower for pascal", () => {
    expect(inCase('foot STEPS_grass 01', 'pascal')).toBe('FootStepsGrass01');
  });

  it('gives no word from text with no letter or digit', () => {
    expect(inCase(' - _ ', 'snake')).toBe('');
    expect(inCase(' - _ ', 'pascal')).toBe('');
  });

  it('reads letters and digits of every script as words', () => {
    expect(inCase('Café Über_Ωmega', 'kebab')).toBe('café-über-ωmega');
    expect(inCase('東京 タワー', 'snake')).toBe('東京_タワー');
    expect(inCase('٣ أصوات', 'kebab')).toBe('٣-أصوات');
  });

  it('keeps a combining mark with the letter before it, so a word is not split at its vowels', () => {
    expect(inCase('नमस्ते दुनिया', 'kebab')).toBe('नमस्ते-दुनिया');
  });

  it('reads the text as NFC first', () => {
    expect(inCase('Cafe\u0301 bar', 'snake')).toBe('café_bar');
    expect(inCase('cafe\u0301', 'upper')).toBe('CAFÉ');
  });

  it('upper-cases a first code point outside the basic plane whole', () => {
    expect(inCase('𐐨𐐨 x', 'pascal')).toBe('𐐀𐐨X');
  });
});
