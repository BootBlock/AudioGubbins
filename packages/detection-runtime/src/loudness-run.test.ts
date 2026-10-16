import { describe, expect, it } from 'vitest';

import {
  REFERENCE_DSP,
  gainToDecibels,
  memorySource,
  sineOfTurns,
  type CanonicalDsp,
  type PcmSource,
} from '@audiogubbins/audio-engine';
import {
  Cancelled,
  StandardLayouts,
  createCancellationSource,
  derivedSampleCount,
  mapResult,
  type ChannelLayout,
  type EditRange,
} from '@audiogubbins/domain';
import { expectFailureCode, expectSuccess } from '@audiogubbins/domain/testing';
import { PROCESSOR_TYPES_BY_KEY } from '@audiogubbins/processors';
import { TEST_BLOCK_FRAMES, TEST_RATE, processorStep } from '@audiogubbins/processors/testing';

import { measureLoudness, type LoudnessTools } from './loudness-run.js';

/** Seconds at the test rate, in frames. */
const seconds = (count: number): number => Math.round(count * TEST_RATE);

/**
 * A sine of `hertz` at `amplitude`, starting an eighth of a turn in: at a
 * quarter of the rate its every frame falls 45° from a peak, so its true peak
 * stands 3 dB above its sample peak.
 */
function sine(frames: number, hertz: number, amplitude: number): Float32Array {
  return Float32Array.from(
    { length: frames },
    (_, n) => amplitude * sineOfTurns(0.125 + ((hertz * n) % TEST_RATE) / TEST_RATE),
  );
}

function sourceOf(channels: readonly Float32Array[], layout: ChannelLayout): PcmSource {
  return expectSuccess(
    memorySource({
      layout,
      sampleRate: TEST_RATE,
      frames: channels[0]?.length ?? 0,
      channels,
    }),
  );
}

function range(start: number, end: number): EditRange {
  return { start: derivedSampleCount(start), end: derivedSampleCount(end) };
}

function tools(changes: Partial<LoudnessTools> = {}): LoudnessTools {
  return {
    dsp: REFERENCE_DSP,
    signal: createCancellationSource().signal,
    yieldToHost: () => Promise.resolve(),
    onProgress: () => undefined,
    ...changes,
  };
}

/** What loudness normalisation's whole pass measures of `channels`: its gate, loudness and linear true peak. */
async function normalisationMeasure(
  channels: readonly Float32Array[],
  layout: ChannelLayout,
): Promise<readonly number[]> {
  const type = PROCESSOR_TYPES_BY_KEY.get('loudness-normalisation');
  if (type?.measurer === undefined) throw new Error('Loudness normalisation measures its input.');
  const measurer = expectSuccess(
    type.measurer(processorStep(type, { layout }).settings, layout, {
      sampleRate: TEST_RATE,
      blockFrames: TEST_BLOCK_FRAMES,
      dsp: REFERENCE_DSP,
    }),
  );
  try {
    await measurer.add(channels, channels[0]?.length ?? 0);
    const measured = expectSuccess(await measurer.result());
    if (measured instanceof Float32Array) throw new Error('A normalisation measures numbers.');
    // After the header of rate and channels: gated, integrated loudness, true peak.
    return measured.slice(2);
  } finally {
    measurer.release();
  }
}

/** The reference DSP, counting the meters it makes that are still unfreed. */
function countingDsp(): { readonly dsp: CanonicalDsp; readonly live: () => number } {
  let live = 0;
  const counted = <T extends { release(): void }>(meter: T): T => {
    live += 1;
    const release = meter.release.bind(meter);
    meter.release = () => {
      live -= 1;
      release();
    };
    return meter;
  };
  return {
    dsp: {
      ...REFERENCE_DSP,
      createLoudnessMeter: (settings) =>
        mapResult(REFERENCE_DSP.createLoudnessMeter(settings), counted),
      createPeakMeter: (settings) => mapResult(REFERENCE_DSP.createPeakMeter(settings), counted),
    },
    live: () => live,
  };
}

