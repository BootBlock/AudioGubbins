/**
 * The tone source read from anywhere: the frames it writes from the middle
 * are the frames a read from its first frame writes, on both DSP paths, and
 * reaching the middle renders nothing but the frames read.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  mapResult,
  sampleCount,
  sampleRate,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { wasmDsp } from '../dsp/wasm/wasm-dsp.js';
import { dspModuleExports } from '../testing/dsp-module.js';
import { allocateBlock } from './frame-block.js';
import type { PcmSource } from './pcm-source.js';
import { toneSource } from './tone-source.js';

const STEREO = StandardLayouts.stereo;

function frames(value: number): SampleCount {
  return expectSuccess(sampleCount(value));
}

/** `dsp`, counting every frame its oscillators render. */
function countingRenders(dsp: CanonicalDsp): { dsp: CanonicalDsp; rendered: () => number } {
  let rendered = 0;
  return {
    dsp: {
      ...dsp,
      createOscillator: (settings) =>
        mapResult(dsp.createOscillator(settings), (oscillator) => ({
          render: (into: Float32Array) => {
            rendered += into.length;
            oscillator.render(into);
          },
          seek: (frame: number) => {
            oscillator.seek(frame);
          },
          release: () => {
            oscillator.release();
          },
        })),
    },
    rendered: () => rendered,
  };
}

function toneOn(dsp: CanonicalDsp): PcmSource {
  return expectSuccess(
    toneSource(dsp, {
      layout: STEREO,
      sampleRate: expectSuccess(sampleRate(44_100)),
      frequency: 997,
      amplitude: 0.5,
      length: undefined,
    }),
  );
}

/** Reads `count` frames from `start` in reads of `chunk`, one array per channel. */
async function readRange(
  source: PcmSource,
  start: number,
  count: number,
  chunk: number,
): Promise<Float32Array[]> {
  const out = source.layout.roles.map(() => new Float32Array(count));
  const block = allocateBlock(source.layout, source.sampleRate, chunk);
  for (let offset = 0; offset < count; offset += chunk) {
    const read = await source.read(frames(start + offset), block);
    block.channels.forEach((channel, index) =>
      out[index]?.set(channel.subarray(0, Math.min(read, count - offset)), offset),
    );
  }
  return out;
}

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe.each([
  ['the WebAssembly module', () => wasm],
  ['the reference path', () => REFERENCE_DSP],
])('a tone source on %s', (_path, dspOf) => {
  it('writes from the middle the bits a read from the start writes, and again after reading on', async () => {
    const start = 12_345;
    const fromZero = await readRange(toneOn(dspOf()), 0, start + 3_000, 1_000);
    const expected = fromZero.map((channel) => channel.subarray(start));

    const seeking = toneOn(dspOf());
    expect(await readRange(seeking, start, 3_000, 700)).toEqual(expected);
    await readRange(seeking, 20_000, 500, 500);
    expect(await readRange(seeking, start, 3_000, 128)).toEqual(expected);
  });

  it('renders only the frames it is asked for, however far in they start', async () => {
    for (const start of [10, 5_000_000_000]) {
      const { dsp, rendered } = countingRenders(dspOf());
      const source = toneOn(dsp);
      await readRange(source, start, 2_000, 500);
      source.release();
      expect(rendered()).toBe(2_000);
    }
  });
});
