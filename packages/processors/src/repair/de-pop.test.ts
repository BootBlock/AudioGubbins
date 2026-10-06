import { describe, expect, it } from 'vitest';

import { MAXIMUM_QUALITY, StandardLayouts } from '@audiogubbins/domain';

import { processorProperties } from '../testing/processor-properties.js';
import {
  TEST_RATE,
  processorKernel,
  processorValues,
  runProcessor,
} from '../testing/processor-run.js';
import { EVERY_LAYOUT } from '../testing/filter-measures.js';
import { changedFrames, faded, withPop } from '../testing/repair-signals.js';
import { DE_POP } from './de-pop.js';

processorProperties(DE_POP, {
  layouts: EVERY_LAYOUT,
  settings: [
    { sensitivity: 6, frequency: 20, 'maximum-length': 50 },
    { frequency: 300, 'maximum-length': 5 },
  ],
  // At the least sensitivity nothing in the programme is a pop, so this
  // holds the declared latency to the kernel's, bit for bit.
  passThrough: { values: { sensitivity: 40 }, tolerance: 0 },
});

const mono = StandardLayouts.mono;
const LENGTH = 48_000;

type Values = Readonly<Record<string, string | number>>;

function latencyOf(values: Values = {}): number {
  const latency = DE_POP.descriptor.latency({
    values: processorValues(DE_POP, values),
    sampleRate: TEST_RATE,
    quality: MAXIMUM_QUALITY.settings,
  });
  if (latency.kind !== 'known') throw new Error('A de-pop states its latency.');
  return latency.frames;
}

function render(input: Float32Array, values: Values = {}): Float32Array {
  const [out] = runProcessor(DE_POP, { layout: mono, values }, [input]);
  return out ?? new Float32Array(0);
}

/** A second of a 1 kHz tone, faded in, above any pop frequency. */
const TONE = faded(
  Float32Array.from({ length: LENGTH }, (_, frame) => 0.2 * Math.sin((2 * Math.PI * frame) / 48)),
);

/** The energy of `output`, `latency` later, less `clean`, over `from` to `to`. */
function residual(
  output: Float32Array,
  clean: Float32Array,
  latency: number,
  from: number,
  to: number,
): number {
  let sum = 0;
  for (let frame = from; frame < to; frame += 1) {
    sum += ((output[frame + latency] ?? 0) - (clean[frame] ?? 0)) ** 2;
  }
  return sum;
}

