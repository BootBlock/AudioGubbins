/**
 * Spleeter's pinned golden renders (`testing/golden-render.ts`), two stems
 * and four, over a mix made here.
 */

import { describe, expect, it } from 'vitest';

import { StandardLayouts } from '@audiogubbins/domain';
import { sineOfTurns } from '@audiogubbins/audio-engine';

import { goldenRender } from '../../testing/golden-render.js';
import { spleeter2Stems, spleeter4Stems } from './spleeter.js';
import { SPLEETER_2_STEMS_MODEL, SPLEETER_4_STEMS_MODEL } from './spleeter-model.js';

/** The SHA-256 of each golden render's output, its samples' bytes in order. */
const GOLDEN_2_STEMS_VOCALS = '08287bb327c01b13c5378840c2ed54ada6a5282a08ce06615958c5fde0e65562';
const GOLDEN_4_STEMS_DRUMS = '2dcfafa83e7fde993a6778979ead7d7027e3a52577c950956e3dcf65bdff82f2';

/** The model's rate, so the golden holds the separation and no resampling. */
const RATE = SPLEETER_2_STEMS_MODEL.definition.sampleRate;

/** Fourteen seconds: the first segment's 11.8 and part of the second, so the join is held too. */
const FRAMES = 14 * RATE;

/** A burst's envelope `since` seconds in, gone after `length`: `(1 − t/length)⁴`. */
function decay(since: number, length: number): number {
  const left = Math.max(0, 1 - since / length);
  return left * left * left * left;
}

/**
 * A stereo mix of fourteen seconds at 44.1 kHz: a voice of twenty harmonics
 * gliding between 180 and 260 Hz, gated into syllables, in the centre; a bass
 * of three harmonics stepping through four notes, a little left; a kick and a
 * hi-hat on each beat at 120 beats a minute, decaying bursts of a low tone and
 * of noise from a linear congruential generator, a little right; and a chord of
 * three tones held under them, wide. The canonical sine and basic arithmetic
 * throughout, never `Math.exp`, whose last bit an engine may choose, so the
 * input is the same bits everywhere.
 */
function mix(): [Float32Array, Float32Array] {
  const left = new Float32Array(FRAMES);
  const right = new Float32Array(FRAMES);
  const bassNotes = [55, 73.42, 65.41, 82.41];
  let voicePhase = 0;
  let seed = 3;
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const time = frame / RATE;
    const pitch = 220 + 40 * sineOfTurns((time / 2.3) % 1);
    voicePhase = (voicePhase + pitch / RATE) % 1;
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

/** The settings of a render that chooses the stem `stem`. */
function choosing(stem: string) {
  return { layout: StandardLayouts.stereo, sampleRate: RATE, values: { stem } };
}

describe('Spleeter, pinned', { timeout: 300_000 }, () => {
  it('renders the two-stem golden vocals from the pack, on the pinned runtime', async () => {
    const { frames, digest, seconds } = await goldenRender(
      spleeter2Stems,
      SPLEETER_2_STEMS_MODEL.definition,
      choosing('vocals'),
      mix(),
    );
    expect({ frames, digest }, `rendered in ${seconds.toFixed(1)} s`).toEqual({
      frames: 2 * FRAMES,
      digest: GOLDEN_2_STEMS_VOCALS,
    });
  });

  it('renders the four-stem golden drums from the pack, on the pinned runtime', async () => {
    const { frames, digest, seconds } = await goldenRender(
      spleeter4Stems,
      SPLEETER_4_STEMS_MODEL.definition,
      choosing('drums'),
      mix(),
    );
    expect({ frames, digest }, `rendered in ${seconds.toFixed(1)} s`).toEqual({
      frames: 2 * FRAMES,
      digest: GOLDEN_4_STEMS_DRUMS,
    });
  });
});
