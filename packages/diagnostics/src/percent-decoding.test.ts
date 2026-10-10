import { describe, expect, it } from 'vitest';

import { holdsPercentEncoding, readEachLayer } from './percent-decoding.js';

/** `text` decoded through every layer the rules read, with nothing read out of it. */
function decoded(text: string): string {
  return readEachLayer(
    text,
    (layer) => layer,
    () => '<unread>',
  );
}

describe('reading a text through its layers of percent-encoding', () => {
  it('decodes each run as UTF-8, a layer at a time, and leaves what is not a run', () => {
    expect(decoded('%2Fhome%2Fzo%C3%AB%2F%E5%BC%A0%F0%9F%8E%B5')).toBe('/home/zoë/张🎵');
    expect(decoded('%252F and %25252F')).toBe('/ and /');
    expect(decoded('100% of 50%ZZ')).toBe('100% of 50%ZZ');
  });

  it('hands each layer to the reader, and reads on from what it makes of it', () => {
    const layers: string[] = [];
    const read = readEachLayer(
      'a%25252Fb c',
      (layer) => {
        layers.push(layer);
        return layer.replace('a', 'x');
      },
      () => '<unread>',
    );
    expect(layers).toEqual(['a%252Fb c', 'x%2Fb c', 'x/b c']);
    expect(read).toBe('x/b c');
  });

  it('replaces a word still encoded past the last layer, and only that word', () => {
    expect(decoded('take %2525252Fhome now')).toBe('take <unread> now');
  });

  it('reads a byte that begins no character, or a character cut short, as a replacement', () => {
    // Left encoded, `%FF` against a root would hide the root from the rule
    // that reads one: `%FF/home/jane` has a letter before its slash.
    expect(decoded('%FF%2Fhome')).toBe('\uFFFD/home');
    // An overlong slash, a surrogate and a code point past U+10FFFF are not
    // characters, and the bytes after a cut-short lead are read afresh.
    expect(decoded('%C0%AF')).toBe('\uFFFD\uFFFD');
    expect(decoded('%ED%A0%80')).toBe('\uFFFD\uFFFD\uFFFD');
    expect(decoded('%F4%90%80%80')).toBe('\uFFFD\uFFFD\uFFFD\uFFFD');
    expect(decoded('%E5%BC%2F')).toBe('\uFFFD/');
    expect(decoded('%E5')).toBe('\uFFFD');
  });

  it('says whether a text still holds a run to decode', () => {
    expect(holdsPercentEncoding('take%201')).toBe(true);
    expect(holdsPercentEncoding('100% of 50%ZZ')).toBe(false);
  });
});
