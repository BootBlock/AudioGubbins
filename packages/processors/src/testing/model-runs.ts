/**
 * Running a machine-learning processor's whole pass for its tests, as the
 * rack does: its measurer made from the node the rack would make, the input
 * given in chunks of the sizes a test names, each awaited before the next.
 */

import type { CancellationSignal, DomainResult } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import { REFERENCE_DSP } from '@audiogubbins/audio-engine';

import type { ProcessorType } from '../framework/processor-type.js';
import type { Measurement, Measurer } from '../framework/whole-pass.js';
import { TEST_BLOCK_FRAMES, TEST_RATE, processorStep, type RunSettings } from './processor-run.js';

/** The measurer of `type` for `settings`, as the rack makes it. */
export function modelPassOf(type: ProcessorType, settings: RunSettings): Measurer {
  if (type.measurer === undefined) throw new Error('A whole-pass processor has a measurer.');
  return expectSuccess(
    type.measurer(processorStep(type, settings).settings, settings.layout, {
      sampleRate: settings.sampleRate ?? TEST_RATE,
      blockFrames: TEST_BLOCK_FRAMES,
      dsp: settings.dsp ?? REFERENCE_DSP,
    }),
  );
}

/**
 * What `pass` answers for `input`, given in chunks whose sizes cycle through
 * `chunks`; the pass is released either way.
 */
export async function passOver(
  pass: Measurer,
  input: readonly Float32Array[],
  chunks: readonly number[] = [4_096],
  signal?: CancellationSignal,
): Promise<DomainResult<Measurement>> {
  try {
    const length = input[0]?.length ?? 0;
    for (let start = 0, turn = 0; start < length; turn += 1) {
      const frames = Math.min(chunks[turn % chunks.length] ?? 4_096, length - start);
      await pass.add(
        input.map((channel) => channel.subarray(start, start + frames)),
        frames,
        signal,
      );
      start += frames;
    }
    return await pass.result(signal);
  } finally {
    pass.release();
  }
}

/** The channels of a planar measurement of `channels` channels. */
export function planarChannels(measured: Measurement, channels: number): Float32Array[] {
  if (!(measured instanceof Float32Array)) throw new Error('A model pass makes samples.');
  const frames = measured.length / channels;
  return Array.from({ length: channels }, (_, channel) =>
    measured.slice(channel * frames, (channel + 1) * frames),
  );
}
