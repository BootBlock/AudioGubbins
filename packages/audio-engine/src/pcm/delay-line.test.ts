import { describe, expect, it } from 'vitest';

import { StandardLayouts, sampleRate, type SampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { DelayLine } from './delay-line.js';
import { allocateBlock, blockView, type AudioFrameBlock } from './frame-block.js';

const RATE: SampleRate = expectSuccess(sampleRate(48_000));

/** A 5.1 block whose channel `c` holds `(c + 1) · 1000 + i` at frame `i`. */
function numbered(frames: number): AudioFrameBlock {
  const block = allocateBlock(StandardLayouts.surround5_1, RATE, frames);
  block.channels.forEach((channel, index) => {
    for (let frame = 0; frame < frames; frame += 1) channel[frame] = (index + 1) * 1_000 + frame;
  });
  return block;
}

/** Runs `input` through a fresh delay of `delay` frames, in blocks of the given sizes. */
function delayed(input: AudioFrameBlock, delay: number, sizes: readonly number[]): AudioFrameBlock {
  const line = new DelayLine(input.channels.map(() => delay));
  const output = allocateBlock(input.layout, input.sampleRate, input.frames);
  let start = 0;
  for (let index = 0; start < input.frames; index += 1) {
    const frames = Math.min(sizes[index % sizes.length] ?? 1, input.frames - start);
    line.process(blockView(input, start, frames), blockView(output, start, frames), frames);
    start += frames;
  }
  return output;
}

describe('a delay line', () => {
  it('delays every channel by whole frames, keeping each in its place', () => {
    const output = delayed(numbered(20), 3, [20]);
    output.channels.forEach((channel, index) => {
      expect([...channel.subarray(0, 3)]).toEqual([0, 0, 0]);
      expect(channel[3]).toBe((index + 1) * 1_000);
      expect(channel[19]).toBe((index + 1) * 1_000 + 16);
    });
  });

  it('gives the same bits however the stream is cut into blocks', () => {
    const input = numbered(500);
    const whole = delayed(input, 37, [500]);
    expect(delayed(input, 37, [1])).toEqual(whole);
    expect(delayed(input, 37, [5, 64, 3, 128])).toEqual(whole);
  });

  it('delays each channel by its own length, the same however the stream is cut', () => {
    const input = numbered(300);
    const lengths = [0, 1, 17, 128, 129, 250];
    const run = (sizes: readonly number[]) => {
      const line = new DelayLine(lengths);
      const output = allocateBlock(input.layout, input.sampleRate, input.frames);
      let start = 0;
      for (let index = 0; start < input.frames; index += 1) {
        const frames = Math.min(sizes[index % sizes.length] ?? 1, input.frames - start);
        line.process(blockView(input, start, frames), blockView(output, start, frames), frames);
        start += frames;
      }
      return output;
    };
    const whole = run([300]);
    whole.channels.forEach((channel, index) => {
      const lag = lengths[index] ?? 0;
      for (let frame = 0; frame < 300; frame += 1) {
        expect(channel[frame]).toBe(frame < lag ? 0 : (index + 1) * 1_000 + frame - lag);
      }
    });
    expect(run([1, 64, 3, 128])).toEqual(whole);
  });

  it('passes a block through unchanged at no delay, and may write over its input', () => {
    const input = numbered(8);
    expect(delayed(input, 0, [3])).toEqual(numbered(8));

    const inPlace = numbered(8);
    new DelayLine(inPlace.channels.map(() => 2)).process(inPlace, inPlace, 8);
    expect([...(inPlace.channels[2] ?? [])]).toEqual([
      0, 0, 3_000, 3_001, 3_002, 3_003, 3_004, 3_005,
    ]);
  });
});
