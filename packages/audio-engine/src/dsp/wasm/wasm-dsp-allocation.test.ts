/**
 * The WebAssembly path allocates nothing per call once it is warm.
 *
 * An oscillator renders on the audio thread, where a collection pauses the
 * quantum that triggered it, so a view of the module's memory made per call,
 * an argument array per call into the module, or a closure per push is a
 * pause waiting to happen. Views are made again only when the memory's
 * buffer or the module buffer they look at changes.
 *
 * How it is measured, and why: each new object is bump-allocated in V8's
 * young generation, so the bytes in use there, read before and after a run of
 * quanta, differ by what the run allocated, as long as no collection ran
 * between the reads; `GCProfiler` says whether one did, and such a trial is
 * dropped. An empty run's reading is the baseline. A run is warmed first, and
 * warming and measuring repeat until a round finds nothing, because the
 * optimiser can finish late on a busy machine; an allocation in the code
 * itself is in every round, and still fails. `kernel-allocation.test.ts`
 * measures the node kernels the same way and gives the reasons other
 * measures were refused.
 */

import { GCProfiler, getHeapSpaceStatistics } from 'node:v8';
import { beforeAll, describe, expect, it } from 'vitest';

import { sampleRate } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { dspModuleExports } from '../../testing/dsp-module.js';
import { ResamplingQuality, type CanonicalDsp } from '../canonical-dsp.js';
import { wasmDsp } from './wasm-dsp.js';

/** The frames of one render quantum. */
const FRAMES = 128;

/** Quanta in one measured trial: a path allocating even 8 bytes a quantum shows 8 KiB. */
const QUANTA = 1024;

/** Quanta run before measuring, so each path is compiled and settled first. */
const WARM_QUANTA = 4096;

/** Trials measured, of which the least is taken, and those a collection interrupted dropped. */
const TRIALS = 8;

/** The most rounds of warming and measuring before a run's allocation is taken as its own. */
const ROUNDS = 16;

/** The spaces of V8's young generation, where every small new object is placed. */
const YOUNG_SPACES: ReadonlySet<string> = new Set(['new_space', 'new_large_object_space']);

function youngBytes(): number {
  let bytes = 0;
  for (const space of getHeapSpaceStatistics()) {
    if (YOUNG_SPACES.has(space.space_name)) bytes += space.space_used_size;
  }
  return bytes;
}

/**
 * The fewest bytes one trial of `QUANTA` calls of `quantum` allocated, over
 * the trials no collection interrupted, or `undefined` when a collection
 * interrupted every one, which only allocating can cause.
 */
function leastAllocated(quantum: () => void): number | undefined {
  let least: number | undefined;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const profiler = new GCProfiler();
    profiler.start();
    const before = youngBytes();
    for (let count = 0; count < QUANTA; count += 1) quantum();
    const after = youngBytes();
    const collections = profiler.stop().statistics.length;
    if (collections === 0 && (least === undefined || after - before < least)) {
      least = after - before;
    }
  }
  return least;
}

/** The fewest bytes a run allocated beyond an empty run's, warmed first, over rounds. */
function allocatedBy(quantum: () => void): number {
  let least = Number.POSITIVE_INFINITY;
  for (let round = 0; round < ROUNDS && least >= QUANTA; round += 1) {
    for (let count = 0; count < WARM_QUANTA; count += 1) quantum();
    const baseline = leastAllocated(() => undefined);
    const measured = leastAllocated(quantum);
    if (baseline === undefined) throw new Error('A collection interrupted every empty trial.');
    if (measured !== undefined) least = Math.min(least, measured - baseline);
  }
  return least;
}

let wasm: CanonicalDsp;

beforeAll(async () => {
  wasm = expectSuccess(wasmDsp(await dspModuleExports()));
});

describe('the WebAssembly path allocates nothing per call', () => {
  it('measures an allocation of a few bytes a quantum', () => {
    // The measure is only worth its passes if it can fail.
    let kept: number[] = [];
    const allocated = allocatedBy(() => {
      kept = [kept.length];
    });
    expect(kept).toHaveLength(1);
    expect(allocated).toBeGreaterThanOrEqual(QUANTA * 16);
  });

  it('rendering an oscillator', () => {
    const oscillator = expectSuccess(
      wasm.createOscillator({
        frequency: 997,
        sampleRate: expectSuccess(sampleRate(48_000)),
        startPhase: 0,
        amplitude: 0.5,
      }),
    );
    const into = new Float32Array(FRAMES);

    const allocated = allocatedBy(() => {
      oscillator.render(into);
    });

    oscillator.release();
    expect(allocated).toBeLessThan(QUANTA);
  });

  it('pushing to and pulling from a resampler', () => {
    const resampler = expectSuccess(
      wasm.createResampler({
        from: expectSuccess(sampleRate(48_000)),
        to: expectSuccess(sampleRate(48_000)),
        channels: 2,
        quality: ResamplingQuality.Draft,
      }),
    );
    const input = [new Float32Array(FRAMES).fill(0.25), new Float32Array(FRAMES).fill(-0.25)];
    const output = [new Float32Array(FRAMES), new Float32Array(FRAMES)];

    // Equal rates pass each quantum through whole, so the stream holds no
    // more between quanta and the module's memory settles.
    const allocated = allocatedBy(() => {
      resampler.push(input);
      resampler.pull(output);
    });

    resampler.release();
    expect(output[1]?.[0]).toBe(-0.25);
    expect(allocated).toBeLessThan(QUANTA);
  });
});
