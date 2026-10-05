import { describe, expect, it } from 'vitest';

import { stereo, sine } from './signals.js';
import { wavFile } from './wav-files.js';

describe('a fixture written as a WAV file', () => {
  it('states its rate, channels and length in a canonical 16-bit PCM header', () => {
    const fixture = stereo(
      sine(440, { length: 100, sampleRate: 44_100 }),
      sine(880, { length: 100, sampleRate: 44_100 }),
    );

    const view = new DataView(wavFile(fixture).buffer);

    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint32(28, true)).toBe(44_100 * 4);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(400);
    expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
  });

  it('interleaves the channels frame by frame, each sample at full scale', () => {
    const fixture = stereo(sine(440, { length: 4 }), sine(880, { length: 4 }));
    const [left, right] = fixture.channels;
    if (left === undefined || right === undefined) throw new Error('Not stereo.');
    left.set([1, -1, 0.5, 0]);
    right.set([0, 2, -2, 0.25]);

    const view = new DataView(wavFile(fixture).buffer);
    const samples = Array.from({ length: 8 }, (_, index) => view.getInt16(44 + index * 2, true));

    expect(samples).toEqual([32_767, 0, -32_767, 32_767, 16_384, -32_767, 0, 8192]);
  });
});
