/**
 * The noise floor: the level of the quietest stretch of the audio long enough
 * to learn a noise reduction's profile from, where it is loud enough to be
 * heard (`noise_floor.rs`).
 *
 * Frames of 50 ms, half a frame apart, each read as its level in dBFS. The
 * extractor's floor is the loudest of the last `stretch` frames' levels, its
 * percentile the whole way up, so it is the level of the stretch of half a
 * second that ends at each frame, every frame of it no louder. The quietest
 * stretch is the one whose loudest channel's floor is lowest, among those with
 * no frame of digital silence, which holds no noise to learn from, and whose
 * frames stay within `STEADY_RANGE` of each other and under `LOUDEST_FLOOR`, as
 * noise alone does and a fade or a held note of the programme does not. One
 * finding covers that stretch, on the channels whose floor there is audible,
 * measured by the loudest of those floors, and treated by a noise reduction
 * that learns its profile from it. Audio shorter than one stretch has none.
 */

import { FindingKind, MeasureUnit, type DetectorFinding } from '@audiogubbins/domain';
import { DetectorKind } from '@audiogubbins/audio-engine';

import type { AudioDetector } from './audio-detector.js';
import { findingRange, openPass, type RecordJudge } from './feature-pass.js';
import { noiseReductionStep } from './treatments.js';

/** A frame's length: 50 ms, short enough to fit between a phrase's words. */
const FRAME_SECONDS = 0.05;

/**
 * The shortest stretch a profile is learned from: half a second, about forty
 * of the noise reduction's frames at its default resolution, enough for a
 * steady noise's mean magnitude in each bin.
 */
const STRETCH_SECONDS = 0.5;

/**
 * The quietest floor that is heard: −70 dBFS, about 25 dB SPL where full scale
 * plays near 95 dB SPL, the level of a quiet room, past which noise is heard
 * over the room in a programme's quiet passages.
 */
const AUDIBLE_FLOOR = -70;

/**
 * The loudest floor that is noise: −30 dBFS. A working recording chain's noise
 * sits 40 dB or more under its programme, so a steady stretch louder than this
 * is a held note or a drone of the programme, and a profile learned from it
 * would take the music out with the noise.
 */
const LOUDEST_FLOOR = -30;

/**
 * A frame quieter than −120 dBFS on every channel is digital silence or the
 * last of a fade, far under the −101 dBFS of 16-bit dither, and holds no noise
 * to learn a profile from.
 */
const SILENT_LEVEL = -120;

/**
 * The most a stretch's frames may differ in level: 6 dB. A steady noise's
 * frames of 50 ms differ by a fraction of a decibel, and a fade or a quiet
 * phrase of the programme by more.
 */
const STEADY_RANGE = 6;

/** Where a stretch's frames are: `stretch` frames `hop` apart, each `frame` long. */
interface StretchGeometry {
  readonly frame: number;
  readonly hop: number;
  readonly stretch: number;
}

/** The judge of noise-floor records, keeping the quietest steady stretch. */
class NoiseFloorJudge implements RecordJudge {
  readonly #channels: number;
  readonly #geometry: StretchGeometry;
  /** The last `stretch` frames' loudest channel levels, a ring. */
  readonly #recent: Float64Array;
  /** Per channel, the floors of the quietest stretch so far. */
  readonly #best: Float64Array;
  #bestFloor = Number.POSITIVE_INFINITY;
  #bestEnd = -1;
  #frame = 0;
  #lastSilent = -1;

  constructor(channels: number, geometry: StretchGeometry) {
    this.#channels = channels;
    this.#geometry = geometry;
    this.#recent = new Float64Array(geometry.stretch);
    this.#best = new Float64Array(channels);
  }

  read(records: Float64Array, count: number): void {
    const width = 2 * this.#channels;
    for (let record = 0; record < count; record += 1) {
      let level = Number.NEGATIVE_INFINITY;
      let floor = Number.NEGATIVE_INFINITY;
      for (let channel = 0; channel < this.#channels; channel += 1) {
        level = Math.max(level, records[record * width + 2 * channel] ?? level);
        floor = Math.max(floor, records[record * width + 2 * channel + 1] ?? floor);
      }
      if (!(level >= SILENT_LEVEL)) this.#lastSilent = this.#frame;
      this.#recent[this.#frame % this.#recent.length] = level;
      if (floor < this.#bestFloor && this.#candidate(floor)) {
        this.#bestFloor = floor;
        this.#bestEnd = this.#frame;
        for (let channel = 0; channel < this.#channels; channel += 1) {
          this.#best[channel] = records[record * width + 2 * channel + 1] ?? floor;
        }
      }
      this.#frame += 1;
    }
  }

  findings(frames: number): readonly DetectorFinding[] {
    if (this.#bestEnd < 0) return [];
    const channels = Array.from(this.#best.keys()).filter(
      (channel) => (this.#best[channel] ?? AUDIBLE_FLOOR) >= AUDIBLE_FLOOR,
    );
    if (channels.length === 0) return [];
    const { frame, hop, stretch } = this.#geometry;
    const stretchRange = findingRange(
      (this.#bestEnd - stretch + 1) * hop,
      this.#bestEnd * hop + frame,
      frames,
    );
    return [
      {
        kind: FindingKind.Noise,
        range: stretchRange,
        channels,
        measure: { value: this.#bestFloor, unit: MeasureUnit.Dbfs },
        treatment: { kind: 'steps', steps: [noiseReductionStep(stretchRange)] },
      },
    ];
  }

  /**
   * Whether the stretch ending at this frame, its loudest level `floor`, is
   * one a profile can be learned from: whole, with no silent frame, steady,
   * and no louder than noise is.
   */
  #candidate(floor: number): boolean {
    const stretch = this.#recent.length;
    if (this.#frame - this.#lastSilent < stretch || this.#frame + 1 < stretch) return false;
    if (floor > LOUDEST_FLOOR) return false;
    let quietest = floor;
    for (const level of this.#recent) quietest = Math.min(quietest, level);
    return floor - quietest <= STEADY_RANGE;
  }
}

/** The frames a stretch is read in at `rate`. */
function geometryAt(rate: number): StretchGeometry {
  const frame = Math.floor(FRAME_SECONDS * rate);
  const hop = Math.floor(frame / 2);
  // The fewest frames, `hop` apart, that span the stretch's length.
  const stretch = Math.ceil((STRETCH_SECONDS * rate - frame) / hop) + 1;
  return { frame, hop, stretch };
}

/** The noise floor, and the quietest stretch to learn a noise reduction's profile from. */
export const NOISE_FLOOR_DETECTOR: AudioDetector = {
  identity: { key: 'noise-floor', label: 'Noise floor', version: 1 },
  finds: [FindingKind.Noise],
  parameters: [],
  refusal: () => undefined,
  open: ({ input, sampleRate, dsp }) => {
    const geometry = geometryAt(sampleRate);
    return openPass(
      dsp,
      {
        kind: DetectorKind.NoiseFloor,
        channels: input.roles.length,
        sampleRate,
        frame: geometry.frame,
        hop: geometry.hop,
        percentile: 1,
        history: geometry.stretch,
      },
      (features) => new NoiseFloorJudge(features.channels, geometry),
      // A stretch is of whole frames, which silence after the audio would make quieter.
      { kind: 'none' },
    );
  },
};
