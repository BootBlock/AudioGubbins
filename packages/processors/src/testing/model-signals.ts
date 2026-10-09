/**
 * The signals the models' tests run: a mixture of tones for the runs over
 * stand-in graphs, a voiced signal in noise for the speech models' golden
 * renders, and a mix of voice, bass, drums and chords for the separators'.
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

/** A burst's envelope `since` seconds in, gone after `length`: `(1 − t/length)⁴`. */
function decay(since: number, length: number): number {
  const left = Math.max(0, 1 - since / length);
  return left * left * left * left;
}

/**
 * A stereo mix of `frames` frames at `rate`: a voice of twenty harmonics
 * gliding between 180 and 260 Hz, gated into syllables, in the centre; a bass
 * of three harmonics stepping through four notes, a little left; a kick and a
 * hi-hat on each beat at 120 beats a minute, decaying bursts of a low tone and
 * of noise from a linear congruential generator, a little right; and a chord of
 * three tones held under them, wide. The canonical sine and basic arithmetic
 * throughout, never `Math.exp`, whose last bit an engine may choose, so the
 * input is the same bits everywhere.
 */
export function separationMix(frames: number, rate: number): [Float32Array, Float32Array] {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const bassNotes = [55, 73.42, 65.41, 82.41];
  let voicePhase = 0;
  let seed = 3;
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / rate;
    const pitch = 220 + 40 * sineOfTurns((time / 2.3) % 1);
    voicePhase = (voicePhase + pitch / rate) % 1;
    let voice = 0;
    for (let harmonic = 1; harmonic <= 20; harmonic += 1) {
      voice += sineOfTurns((voicePhase * harmonic) % 1) / harmonic;
    }
    voice *= Math.max(0, sineOfTurns((time / 0.6) % 1));
    const note = bassNotes[Math.floor(time / 2) % bassNotes.length] ?? 55;
    let bass = 0;
    for (let harmonic = 1; harmonic <= 3; harmonic += 1) {
      bass += sineOfTurns((time * note * harmonic) % 1) / harmonic;
    }
    const sinceBeat = time % 0.5;
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const noise = seed / 2_147_483_648 - 0.5;
    const kick = sineOfTurns((sinceBeat * 60) % 1) * decay(sinceBeat, 0.3);
    const hat = noise * decay(time % 0.25, 0.08);
    const chord = [261.63, 329.63, 392].map((tone) => sineOfTurns((time * tone) % 1));
    const drums = 0.5 * kick + 0.3 * hat;
    const centre = 0.12 * voice;
    left[frame] = centre + 0.25 * bass + 0.4 * drums + 0.06 * ((chord[0] ?? 0) + (chord[1] ?? 0));
    right[frame] = centre + 0.15 * bass + 0.6 * drums + 0.06 * ((chord[1] ?? 0) + (chord[2] ?? 0));
  }
  return [left, right];
}
