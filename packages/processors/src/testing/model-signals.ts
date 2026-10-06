/**
 * The signals the speech models' tests run: a mixture of tones for the runs
 * over stand-in graphs, and a voiced signal in noise for the golden renders.
 * Each is the canonical sine and basic arithmetic alone, so it is the same
 * bits on every machine.
 */

import { sineOfTurns } from '@audiogubbins/audio-engine';

/** `length` frames of each of `channels` channels, each a different mixture of tones. */
export function toneMixture(length: number, channels: number): Float32Array[] {
  return Array.from({ length: channels }, (_, channel) =>
    Float32Array.from(
      { length },
      (_, frame) =>
        0.4 * sineOfTurns((frame * (3 + channel)) / 997) +
        0.2 * sineOfTurns((frame * (41 + 7 * channel)) / 1_009),
    ),
  );
}

/**
 * `seconds` of a voiced harmonic signal in noise, at 48 kHz: a glottal
 * series of twenty harmonics whose pitch glides between 100 and 160 Hz,
 * gated into syllables, under white noise 15 dB below it, from a linear
 * congruential generator.
 */
export function voicedInNoise(seconds: number): Float32Array {
  const frames = seconds * 48_000;
  const signal = new Float32Array(frames);
  let phase = 0;
  let seed = 1;
  for (let frame = 0; frame < frames; frame += 1) {
    const pitch = 130 + 30 * sineOfTurns(frame / 48_000 / 1.7);
    phase = (phase + pitch / 48_000) % 1;
    let voice = 0;
    for (let harmonic = 1; harmonic <= 20; harmonic += 1) {
      voice += sineOfTurns((phase * harmonic) % 1) / harmonic;
    }
    const syllable = Math.max(0, sineOfTurns(frame / 48_000 / 0.45));
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const noise = seed / 2_147_483_648 - 0.5;
    signal[frame] = 0.12 * voice * syllable + 0.08 * noise;
  }
  return signal;
}
