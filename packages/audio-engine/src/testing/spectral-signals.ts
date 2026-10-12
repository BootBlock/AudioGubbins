/**
 * Signals and edits for the tests of a spectral edit's realisation: seeded
 * noise, tones at a stated level, a mask of one rectangle, and the content
 * that realises an edit over samples held in memory.
 */

import {
  MAXIMUM_QUALITY,
  MaskEffect,
  StandardLayouts,
  derivedSampleCount,
  sampleRate,
  type PlannedSpectralEdit,
  type PlannedSpectralOperation,
  type QualitySettings,
  type SpectralFeather,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import { REFERENCE_DSP } from '../dsp/reference/reference-dsp.js';
import { sineOfTurns } from '../dsp/reference/primitives.js';
import { SpectralContent, type WetRun } from '../pcm/spectral-content.js';

export const SPECTRAL_RATE = expectSuccess(sampleRate(48_000));

/** `frames` frames of seeded noise in `[−0.5, 0.5)`. */
export function noise(seed: number, frames: number): Float32Array {
  let state = seed >>> 0 || 1;
  return Float32Array.from({ length: frames }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return Math.fround(state / 4_294_967_296 - 0.5);
  });
}

/** The sum of tones, each `[hertz, amplitude]`, `frames` frames long. */
export function tones(
  frames: number,
  ...parts: readonly (readonly [number, number])[]
): Float32Array {
  return Float32Array.from({ length: frames }, (_, n) => {
    let sum = 0;
    for (const [hertz, amplitude] of parts)
      sum += amplitude * sineOfTurns((n * hertz) / SPECTRAL_RATE);
    return Math.fround(sum);
  });
}

/** The amplitude of the tone at `hertz` in `samples[from, to)`, by projection on its sine and cosine. */
export function amplitudeAt(
  samples: Float32Array,
  hertz: number,
  from: number,
  to: number,
): number {
  let sine = 0;
  let cosine = 0;
  for (let n = from; n < to; n += 1) {
    const turns = (n * hertz) / SPECTRAL_RATE;
    sine += (samples[n] ?? 0) * sineOfTurns(turns);
    cosine += (samples[n] ?? 0) * sineOfTurns(turns + 0.25);
  }
  return (2 * Math.sqrt(sine * sine + cosine * cosine)) / (to - from);
}

/** A spectral edit of one rectangle over `[start, end)` and `[low, high]` hertz. */
export function rectangleEdit(
  operation: PlannedSpectralOperation,
  range: { readonly start: number; readonly end: number },
  band: { readonly low: number; readonly high: number },
  options: {
    readonly resolution?: number;
    readonly feather?: SpectralFeather;
    readonly channels?: readonly number[];
  } = {},
): PlannedSpectralEdit {
  return {
    mask: {
      shapes: [
        {
          kind: 'rectangle',
          effect: MaskEffect.Add,
          range: { start: derivedSampleCount(range.start), end: derivedSampleCount(range.end) },
          band,
        },
      ],
      feather: options.feather ?? { time: 0, frequency: 0 },
    },
    resolution: options.resolution ?? 1_024,
    operation,
    ...(options.channels === undefined ? {} : { channels: options.channels }),
  };
}

/** The content realising `edit` over `channels`, and the starts of the reads it made of them. */
export function spectralOver(
  channels: readonly Float32Array[],
  edit: PlannedSpectralEdit,
  options: {
    readonly quality?: QualitySettings;
    readonly dsp?: CanonicalDsp;
    readonly wet?: WetRun;
  } = {},
): { readonly content: SpectralContent; readonly reads: number[] } {
  const length = channels[0]?.length ?? 0;
  const reads: number[] = [];
  const layout = channels.length === 1 ? StandardLayouts.mono : StandardLayouts.stereo;
  const content = new SpectralContent(
    {
      read: (start, frames, into) => {
        reads.push(start);
        channels.forEach((channel, index) =>
          into[index]?.set(channel.subarray(start, start + frames)),
        );
        return Promise.resolve();
      },
    },
    { sampleRate: SPECTRAL_RATE, layout },
    length,
    edit,
    { quality: options.quality ?? MAXIMUM_QUALITY.settings, dsp: options.dsp ?? REFERENCE_DSP },
    options.wet,
  );
  return { content, reads };
}

/** Reads all of `content` in reads of `chunk` frames from `from`. */
export async function readAllOf(
  content: SpectralContent,
  chunk: number,
  from = 0,
): Promise<Float32Array[]> {
  const out = Array.from(
    { length: content.channels },
    () => new Float32Array(content.length - from),
  );
  for (let start = from; start < content.length; start += chunk) {
    const frames = Math.min(chunk, content.length - start);
    await content.read(
      start,
      frames,
      out.map((channel) => channel.subarray(start - from, start - from + frames)),
    );
  }
  return out;
}
