import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  createDeterministicIdGenerator,
  instantiateProcessor,
  mapResult,
  type ChainSlot,
  type EffectChain,
  type ParameterValue,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  REFERENCE_DSP,
  gainToDecibels,
  sineOfTurns,
  type CanonicalDsp,
  type StreamReader,
} from '@audiogubbins/audio-engine';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_RATE, processorValues } from '@audiogubbins/processors/testing';

import { chainProcessing } from './chain-run.js';

const ids = createDeterministicIdGenerator(83);
const TYPES = PROCESSOR_TYPES_BY_KEY;

/** A slot of the type `typeKey` at `values`, fully wet. */
function slot(typeKey: string, values: Readonly<Record<string, ParameterValue>>): ChainSlot {
  const type = TYPES.get(typeKey);
  if (type === undefined) throw new Error(`The catalogue has a ${typeKey} processor.`);
  const made = instantiateProcessor(ids.next(), type.descriptor);
  return { ...made, values: processorValues(type, values) };
}

const LENGTH = 48_000;
/** A 1 kHz sine at a peak of 0.25, a crest on frame 12 of each 48. */
const input = [Float32Array.from({ length: LENGTH }, (_, n) => 0.25 * sineOfTurns((n % 48) / 48))];

/** Reads `input`, as a stream's reader would. */
const readInput: StreamReader = async (start, frames, into) => {
  into[0]?.set(input[0]?.subarray(start, start + frames) ?? []);
  await Promise.resolve();
};

/** The chain of `slots` prepared over `input` by `dsp`, its measurements made. */
function prepare(slots: readonly ChainSlot[], read = readInput, dsp = REFERENCE_DSP) {
  const chain: EffectChain = { id: ids.next(), slots };
  return chainProcessing(TYPES).prepare(
    {
      chain,
      input: StandardLayouts.mono,
      sampleRate: TEST_RATE,
      length: LENGTH,
      quality: MAXIMUM_QUALITY.settings,
      blockFrames: 512,
      dsp,
    },
    read,
  );
}

/** The chain of `slots` prepared over `input`, its measurements made, and run whole. */
async function runChain(slots: readonly ChainSlot[]): Promise<Float32Array> {
  const run = expectSuccess(await prepare(slots));
  const out = [new Float32Array(LENGTH)];
  run.process(input, out, LENGTH);
  run.release();
  return out[0] ?? new Float32Array(0);
}

/** The reference DSP, counting the meters it has made and not yet freed. */
function countingDsp(): { readonly dsp: CanonicalDsp; readonly live: () => number } {
  let live = 0;
  const freed = () => {
    live -= 1;
  };
  const dsp: CanonicalDsp = {
    ...REFERENCE_DSP,
    createPeakMeter: (settings) =>
      mapResult(REFERENCE_DSP.createPeakMeter(settings), (meter) => {
        live += 1;
        return {
          channels: meter.channels,
          push: (chunk) => {
            meter.push(chunk);
          },
          read: (into) => {
            meter.read(into);
          },
          release: () => {
            freed();
            meter.release();
          },
        };
      }),
    createLoudnessMeter: (settings) =>
      mapResult(REFERENCE_DSP.createLoudnessMeter(settings), (meter) => {
        live += 1;
        return {
          channels: meter.channels,
          push: (chunk) => {
            meter.push(chunk);
          },
          pullSeries: (into) => meter.pullSeries(into),
          read: () => meter.read(),
          release: () => {
            freed();
            meter.release();
          },
        };
      }),
  };
  return { dsp, live: () => live };
}

function peakOf(samples: Float32Array): number {
  return gainToDecibels(samples.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0));
}

describe('a whole-pass normalisation in a chain run over a stream (ADR-0060)', () => {
  it('is measured at its own input, after what comes before it, and runs on what was measured', async () => {
    // From a peak of −12 dBFS, raised 6 dB first: the normalisation must hear
    // −6 dBFS to land at its target, and would pass −6 through unmeasured.
    const out = await runChain([
      slot('gain', { gain: 6 }),
      slot('peak-normalisation', { target: -1 }),
    ]);
    expect(Math.abs(peakOf(out) + 1)).toBeLessThan(0.001);
  });

  it('measures each normalisation in signal order, each with those before it measured', async () => {
    // The loudness normalisation must hear the peak normalisation's output,
    // 11 dB above the stream, to land at its target: had its pass run the
    // first unmeasured, passing the stream through, it would land 11 dB high.
    const out = await runChain([
      slot('peak-normalisation', { target: -1 }),
      slot('loudness-normalisation', { target: -20 }),
    ]);
    const meter = expectSuccess(
      REFERENCE_DSP.createLoudnessMeter({ sampleRate: TEST_RATE, layout: StandardLayouts.mono }),
    );
    meter.push([out]);
    const { integrated } = meter.read();
    meter.release();
    expect(Math.abs(integrated + 20)).toBeLessThan(0.1);
  });

  it('frees the meters of every pass, whether it finishes or its read fails part way', async () => {
    const slots = [
      slot('peak-normalisation', { target: -1 }),
      slot('loudness-normalisation', { target: -20 }),
    ];
    const finished = countingDsp();
    expectSuccess(await prepare(slots, readInput, finished.dsp)).release();
    expect(finished.live()).toBe(0);

    // The stream is read in chunks of 16,384 frames, so the second read is
    // part way through the first pass.
    const failing = countingDsp();
    let reads = 0;
    const failingRead: StreamReader = async (start, frames, into, signal) => {
      reads += 1;
      if (reads === 2) throw new Error('The stream could not be read.');
      await readInput(start, frames, into, signal);
    };
    await expect(prepare(slots, failingRead, failing.dsp)).rejects.toThrow(
      'The stream could not be read.',
    );
    expect(reads).toBe(2);
    expect(failing.live()).toBe(0);
  });
});
