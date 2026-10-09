/**
 * Measuring and running a whole-pass processor for its tests, as the rack
 * does: its measurer made from the node the rack would make, given the input
 * in chunks, and its kernel given what it measured; and the canonical meters'
 * readings of what came out, by which the tests judge it.
 */

import { channelCount, type ChannelLayout } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP, gainToDecibels } from '@audiogubbins/audio-engine';

import type { ProcessorType } from '../framework/processor-type.js';
import {
  TEST_BLOCK_FRAMES,
  TEST_RATE,
  processorStep,
  runProcessor,
  type RunSettings,
} from './processor-run.js';

/**
 * What `type`'s whole pass measures of `input`, given to it in chunks of
 * `chunk` frames: a list of numbers, as every canonical measurer makes.
 */
export async function measureOf(
  type: ProcessorType,
  settings: RunSettings,
  input: readonly Float32Array[],
  chunk = 1_000,
): Promise<readonly number[]> {
  if (type.measurer === undefined) throw new Error('A whole-pass processor has a measurer.');
  const made = expectSuccess(
    type.measurer(processorStep(type, settings).settings, settings.layout, {
      sampleRate: settings.sampleRate ?? TEST_RATE,
      blockFrames: TEST_BLOCK_FRAMES,
      dsp: settings.dsp ?? REFERENCE_DSP,
    }),
  );
  try {
    const length = input[0]?.length ?? 0;
    for (let start = 0; start < length; start += chunk) {
      const frames = Math.min(chunk, length - start);
      await made.add(
        input.map((channel) => channel.subarray(start, start + frames)),
        frames,
      );
    }
    const measured = expectSuccess(await made.result());
    if (measured instanceof Float32Array) throw new Error('A normalisation measures numbers.');
    return measured;
  } finally {
    made.release();
  }
}

/** The output of `type` for `input` once its whole pass has measured it, and the measurement. */
export async function normalised(
  type: ProcessorType,
  settings: RunSettings,
  input: readonly Float32Array[],
): Promise<{ readonly output: Float32Array[]; readonly measured: readonly number[] }> {
  const measured = await measureOf(type, settings, input);
  return { output: runProcessor(type, { ...settings, measured }, input), measured };
}

/** The canonical peak meter's linked sample peak in dBFS and true peak in dBTP of `channels`. */
export function peaksOf(channels: readonly Float32Array[]): {
  readonly samplePeak: number;
  readonly truePeak: number;
} {
  const meter = expectSuccess(
    REFERENCE_DSP.createPeakMeter({ channels: channels.length, sampleRate: TEST_RATE }),
  );
  meter.push(channels);
  const reading = new Float64Array(4 * channels.length);
  meter.read(reading);
  meter.release();
  let samplePeak = 0;
  let truePeak = 0;
  for (let channel = 0; channel < channels.length; channel += 1) {
    samplePeak = Math.max(samplePeak, reading[4 * channel] ?? 0);
    truePeak = Math.max(truePeak, reading[4 * channel + 2] ?? 0);
  }
  return { samplePeak: gainToDecibels(samplePeak), truePeak: gainToDecibels(truePeak) };
}

/** The canonical loudness meter's integrated loudness of `channels`, in LUFS. */
export function integratedOf(layout: ChannelLayout, channels: readonly Float32Array[]): number {
  if (channels.length !== channelCount(layout)) throw new Error('One array a channel.');
  const meter = expectSuccess(REFERENCE_DSP.createLoudnessMeter({ sampleRate: TEST_RATE, layout }));
  meter.push(channels);
  const { integrated } = meter.read();
  meter.release();
  return integrated;
}

/**
 * The first channel and frame at which `left` and `right` differ, or nothing
 * where every sample is the same: a failure names one place, where a diff of
 * two seconds of audio would take minutes to print.
 */
export function firstDifference(
  left: readonly Float32Array[],
  right: readonly Float32Array[],
): string | undefined {
  if (left.length !== right.length) return 'the channel count';
  for (const [channel, samples] of left.entries()) {
    const other = right[channel];
    if (other?.length !== samples.length) return `the length of channel ${String(channel)}`;
    const frame = samples.findIndex((sample, at) => !Object.is(sample, other[at]));
    if (frame >= 0) return `channel ${String(channel)}, frame ${String(frame)}`;
  }
  return undefined;
}
