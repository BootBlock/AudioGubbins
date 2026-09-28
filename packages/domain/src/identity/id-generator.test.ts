import { describe, expect, it } from 'vitest';

import { isWellFormedId } from './branded-id.js';
import { createDeterministicIdGenerator, createIdGenerator } from './id-generator.js';

describe('createIdGenerator', () => {
  it('renders every byte of the supplied randomness', () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
    const generator = createIdGenerator(() => bytes);
    expect(generator.next<'AssetId'>()).toBe('00010203-04050607-08090a0b-0c0d0e0f');
  });

  it('refuses a randomness source that returns the wrong number of bytes', () => {
    const generator = createIdGenerator(() => new Uint8Array(8));
    expect(() => generator.next()).toThrow(/16 bytes/);
  });
});

describe('createDeterministicIdGenerator', () => {
  it('produces the same sequence for the same seed', () => {
    const first = createDeterministicIdGenerator(1234);
    const second = createDeterministicIdGenerator(1234);
    const fromFirst = [first.next(), first.next(), first.next()];
    const fromSecond = [second.next(), second.next(), second.next()];
    expect(fromFirst).toEqual(fromSecond);
  });

  it('produces different sequences for different seeds', () => {
    const first = createDeterministicIdGenerator(1);
    const second = createDeterministicIdGenerator(2);
    expect(first.next()).not.toBe(second.next());
  });

  it('does not repeat an identifier within a run', () => {
    const generator = createDeterministicIdGenerator(99);
    const produced = new Set<string>();
    for (let index = 0; index < 1_000; index += 1) {
      produced.add(generator.next());
    }
    expect(produced.size).toBe(1_000);
  });

  it('produces only well-formed identifiers', () => {
    const generator = createDeterministicIdGenerator(7);
    for (let index = 0; index < 200; index += 1) {
      expect(isWellFormedId(generator.next())).toBe(true);
    }
  });
});

describe('isWellFormedId', () => {
  it('accepts an identifier the generator produced', () => {
    expect(isWellFormedId('00010203-04050607-08090a0b-0c0d0e0f')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isWellFormedId('')).toBe(false);
  });

  it('rejects a string shorter than the minimum', () => {
    // Eight characters is the minimum.
    expect(isWellFormedId('0a1b2c3')).toBe(false);
    expect(isWellFormedId('0a1b2c3d')).toBe(true);
  });

  it('rejects a string longer than the maximum', () => {
    // Sixty-four characters is the maximum.
    expect(isWellFormedId('0a'.repeat(32))).toBe(true);
    expect(isWellFormedId(`${'0a'.repeat(32)}b`)).toBe(false);
  });

  it('rejects upper-case hexadecimal, so two spellings cannot mean one entity', () => {
    expect(isWellFormedId('00010203-04050607-08090A0B-0C0D0E0F')).toBe(false);
  });

  it('rejects characters that would need escaping in a path or a URL', () => {
    for (const candidate of [
      '0001/203-04050607',
      '00010203 04050607',
      '00010203-0405060g',
      '../00010203-04050607',
    ]) {
      expect(isWellFormedId(candidate)).toBe(false);
    }
  });

  it('rejects an identifier that starts or ends with a hyphen', () => {
    expect(isWellFormedId('-0010203-04050607')).toBe(false);
    expect(isWellFormedId('00010203-0405060-')).toBe(false);
  });
});
