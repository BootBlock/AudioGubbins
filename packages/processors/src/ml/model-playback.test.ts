import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { expectFailureCode } from '@audiogubbins/domain/testing';

import { processorKernelOf, runProcessor } from '../testing/processor-run.js';
import { FakeModels, MemoryModelLibrary } from '../testing/model-services.js';
import { deepFilterNet3 } from './deepfilternet/deepfilternet.js';

const TYPE = deepFilterNet3({
  inference: new FakeModels(new Map()),
  models: new MemoryModelLibrary([]),
});
const STEREO = StandardLayouts.stereo;

/** A planar measurement of `frames` frames on each of two channels, each sample distinct. */
function planar(frames: number): Float32Array {
  return Float32Array.from({ length: 2 * frames }, (_, index) => Math.fround(index / 1_000 - 0.5));
}

describe("a machine-learning processor's kernel", () => {
  it('plays its measurement back exactly, frame for frame, however it is given blocks', () => {
    const frames = 5_000;
    const measured = planar(frames);
    const input = [new Float32Array(frames).fill(0.25), new Float32Array(frames).fill(-0.25)];
    for (const blocks of [[128], [1, 4_096, 17], [5_000]]) {
      expect(runProcessor(TYPE, { layout: STEREO, measured }, input, blocks)).toEqual([
        measured.subarray(0, frames),
        measured.subarray(frames),
      ]);
    }
  });

  it('plays from the frame its run starts at, and silence before the stream begins', () => {
    const frames = 1_000;
    const measured = planar(frames);
    const input = [new Float32Array(600), new Float32Array(600)];
    // A preview started at frame 300 hears what a run from frame 0 hears there.
    expect(runProcessor(TYPE, { layout: STEREO, measured, start: 300 }, input, [128])).toEqual([
      measured.subarray(300, 900),
      measured.subarray(frames + 300, frames + 900),
    ]);
    // A path 40 frames late reaches the kernel before the stream's first frame.
    const late = { layout: STEREO, measured, inputArrival: 40 };
    const [left] = runProcessor(TYPE, late, input, [17]);
    expect(left?.subarray(0, 40).every((sample) => sample === 0)).toBe(true);
    expect(left?.subarray(40)).toEqual(measured.subarray(0, 560));
  });

  it('writes silence past the end of what its pass made', () => {
    const measured = planar(100);
    const input = [new Float32Array(300).fill(1), new Float32Array(300).fill(1)];
    const [left, right] = runProcessor(TYPE, { layout: STEREO, measured }, input, [64]);
    expect(left?.subarray(100).every((sample) => sample === 0)).toBe(true);
    expect(right?.subarray(0, 100)).toEqual(measured.subarray(100));
    expect(right?.subarray(100).every((sample) => sample === 0)).toBe(true);
  });

  it('passes its input on, made finite, before its pass is made', () => {
    const input = [Float32Array.of(0.5, Number.NaN, -0.5), Float32Array.of(Infinity, 0.25, 0)];
    expect(runProcessor(TYPE, { layout: STEREO }, input)).toEqual([
      Float32Array.of(0.5, 0, -0.5),
      Float32Array.of(0, 0.25, 0),
    ]);
  });

  it("refuses another processor's measurement, and samples that are not whole frames", () => {
    expect(expectFailureCode(processorKernelOf(TYPE, { layout: STEREO, measured: [1, 2] }))).toBe(
      'processor.measurement-kind',
    );
    expect(
      expectFailureCode(processorKernelOf(TYPE, { layout: STEREO, measured: new Float32Array(3) })),
    ).toBe('processor.measurement-shape');
  });

  it('refuses a parameter change while it plays, which only a new pass could hear', () => {
    const kernel = processorKernelOf(TYPE, { layout: STEREO, measured: planar(10) });
    expect(kernel.ok && expectFailureCode(kernel.value.setParameter('attenuation-limit', 6))).toBe(
      'processor.parameter-needs-pass',
    );
  });
});
