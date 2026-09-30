import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  sampleCount,
  sampleRate,
  type SampleCount,
  type SampleRate,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';

import { ResamplingQuality } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { allocateBlock, blockView, frameBlock, type AudioFrameBlock } from './frame-block.js';
import { memorySource } from './memory-source.js';
import { offsetSource, type PcmSource } from './pcm-source.js';
import { resampledSource } from './resampled-source.js';
import { toneRecipe } from './signal-recipe.js';
import { signalSource } from './signal-source.js';
import { countingDsp } from '../testing/counting-dsp.js';

const RATE: SampleRate = expectSuccess(sampleRate(48_000));

function frames(value: number): SampleCount {
  return expectSuccess(sampleCount(value));
}

/** Reads a whole bounded source in reads of `chunk` frames. */
async function readAll(source: PcmSource, chunk: number): Promise<Float32Array[]> {
  const total = source.length ?? 0;
  const out = source.layout.roles.map(() => new Float32Array(total));
  const block = allocateBlock(source.layout, source.sampleRate, chunk);
  for (let start = 0; start < total; start += chunk) {
    const read = await source.read(frames(start), block, undefined);
    block.channels.forEach((channel, index) => out[index]?.set(channel.subarray(0, read), start));
  }
  return out;
}

function ramp(count: number, scale: number): Float32Array {
  return Float32Array.from({ length: count }, (_, index) => ((index % 50) - 25) * scale);
}

describe('frame blocks', () => {
  it('refuses arrays that do not match the layout, rather than dropping a channel', () => {
    const two = [new Float32Array(4), new Float32Array(4)];
    expect(expectFailureCode(frameBlock(StandardLayouts.surround5_1, RATE, two))).toBe(
      'pcm.block-channel-count-mismatch',
    );
    expect(
      expectFailureCode(
        frameBlock(StandardLayouts.stereo, RATE, [new Float32Array(4), new Float32Array(5)]),
      ),
    ).toBe('pcm.block-channel-lengths-differ');
  });

  it('views part of a block without copying it', () => {
    const block = allocateBlock(StandardLayouts.stereo, RATE, 10);
    const view = blockView(block, 4, 3);
    view.channels[1]?.fill(7);
    expect(view.frames).toBe(3);
    expect([...(block.channels[1] ?? [])]).toEqual([0, 0, 0, 0, 7, 7, 7, 0, 0, 0]);
    expect(blockView(block, 8, 5).frames).toBe(2);
  });
});

describe('the memory source', () => {
  const block = expectSuccess(
    frameBlock(StandardLayouts.stereo, RATE, [ramp(100, 0.01), ramp(100, -0.02)]),
  );

  it('reads its frames in any chunks, and fewer at its end', async () => {
    const source = expectSuccess(memorySource(block));
    const whole = await readAll(source, 100);
    expect(await readAll(source, 7)).toEqual(whole);
    const into = allocateBlock(StandardLayouts.stereo, RATE, 30);
    expect(await source.read(frames(90), into, undefined)).toBe(10);
  });

  it('refuses to read into a block of another layout', async () => {
    const source = expectSuccess(memorySource(block));
    const mono = allocateBlock(StandardLayouts.mono, RATE, 10);
    await expect(source.read(frames(0), mono, undefined)).rejects.toThrow(/layout and rate/);
  });

  it('starts at an offset, as playback after a seek reads', async () => {
    const source = expectSuccess(offsetSource(expectSuccess(memorySource(block)), frames(60)));
    expect(source.length).toBe(40);
    const [left] = await readAll(source, 16);
    expect(left).toEqual(block.channels[0]?.subarray(60));
  });
});

describe('a signal source of one tone', () => {
  const settings = {
    layout: StandardLayouts.surround5_1,
    sampleRate: RATE,
    recipe: expectSuccess(toneRecipe(6, 9_600, 997, 0.25)),
  };

  it('puts the same tone on every channel of a 5.1 layout, none dropped or reordered', async () => {
    const channels = await readAll(expectSuccess(signalSource(REFERENCE_DSP, settings)), 512);
    expect(channels).toHaveLength(6);
    for (const channel of channels) expect(channel).toEqual(channels[0]);
    expect(Math.max(...(channels[0] ?? []))).toBeCloseTo(0.25, 4);
  });

  it('gives frame n the same bits whether read in order or reached by a seek', async () => {
    const source = expectSuccess(signalSource(REFERENCE_DSP, settings));
    const [inOrder] = await readAll(source, 1_000);
    const block = allocateBlock(settings.layout, RATE, 100);
    await source.read(frames(7_000), block, undefined);
    expect(block.channels[3]).toEqual(inOrder?.subarray(7_000, 7_100));
  });
});

describe('the resampled source', () => {
  const block: AudioFrameBlock = expectSuccess(
    frameBlock(StandardLayouts.stereo, RATE, [ramp(3_000, 0.01), ramp(3_000, 0.015)]),
  );

  it('converts explicitly to the length the rates give', () => {
    const source = expectSuccess(
      resampledSource(
        REFERENCE_DSP,
        expectSuccess(memorySource(block)),
        expectSuccess(sampleRate(44_100)),
        ResamplingQuality.High,
      ),
    );
    expect(source.length).toBe(2_757);
    expect(source.sampleRate).toBe(44_100);
  });

  it('writes the same frames whatever the reads, and after a seek back', async () => {
    const make = (): PcmSource =>
      expectSuccess(
        resampledSource(
          REFERENCE_DSP,
          expectSuccess(memorySource(block)),
          expectSuccess(sampleRate(32_000)),
          ResamplingQuality.Draft,
        ),
      );
    const whole = await readAll(make(), 5_000);
    expect(await readAll(make(), 33)).toEqual(whole);

    const seeking = make();
    await readAll(seeking, 400);
    const into = allocateBlock(StandardLayouts.stereo, expectSuccess(sampleRate(32_000)), 50);
    await seeking.read(frames(1_000), into, undefined);
    expect(into.channels[1]).toEqual(whole[1]?.subarray(1_000, 1_050));
  });

  it('copies audio exactly when the rates are equal', async () => {
    const source = expectSuccess(
      resampledSource(
        REFERENCE_DSP,
        expectSuccess(memorySource(block)),
        RATE,
        ResamplingQuality.Maximum,
      ),
    );
    expect(await readAll(source, 256)).toEqual(block.channels);
  });
});

describe('releasing a source', () => {
  it('releases what the source made, and only that', async () => {
    const { dsp, held } = countingDsp();
    const tone = expectSuccess(
      signalSource(dsp, {
        layout: StandardLayouts.stereo,
        sampleRate: RATE,
        recipe: expectSuccess(toneRecipe(2, 4_800, 440, 0.5)),
      }),
    );
    const converted = expectSuccess(
      resampledSource(dsp, tone, expectSuccess(sampleRate(44_100)), ResamplingQuality.Draft),
    );
    // A read that seeks back moves the resampler, and makes the oscillator again.
    await readAll(converted, 1_000);
    await converted.read(
      frames(10),
      allocateBlock(StandardLayouts.stereo, converted.sampleRate, 5),
    );
    expect(held()).toBe(2);

    converted.release();
    expect(held()).toBe(1);
    tone.release();
    expect(held()).toBe(0);
  });
});
