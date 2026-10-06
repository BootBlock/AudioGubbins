/**
 * Signals the repair processors' tests are run over: music-like material
 * whose clean form is known, the same with clicks or a pop added at known
 * frames, and the error of a repaired render against the clean signal.
 */

import { noise } from '@audiogubbins/test-fixtures';

import { TEST_RATE } from './processor-run.js';

/**
 * `length` frames of three partials, 220, 330 and 495 Hz, with a little
 * noise under them: material a short predictor follows, as it does music.
 */
export function partials(length: number, seed = 7): Float32Array {
  const hiss = noise(seed, { length }).channels[0] ?? new Float32Array(length);
  const out = new Float32Array(length);
  for (let frame = 0; frame < length; frame += 1) {
    const t = frame / TEST_RATE;
    out[frame] =
      0.3 * Math.sin(2 * Math.PI * 220 * t) +
      0.15 * Math.sin(2 * Math.PI * 330 * t + 1) +
      0.08 * Math.sin(2 * Math.PI * 495 * t + 2) +
      0.002 * (hiss[frame] ?? 0);
  }
  return out;
}

/** A click: `width` frames from `at`, of `size` at most, its noise seeded by `seed`, else `at`. */
export interface Click {
  readonly at: number;
  readonly width: number;
  readonly size: number;
  readonly seed?: number;
}

/**
 * `clean` with each of `clicks` added: noise seeded by the click's seed or
 * frame, fading to half by its end, broadband and unforeseeable as a scratch's
 * impulse is, so no short predictor follows any of it.
 */
export function withClicks(clean: Float32Array, clicks: readonly Click[]): Float32Array {
  const out = clean.slice();
  for (const { at, width, size, seed } of clicks) {
    const burst =
      noise(seed ?? at, { length: width, amplitude: 1 }).channels[0] ?? new Float32Array(0);
    for (let offset = 0; offset < width; offset += 1) {
      const fade = 1 - offset / (2 * width);
      out[at + offset] = (out[at + offset] ?? 0) + size * (burst[offset] ?? 0) * fade;
    }
  }
  return out;
}

/** The largest difference of `output` from `clean` delayed by `latency`, over `from` to `to`. */
export function worstError(
  output: Float32Array,
  clean: Float32Array,
  latency: number,
  from: number,
  to: number,
): number {
  let worst = 0;
  for (let frame = from; frame < to; frame += 1) {
    const difference = (output[frame + latency] ?? 0) - (clean[frame] ?? 0);
    worst = Math.max(worst, Math.abs(difference));
  }
  return worst;
}

/** The frames of `input` that `output`, `latency` later, does not give bit for bit. */
export function changedFrames(
  output: Float32Array,
  input: Float32Array,
  latency: number,
): number[] {
  const changed: number[] = [];
  for (let frame = 0; frame + latency < output.length; frame += 1) {
    if (!Object.is(output[frame + latency], input[frame])) changed.push(frame);
  }
  return changed;
}

/**
 * A thump: `sin(2π · frequency · t) · e^(−t / decay)` from frame `at`, of
 * `size` at its envelope's start, `decay` in seconds.
 */
export interface Pop {
  readonly at: number;
  readonly frequency: number;
  readonly decay: number;
  readonly size: number;
}

/** `clean` with `pop` added, until it has decayed by 160 dB. */
export function withPop(clean: Float32Array, pop: Pop): Float32Array {
  const out = clean.slice();
  const frames = Math.ceil(18.4 * pop.decay * TEST_RATE);
  for (let offset = 0; offset < frames && pop.at + offset < out.length; offset += 1) {
    const t = offset / TEST_RATE;
    const thump = pop.size * Math.exp(-t / pop.decay) * Math.sin(2 * Math.PI * pop.frequency * t);
    out[pop.at + offset] = (out[pop.at + offset] ?? 0) + thump;
  }
  return out;
}

/** The frames a signal fades in over: 50 ms, so its start is no click or thump. */
const FADE_FRAMES = 2_400;

/** `signal` with its first 50 ms faded in by a raised cosine. */
export function faded(signal: Float32Array): Float32Array {
  const out = signal.slice();
  for (let frame = 0; frame < FADE_FRAMES && frame < out.length; frame += 1) {
    out[frame] = (out[frame] ?? 0) * (0.5 - 0.5 * Math.cos((Math.PI * frame) / FADE_FRAMES));
  }
  return out;
}
