/**
 * Transients: the onsets of notes and hits, where the spectrum rises faster
 * than the music around it does (`transients.rs`).
 *
 * Frames of about 40 ms, a quarter of a frame apart. An onset is where a
 * channel's spectral flux rises past its adaptive threshold, `THRESHOLD_SCALE`
 * times the median of the last half second's flux plus a floor, at least
 * `DEBOUNCE_SECONDS` after the channel's last; onsets on several channels
 * within that time of the first are one finding on all of them. A finding
 * covers the frame the flux crossed in, which holds the onset, and is measured
 * by its largest flux over threshold, in decibels. A transient is part of the
 * sound, so nothing treats it: a classification reports it.
 */

import { FindingKind, MeasureUnit, type DetectorFinding } from '@audiogubbins/domain';
import { DetectorKind, gainToDecibels } from '@audiogubbins/audio-engine';

import type { AudioDetector } from './audio-detector.js';
import { findingRange, openPass, type RecordJudge } from './feature-pass.js';

/**
 * A frame's least length: 40 ms, whose bins of under 25 Hz part the lowest
 * harmonics of a held note, which a shorter frame hears beating against each
 * other as a rise in every few frames.
 */
const FRAME_SECONDS = 0.04;

/** The flux a threshold follows: the last half second's, a few notes' worth. */
const HISTORY_SECONDS = 0.5;

/**
 * How far past the median a flux must rise: twice it. A held note's frames
 * vary in flux by far less, and an attack carries several times as much.
 */
const THRESHOLD_SCALE = 2;

/**
 * The threshold's floor in a frame of 2048 samples: about the flux of a
 * broadband attack 60 dB below full scale, under which none is heard. A
 * spectrum of `N` samples sums the magnitudes of `N/2` bins, each of a noise
 * `1/√N` as large, so the floor grows with `√N`.
 */
const FLOOR_AT_2048 = 0.014;

/**
 * The least time between two onsets: 50 ms. Two attacks closer than that are
 * heard as one, and an attack's flux spreads over the four frames whose
 * windows it enters.
 */
const DEBOUNCE_SECONDS = 0.05;

/** An onset found: its first frame, its channels, and its largest flux over threshold. */
interface Onset {
  readonly frame: number;
  readonly channels: Set<number>;
  ratio: number;
}

/** Where an onset's frames are, and how many frames apart two onsets must be. */
interface OnsetGeometry {
  readonly size: number;
  readonly hop: number;
  readonly debounce: number;
}

/** The judge of flux records, finding each channel's onsets and gathering them. */
class TransientJudge implements RecordJudge {
  readonly #geometry: OnsetGeometry;
  /** Per channel, whether the last frame's flux was past its threshold. */
  readonly #above: Uint8Array;
  /** Per channel, the frame of its last onset. */
  readonly #last: Float64Array;
  readonly #onsets: Onset[] = [];
  #frame = 0;

  constructor(channels: number, geometry: OnsetGeometry) {
    this.#geometry = geometry;
    this.#above = new Uint8Array(channels);
    this.#last = new Float64Array(channels).fill(Number.NEGATIVE_INFINITY);
  }

  read(records: Float64Array, count: number): void {
    const channels = this.#above.length;
    for (let record = 0; record < count; record += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const at = 2 * (record * channels + channel);
        const flux = records[at] ?? 0;
        const threshold = records[at + 1] ?? 0;
        this.#hear(channel, flux > threshold, flux / threshold);
      }
      this.#frame += 1;
    }
  }

  findings(frames: number): readonly DetectorFinding[] {
    const { size, hop } = this.#geometry;
    return this.#onsets
      .filter((onset) => onset.frame * hop < frames)
      .map((onset) => ({
        kind: FindingKind.Transient,
        range: findingRange(onset.frame * hop, onset.frame * hop + size, frames),
        channels: [...onset.channels].toSorted((one, other) => one - other),
        measure: { value: gainToDecibels(onset.ratio), unit: MeasureUnit.Decibels },
        treatment: {
          kind: 'none',
          reason: 'A transient is part of the sound, not a fault: it is reported, not treated.',
        },
      }));
  }

  /** Hears whether `channel`'s flux is past its threshold this frame, by `ratio`. */
  #hear(channel: number, above: boolean, ratio: number): void {
    const frame = this.#frame;
    const was = this.#above[channel] === 1;
    this.#above[channel] = above ? 1 : 0;
    if (!above) return;
    const open = this.#onsets.at(-1);
    const within = open !== undefined && frame - open.frame < this.#geometry.debounce;
    if (was || frame - (this.#last[channel] ?? 0) < this.#geometry.debounce) {
      // Still the same attack: its largest rise is its measure.
      if (within && open.channels.has(channel)) open.ratio = Math.max(open.ratio, ratio);
      return;
    }
    this.#last[channel] = frame;
    if (within) {
      open.channels.add(channel);
      open.ratio = Math.max(open.ratio, ratio);
    } else {
      this.#onsets.push({ frame, channels: new Set([channel]), ratio });
    }
  }
}

/** The STFT size at `rate`: the power of two at or above `FRAME_SECONDS`. */
function sizeAt(rate: number): number {
  let size = 16;
  while (size < FRAME_SECONDS * rate) size *= 2;
  return size;
}

/** Onsets, for a classification of the audio. */
export const TRANSIENT_DETECTOR: AudioDetector = {
  identity: { key: 'transients', label: 'Transients', version: 1 },
  finds: [FindingKind.Transient],
  open: ({ input, sampleRate, dsp }) => {
    const size = sizeAt(sampleRate);
    const hop = size / 4;
    const geometry = { size, hop, debounce: Math.ceil((DEBOUNCE_SECONDS * sampleRate) / hop) };
    return openPass(
      dsp,
      {
        kind: DetectorKind.Transients,
        channels: input.roles.length,
        sampleRate,
        size,
        hop,
        history: Math.ceil((HISTORY_SECONDS * sampleRate) / hop),
        multiplier: THRESHOLD_SCALE,
        offset: FLOOR_AT_2048 * Math.sqrt(size / 2_048),
      },
      (features) => new TransientJudge(features.channels, geometry),
      // Silence after a loud end would be a rise in every bin, and the audio
      // mirrored a kink in its slope, which a spectrum hears as one too: an
      // onset in the last part frame is not judged.
      { kind: 'none' },
    );
  },
};
