/**
 * The rack's measuring pass held to the whole-pass contract: a measurer is
 * awaited for each chunk before the next is read, its failure refuses the
 * chain, a cancellation reaches it while it hears or answers, it is released
 * on every path with the pass's executor, and samples it measures reach the
 * kernel as the very array it made. The processor is made for the test, a
 * whole-pass type whose measurer each test scripts, as a model's will be.
 */

import { describe, expect, it } from 'vitest';

import {
  FailureKind,
  MAXIMUM_QUALITY,
  StandardLayouts,
  cancellationReason,
  createCancellationSource,
  createDeterministicIdGenerator,
  fail,
  failure,
  instantiateProcessor,
  succeed,
  type CancellationSignal,
  type DomainResult,
  type EffectChain,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, type StreamReader } from '@audiogubbins/audio-engine';
import type { Measurement } from '@audiogubbins/processors';
import {
  TEST_RATE,
  scriptedWholePass,
  type PassCounts,
  type PassScript,
} from '@audiogubbins/processors/testing';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(87);

/** The frames a measuring pass reads at a time, as the rack does. */
const PASS_CHUNK = 16_384;

/** Reads silence, a stream's reader that holds nothing worth hearing. */
const readSilence: StreamReader = async () => {
  await Promise.resolve();
};

/** The chain of one scripted processor prepared over `length` frames of mono. */
function prepare(
  script: PassScript,
  length: number,
  read: StreamReader = readSilence,
  signal?: CancellationSignal,
) {
  const counts: PassCounts = { released: 0, live: 0, measured: [] };
  const type = scriptedWholePass(script, counts);
  const chain: EffectChain = {
    id: ids.next(),
    slots: [instantiateProcessor(ids.next(), type.descriptor)],
  };
  const prepared = chainProcessing(new Map([[type.descriptor.typeKey, type]])).prepare(
    {
      chain,
      input: StandardLayouts.mono,
      sampleRate: TEST_RATE,
      length,
      quality: MAXIMUM_QUALITY.settings,
      blockFrames: 512,
      dsp: REFERENCE_DSP,
    },
    read,
    signal,
  );
  return { prepared, counts };
}

/** A promise that settles only when `signal` is cancelled, failing with its reason. */
function untilCancelled(signal: CancellationSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(cancellationReason(signal));
      },
      { once: true },
    );
  });
}

const NOTHING_MEASURED = (): Promise<DomainResult<Measurement>> => Promise.resolve(succeed([]));

describe('a whole pass in a chain run over a stream (ADR-0060, ADR-0062)', () => {
  it('refuses the chain with the reason a measurement fails, and releases the pass', async () => {
    const { prepared, counts } = prepare(
      {
        result: () =>
          Promise.resolve(
            fail(
              failure('inference.refused', FailureKind.Rejected, 'The model refused the audio.'),
            ),
          ),
      },
      1_000,
    );
    const answer = await prepared;
    expect(expectFailureCode(answer)).toBe('inference.refused');
    expect(answer.ok ? undefined : answer.failures[0].summary).toBe('The model refused the audio.');
    expect(counts.released).toBe(1);
    expect(counts.live).toBe(0);
  });

  it('reads no chunk until the measurer has heard the one before', async () => {
    let heard = 0;
    const heardAtEachRead: number[] = [];
    const read: StreamReader = async () => {
      heardAtEachRead.push(heard);
      await Promise.resolve();
    };
    const { prepared, counts } = prepare(
      {
        // Each chunk is heard a macrotask later, as a worker's answer comes.
        add: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              heard += 1;
              resolve();
            }, 1);
          }),
        result: NOTHING_MEASURED,
      },
      3 * PASS_CHUNK + 100,
      read,
    );
    expectSuccess(await prepared).release();
    expect(heardAtEachRead).toEqual([0, 1, 2, 3]);
    expect(heard).toBe(4);
    expect(counts.released).toBe(1);
  });

  it('ends the pass with a cancellation that comes while the measurer hears, and releases', async () => {
    const source = createCancellationSource();
    const { prepared, counts } = prepare(
      {
        add: (signal) => {
          if (signal === undefined) return Promise.resolve();
          queueMicrotask(() => {
            source.cancel(new Error('The person stopped the render.'));
          });
          return untilCancelled(signal);
        },
        result: NOTHING_MEASURED,
      },
      1_000,
      readSilence,
      source.signal,
    );
    await expect(prepared).rejects.toThrow('The person stopped the render.');
    expect(counts.released).toBe(1);
    expect(counts.live).toBe(0);
  });

  it('ends the pass with a cancellation that comes while the measurer answers, and releases', async () => {
    const source = createCancellationSource();
    const { prepared, counts } = prepare(
      {
        result: (signal) => {
          if (signal === undefined) return NOTHING_MEASURED();
          queueMicrotask(() => {
            source.cancel(new Error('The person stopped the render.'));
          });
          return untilCancelled(signal);
        },
      },
      1_000,
      readSilence,
      source.signal,
    );
    await expect(prepared).rejects.toThrow('The person stopped the render.');
    expect(counts.released).toBe(1);
    expect(counts.live).toBe(0);
  });

  it('gives the kernel the very samples the measurer made, not a copy', async () => {
    const samples = Float32Array.from({ length: 1_000 }, (_, frame) => frame / 1_000);
    const { prepared, counts } = prepare(
      { result: () => Promise.resolve(succeed(samples)) },
      1_000,
    );
    const run = expectSuccess(await prepared);
    // The measuring pass runs the kernel unmeasured; the chain runs it measured.
    expect(counts.measured).toHaveLength(2);
    expect(counts.measured[0]).toBeUndefined();
    expect(counts.measured[1]).toBe(samples);
    run.release();
    expect(counts.live).toBe(0);
  });
});
