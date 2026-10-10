/**
 * Golden magnitudes of the canonical STFT a spectrogram's tiles are built from
 * (ADR-0080): over the spectral goldens' sound (`testing/spectral-golden.ts`),
 * through the Blackman–Harris window at the default spectrogram's length and
 * overlap, the shortest window a spectrogram may have at its finest overlap and
 * the longest, and the periodic Hann the person may choose instead. Both DSP
 * paths give the same bits, read in pushes of other lengths, and those bits are
 * pinned (ADR-0032). A tile's power is a function of these magnitudes alone, so
 * the tiles' own goldens stand on these.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../testing/dsp-module.js';
import { doublesFingerprint } from '../testing/pcm-fingerprint.js';
import { GOLDEN_INPUT } from '../testing/spectral-golden.js';
import { StftWindow } from './canonical-analysis.js';
import type { CanonicalDsp } from './canonical-dsp.js';
import { REFERENCE_DSP } from './reference/reference-dsp.js';
import { wasmDsp } from './wasm/wasm-dsp.js';

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

/**
 * Every frame's magnitudes, each channel's after the last's, of the golden
 * sound pushed in pushes of `chunk` frames and then `size − hop` zeros, so
 * the last frames reach its end.
 */
function magnitudes(
  dsp: CanonicalDsp,
  size: number,
  overlap: number,
  window: StftWindow,
  chunk: number,
): Float64Array {
  const hop = size / overlap;
  const channels = GOLDEN_INPUT.length;
  const stft = expectSuccess(dsp.createStft({ channels, size, hop, window }));
  const frame = new Float64Array(channels * stft.bins);
  const phases = new Float64Array(channels * stft.bins);
  const frames: Float64Array[] = [];
  const drain = (): void => {
    while (stft.pullPolar(frame, phases)) frames.push(frame.slice());
  };
  const length = GOLDEN_INPUT[0]?.length ?? 0;
  for (let start = 0; start < length; start += chunk) {
    stft.push(GOLDEN_INPUT.map((channel) => channel.subarray(start, start + chunk)));
    drain();
  }
  stft.push(GOLDEN_INPUT.map(() => new Float32Array(size - hop)));
  drain();
  stft.release();
  const all = new Float64Array(frames.length * frame.length);
  frames.forEach((one, index) => {
    all.set(one, index * frame.length);
  });
  return all;
}

describe('the STFT a spectrogram is built from', () => {
  it.each([
    ['default spectrogram', 2_048, 4, StftWindow.BlackmanHarris, 93, 0x669c3b1f3cb74596n],
    ['shortest window', 256, 8, StftWindow.BlackmanHarris, 1_500, 0x740bd18f0b7b401dn],
    ['longest window', 32_768, 2, StftWindow.BlackmanHarris, 2, 0x31e94a0fb6327e6bn],
    ['Hann window', 2_048, 4, StftWindow.Hann, 93, 0x45deda9eb0d2c787n],
  ] as const)(
    'gives the same pinned magnitudes on either DSP: the %s, %s samples at overlap %s through the %s',
    (_name, size, overlap, window, frames, golden) => {
      const reference = magnitudes(REFERENCE_DSP, size, overlap, window, 4_096);
      const assembled = magnitudes(wasm, size, overlap, window, 997);
      expect(reference.length).toBe(frames * GOLDEN_INPUT.length * (size / 2 + 1));
      expect(doublesFingerprint(assembled)).toBe(doublesFingerprint(reference));
      expect(doublesFingerprint(reference)).toBe(golden);
    },
  );
});
