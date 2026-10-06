/**
 * Mains hum: a line at 50 or 60 Hz or its second harmonic, standing above
 * the spectrum beside it frame after frame (`hum.rs`).
 *
 * A family, a mains fundamental and its second harmonic, shows in a frame on
 * a channel where either stands at least `HUM_MARGIN` above its floor and is
 * itself audible. It stands on a channel where it shows in more than half of
 * the frames: hum is steady, and a bass note on the mains frequency is not.
 * One finding covers the whole audio, on the channels the louder family
 * stands on, measured by its mean margin over the frames it shows in, and
 * treated by a de-hum at that family's fundamental, moved to the frequency
 * measured. Audio shorter than one frame has none.
 */

import { FindingKind, MeasureUnit, type DetectorFinding } from '@audiogubbins/domain';
import { DetectorKind } from '@audiogubbins/audio-engine';

import type { AudioDetector } from './audio-detector.js';
import { findingRange, openPass, type RecordJudge } from './feature-pass.js';
import { HUM_OFFSET, MAINS, deHumStep } from './treatments.js';

/**
 * The widest bin the spectrum is read at, in hertz: fine enough that the
 * floor beside a 50 Hz line, within `FLOOR_WIDTH`, holds ten bins or so
 * clear of the line's own five.
 */
const BIN_HERTZ = 1.5;

/** The largest STFT the extractor takes, which holds bins of 2.9 Hz at 192 kHz. */
const LARGEST_SIZE = 65_536;

/**
 * How far from its nominal a line is sought: the de-hum's offset at the
 * second harmonic, so a fundamental moved as far as the de-hum moves it is
 * still found at either.
 */
const SEARCH_WIDTH = 2 * HUM_OFFSET.maximum;

/**
 * The floor is read within 10 Hz of each line: wider than the search, and
 * narrow enough to stay inside the lowest octave, where hum is heard against
 * the programme's own bass.
 */
const FLOOR_WIDTH = 10;

/**
 * How far above its floor a line must stand: 12 dB, past the few decibels by
 * which the largest of a few bins of noise stands above their median, so a
 * line that clears it is a tone, not noise.
 */
const HUM_MARGIN = 12;

/** The quietest line that is hum: −90 dBFS, below which no listener hears 50 Hz. */
const LEAST_HUM_LEVEL = -90;

/**
 * The level a silent floor reads as: −144 dBFS, under the last bit of 24-bit
 * audio, so a line over digital silence is measured by a finite margin.
 */
const SILENT_LEVEL = -144;

/** The values a record holds per frequency, and the frequencies per channel. */
const TRIPLE = 3;
const FREQUENCIES = 4;

/** Per channel and family, what the frames it shows in sum to. */
const SHOWN = 0;
const MARGIN = 1;
const LEVEL = 2;
const FUNDAMENTAL = 3;
const TALLY_WIDTH = 4;

/** What a family adds up to over the channels it stands on. */
interface Standing {
  readonly family: number;
  readonly channels: readonly number[];
  readonly shown: number;
  readonly margin: number;
  readonly level: number;
  readonly fundamental: number;
}

/** The judge of hum records, tallying each family's frames per channel. */
class HumJudge implements RecordJudge {
  readonly #channels: number;
  /** Per channel and family, `TALLY_WIDTH` sums. */
  readonly #tallies: Float64Array;
  #frames = 0;

  constructor(channels: number) {
    this.#channels = channels;
    this.#tallies = new Float64Array(channels * MAINS.length * TALLY_WIDTH);
  }

  read(records: Float64Array, count: number): void {
    const width = this.#channels * FREQUENCIES * TRIPLE;
    for (let record = 0; record < count; record += 1) {
      for (let channel = 0; channel < this.#channels; channel += 1) {
        for (let family = 0; family < MAINS.length; family += 1) {
          const at = record * width + (channel * FREQUENCIES + 2 * family) * TRIPLE;
          this.#tally(records, at, (channel * MAINS.length + family) * TALLY_WIDTH);
        }
      }
      this.#frames += 1;
    }
  }