describe('a loudness measurement', () => {
  it('reads what loudness normalisation measures: the same integrated loudness and true peak', async () => {
    const frames = seconds(3);
    const channels = [sine(frames, 12_000, 0.5), sine(frames, 997, 0.25)];
    const layout = StandardLayouts.stereo;
    const measured = expectSuccess(
      await measureLoudness(sourceOf(channels, layout), range(0, frames), tools()),
    );
    const [gated, integrated, truePeak] = await normalisationMeasure(channels, layout);

    expect(gated).toBe(1);
    expect(measured.frames).toBe(frames);
    expect(measured.integratedLufs).toBe(integrated);
    expect(measured.truePeakDbtp).toBeCloseTo(gainToDecibels(truePeak ?? 0), 9);
    // The tone at a quarter of the rate peaks between its frames.
    expect(measured.truePeakDbtp).toBeGreaterThan(gainToDecibels(0.5 * Math.SQRT1_2) + 2);
  });

  it('reads the loudness range of a level that steps by 10 dB', async () => {
    const half = seconds(10);
    const quiet = sine(half, 997, 0.1);
    const loud = sine(half, 997, 0.1 * 10 ** 0.5);
    const signal = new Float32Array(2 * half);
    signal.set(quiet, 0);
    signal.set(loud, half);
    const measured = expectSuccess(
      await measureLoudness(sourceOf([signal], StandardLayouts.mono), range(0, 2 * half), tools()),
    );

    expect(measured.rangeLu).toBeGreaterThan(8);
    expect(measured.rangeLu).toBeLessThanOrEqual(10.5);
  });

  it('measures only the range asked for', async () => {
    const half = seconds(2);
    const signal = new Float32Array(2 * half);
    signal.set(sine(half, 997, 0.5), 0);
    const measured = expectSuccess(
      await measureLoudness(
        sourceOf([signal], StandardLayouts.mono),
        range(half, 2 * half),
        tools(),
      ),
    );

    expect(measured).toEqual({
      frames: half,
      integratedLufs: undefined,
      rangeLu: 0,
      truePeakDbtp: undefined,
    });
  });

  it('reports its progress in frames read, up to the range’s', async () => {
    const frames = seconds(2);
    const progress: number[] = [];
    await measureLoudness(
      sourceOf([sine(frames, 997, 0.5)], StandardLayouts.mono),
      range(0, frames),
      tools({
        onProgress: (read, total) => {
          expect(total).toBe(frames);
          progress.push(read);
        },
      }),
    );

    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(frames);
  });

  it('refuses audio that is not finite, naming where, and frees its meters', async () => {
    const frames = seconds(2);
    const signal = sine(frames, 997, 0.5);
    signal[70_000] = Number.NaN;
    const { dsp, live } = countingDsp();
    const measured = await measureLoudness(
      sourceOf([signal], StandardLayouts.mono),
      range(0, frames),
      tools({ dsp }),
    );

    expect(measured.ok ? undefined : measured.failures[0]).toMatchObject({
      code: 'loudness.non-finite-audio',
      details: { frame: 70_000, channel: 0 },
    });
    expect(live()).toBe(0);
  });

  it('refuses a range that holds no audio or runs past its end', async () => {
    const source = sourceOf([sine(1_000, 997, 0.5)], StandardLayouts.mono);

    expect(expectFailureCode(await measureLoudness(source, range(500, 500), tools()))).toBe(
      'detection.range-empty',
    );
    expect(expectFailureCode(await measureLoudness(source, range(0, 1_001), tools()))).toBe(
      'detection.range-outside',
    );
  });

  it('throws a cancellation as the signal’s reason, its meters freed', async () => {
    const frames = seconds(4);
    const cancellation = createCancellationSource();
    const reason = new Cancelled('Stopped.');
    const { dsp, live } = countingDsp();
    const measuring = measureLoudness(
      sourceOf([sine(frames, 997, 0.5)], StandardLayouts.mono),
      range(0, frames),
      tools({
        dsp,
        yieldToHost: () => {
          cancellation.cancel(reason);
          return Promise.resolve();
        },
        signal: cancellation.signal,
      }),
    );

    await expect(measuring).rejects.toBe(reason);
    expect(live()).toBe(0);
  });
});