describe('the de-pop', () => {
  it('states the latency its geometry gives: 6 041 frames at 120 Hz and 30 ms', () => {
    // 3Δ + 2M + 12h + 5, with K = 127, Δ = 252, M = 1 440 and h = 200.
    expect(latencyOf()).toBe(3 * 252 + 2 * 1_440 + 12 * 200 + 5);
  });

  it('turns a pop down by more than 15 dB, and only where it is', () => {
    const pop = { at: 20_000, frequency: 50, decay: 0.008, size: 0.5 };
    const dirty = withPop(TONE, pop);
    const latency = latencyOf();
    const out = render(dirty);
    const before = residual(dirty, TONE, 0, 19_000, 24_000);
    const after = residual(out, TONE, latency, 19_000, 24_000);
    expect(10 * Math.log10(after / before)).toBeLessThan(-15);
    const changed = changedFrames(out, dirty, latency);
    expect(changed.filter((frame) => frame < 19_000 || frame >= 24_000)).toEqual([]);
  });

  it('leaves a held low note that starts out of silence as the note it is', () => {
    const note = faded(
      Float32Array.from({ length: LENGTH }, (_, frame) =>
        frame < 20_000 ? 0 : 0.4 * Math.sin((2 * Math.PI * 60 * frame) / TEST_RATE),
      ),
    );
    const dirty = Float32Array.from(TONE, (sample, frame) => sample + (note[frame] ?? 0));
    expect(changedFrames(render(dirty), dirty, latencyOf())).toEqual([]);
  });

  it('leaves a held note that starts within the run a fainter thump began', () => {
    // The thump, more than 30 dB under the note, starts a run whose judged
    // frames end 1 500 frames into the note: the note's core reaches the end
    // of what is judged, so it is not seen to end, and is no pop.
    const note = Float32Array.from({ length: LENGTH }, (_, frame) =>
      frame < 21_500 ? 0 : 0.4 * Math.sin((2 * Math.PI * 60 * frame) / TEST_RATE),
    );
    const dirty = withPop(
      Float32Array.from(TONE, (sample, frame) => sample + (note[frame] ?? 0)),
      { at: 20_000, frequency: 50, decay: 0.004, size: 0.005 },
    );
    expect(changedFrames(render(dirty), dirty, latencyOf())).toEqual([]);
  });

  it('leaves a thump longer than the longest pop', () => {
    // A decay of 40 ms holds within 30 dB of its peak for 140 ms.
    const dirty = withPop(TONE, { at: 20_000, frequency: 50, decay: 0.04, size: 0.5 });
    const values = { 'maximum-length': 10 };
    expect(changedFrames(render(dirty, values), dirty, latencyOf(values))).toEqual([]);
  });

  it('finds a pop only above the sensitivity, which moves while it plays', () => {
    // A quiet 80 Hz hum under the tone sets the floor the pops rise 25 dB above.
    const hummed = faded(
      Float32Array.from(
        TONE,
        (sample, frame) => sample + 0.01 * Math.sin((2 * Math.PI * 80 * frame) / TEST_RATE),
      ),
    );
    const dirty = withPop(withPop(hummed, { at: 12_000, frequency: 50, decay: 0.008, size: 0.2 }), {
      at: 36_000,
      frequency: 50,
      decay: 0.008,
      size: 0.2,
    });
    const latency = latencyOf();
    expect(changedFrames(render(dirty, { sensitivity: 40 }), dirty, latency)).toEqual([]);
    const { kernel } = processorKernel(DE_POP, { layout: mono, values: { sensitivity: 15 } });
    const moved = new Float32Array(LENGTH);
    const block = (channel: Float32Array, from: number) => ({
      layout: mono,
      sampleRate: TEST_RATE,
      frames: 1_000,
      channels: [channel.subarray(from, from + 1_000)],
    });
    for (let from = 0; from < LENGTH; from += 1_000) {
      if (from === 24_000) expect(kernel.setParameter('sensitivity', 40).ok).toBe(true);
      kernel.process([block(dirty, from)], [block(moved, from)], 1_000);
    }
    const changed = changedFrames(moved, dirty, latency);
    expect(changed.some((frame) => frame >= 11_000 && frame < 14_000)).toBe(true);
    expect(changed.filter((frame) => frame >= 24_000)).toEqual([]);
  });

  it('refuses to move the frequency or the longest pop while it plays', () => {
    const { kernel } = processorKernel(DE_POP, { layout: mono });
    expect(kernel.setParameter('frequency', 200).ok).toBe(false);
    expect(kernel.setParameter('maximum-length', 10).ok).toBe(false);
    expect(kernel.setParameter('sensitivity', 41).ok).toBe(false);
  });

  it('takes from the music above the frequency less than −60 dB of it through a pop', () => {
    const dirty = withPop(TONE, { at: 20_000, frequency: 50, decay: 0.008, size: 0.5 });
    const latency = latencyOf();
    const out = render(dirty);
    // The 1 kHz amplitude of a signal over 50 ms from the pop, through a
    // Hann window, whose side lobes leave the pop's 50 Hz far below it.
    const at1kHz = (value: (frame: number) => number) => {
      let real = 0;
      let imaginary = 0;
      for (let offset = 0; offset < 2_400; offset += 1) {
        const taper = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / 2_400);
        const sample = value(20_000 + offset) * taper;
        real += sample * Math.cos((2 * Math.PI * offset) / 48);
        imaginary += sample * Math.sin((2 * Math.PI * offset) / 48);
      }
      return Math.hypot(real, imaginary);
    };
    const taken = at1kHz((frame) => (dirty[frame] ?? 0) - (out[frame + latency] ?? 0));
    expect(changedFrames(out, dirty, latency).length).toBeGreaterThan(0);
    expect(20 * Math.log10(taken / at1kHz((frame) => TONE[frame] ?? 0))).toBeLessThan(-60);
  });

  it('repairs each channel alone, leaving a clean channel beside a popped one untouched', () => {
    const dirty = withPop(TONE, { at: 20_000, frequency: 50, decay: 0.008, size: 0.5 });
    const latency = latencyOf();
    const [left = new Float32Array(0), right = new Float32Array(0)] = runProcessor(
      DE_POP,
      { layout: StandardLayouts.stereo },
      [dirty, TONE],
    );
    expect(changedFrames(left, dirty, latency).length).toBeGreaterThan(0);
    expect(changedFrames(right, TONE, latency)).toEqual([]);
  });
});