  findings(frames: number): readonly DetectorFinding[] {
    const standing = MAINS.map((_, family) => this.#standing(family)).filter(
      (one) => one.channels.length > 0,
    );
    const louder = standing.reduce<Standing | undefined>(
      (best, one) =>
        best === undefined || one.level / one.shown > best.level / best.shown ? one : best,
      undefined,
    );
    if (louder === undefined) return [];
    const mains = MAINS[louder.family] ?? MAINS[0];
    return [
      {
        kind: FindingKind.Hum,
        range: findingRange(0, frames, frames),
        channels: louder.channels,
        measure: { value: louder.margin / louder.shown, unit: MeasureUnit.Decibels },
        treatment: {
          kind: 'steps',
          steps: [deHumStep(mains.option, louder.fundamental / louder.shown - mains.hertz)],
        },
      },
    ];
  }

  /**
   * Adds a frame's fundamental and second harmonic, from `at` in `records`,
   * to the tally from `into`, where the louder of the two above its floor
   * shows.
   */
  #tally(records: Float64Array, at: number, into: number): void {
    let best = -1;
    let bestMargin = HUM_MARGIN;
    for (let harmonic = 0; harmonic < 2; harmonic += 1) {
      const level = records[at + harmonic * TRIPLE + 1] ?? Number.NaN;
      const floor = Math.max(records[at + harmonic * TRIPLE + 2] ?? Number.NaN, SILENT_LEVEL);
      const margin = Math.max(level, SILENT_LEVEL) - floor;
      if (level >= LEAST_HUM_LEVEL && margin >= bestMargin) {
        best = harmonic;
        bestMargin = margin;
      }
    }
    if (best < 0) return;
    const tallies = this.#tallies;
    tallies[into + SHOWN] = (tallies[into + SHOWN] ?? 0) + 1;
    tallies[into + MARGIN] = (tallies[into + MARGIN] ?? 0) + bestMargin;
    tallies[into + LEVEL] = (tallies[into + LEVEL] ?? 0) + (records[at + best * TRIPLE + 1] ?? 0);
    const frequency = (records[at + best * TRIPLE] ?? 0) / (best + 1);
    tallies[into + FUNDAMENTAL] = (tallies[into + FUNDAMENTAL] ?? 0) + frequency;
  }

  /** What `family` adds up to over the channels it shows in more than half the frames of. */
  #standing(family: number): Standing {
    const channels: number[] = [];
    const sums = [0, 0, 0, 0];
    for (let channel = 0; channel < this.#channels; channel += 1) {
      const from = (channel * MAINS.length + family) * TALLY_WIDTH;
      if (2 * (this.#tallies[from + SHOWN] ?? 0) <= this.#frames) continue;
      channels.push(channel);
      for (let sum = 0; sum < TALLY_WIDTH; sum += 1) {
        sums[sum] = (sums[sum] ?? 0) + (this.#tallies[from + sum] ?? 0);
      }
    }
    const [shown = 0, margin = 0, level = 0, fundamental = 0] = sums;
    return { family, channels, shown, margin, level, fundamental };
  }
}

/** The STFT size at `rate`: the power of two whose bins are at most `BIN_HERTZ` wide. */
function sizeAt(rate: number): number {
  let size = 16;
  while (size < LARGEST_SIZE && size * BIN_HERTZ < rate) size *= 2;
  return size;
}

/** Mains hum at 50 or 60 Hz, and its second harmonic. */
export const HUM_DETECTOR: AudioDetector = {
  identity: { key: 'hum', label: 'Mains hum', version: 1 },
  finds: [FindingKind.Hum],
  open: ({ input, sampleRate, dsp }) => {
    const size = sizeAt(sampleRate);
    return openPass(
      dsp,
      {
        kind: DetectorKind.Hum,
        channels: input.roles.length,
        sampleRate,
        size,
        // A quarter of a frame apart, so each sample is near the middle of
        // one frame, where the window weighs it most.
        hop: size / 4,
        searchWidth: SEARCH_WIDTH,
        floorWidth: FLOOR_WIDTH,
      },
      (features) => new HumJudge(features.channels),
      // The share of frames a family shows in needs no part frame at the end.
      { kind: 'none' },
    );
  },
};
