/**
 * A signal with a fault of each kind the assistants act on, at known frames,
 * and its description as the page sends a decoded clip to the worker: music
 * with a silent second, under hiss, a 60 Hz hum and two clicks, held to a
 * ceiling it reaches, so the repair assistant finds clicks and clipping and
 * the restoration assistant a hum and a stretch of the noise alone.
 */

import { PcmDescriptionKind, type PcmDescription } from '@audiogubbins/audio-engine';
import {
  TEST_RATE,
  clipped,
  hiss,
  mixed,
  partials,
  tone,
  withClicks,
} from '@audiogubbins/processors/testing';

/** A second at the test rate, in frames. */
const SECOND: number = TEST_RATE;

/** Its length: four seconds at the test rate. */
export const FAULTY_LENGTH = 4 * SECOND;

/** Where its clicks start. */
export const CLICKS = [30_000, 150_000] as const;

/** Its hum's frequency, a little off the 60 Hz mains. */
export const HUM_HERTZ = 60.2;

/** The silent second of its music, where the noise is heard alone. */
export const QUIET = { start: SECOND, end: 2 * SECOND } as const;

/** The signal's one channel. */
export function faultySignal(): Float32Array {
  const music = partials(FAULTY_LENGTH);
  music.fill(0, QUIET.start, QUIET.end);
  const base = mixed(music, hiss(FAULTY_LENGTH, -50), tone(FAULTY_LENGTH, HUM_HERTZ, -40));
  return withClicks(
    clipped(base, 0.4),
    CLICKS.map((at) => ({ at, width: 9, size: 0.2 })),
  );
}

/** The signal, described as a decoded clip in memory. */
export function faultyDescription(): PcmDescription {
  return { kind: PcmDescriptionKind.Pcm, sampleRate: TEST_RATE, channels: [faultySignal()] };
}
