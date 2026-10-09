/**
 * DC offset: a channel whose mean stays off zero, as a converter's offset
 * holds it, rather than crossing it as the programme's lowest notes do
 * (`dc_offset.rs`).
 *
 * The mean of each channel over windows of a second, one after another. A
 * channel is offset where every window's mean is at least `LEAST_OFFSET` from
 * zero, all on one side. One finding covers the whole audio, on every offset
 * channel, measured by the mean of the channel furthest off, signed, and
 * treated by a DC offset removal. Audio shorter than one window has none.
 */

import { FindingKind, MeasureUnit, type DetectorFinding } from '@audiogubbins/domain';
import { DetectorKind } from '@audiogubbins/audio-engine';

import type { AudioDetector } from './audio-detector.js';
import { findingRange, openPass, type RecordJudge } from './feature-pass.js';
import { dcOffsetRemovalStep } from './treatments.js';

/**
 * A window's length: a second, over which the mean of a tone of 20 Hz or
 * above, the lowest heard, stays under a sixtieth of its amplitude, and
 * changes sign from window to window as its cycles fall.
 */
const WINDOW_SECONDS = 1;

/**
 * The least offset worth removing: a thousandth of full scale, −60 dBFS. An
 * edit or a fade that cuts an offset that large to zero steps by enough to be
 * heard as a click in a quiet passage.
 */
const LEAST_OFFSET = 0.001;

/** Per channel, the sum of its windows' means, and whether it has stayed offset. */
const SUM = 0;
const SIDE = 1;
const TALLY_WIDTH = 2;

/** The judge of window means, keeping each channel's sum and side. */
class DcOffsetJudge implements RecordJudge {
  readonly #channels: number;
  /** Per channel, the sum of its means, and +1 or −1 while every mean is offset that side, else 0. */
  readonly #tallies: Float64Array;
  #windows = 0;

  constructor(channels: number) {
    this.#channels = channels;
    this.#tallies = new Float64Array(TALLY_WIDTH * channels);
  }

  read(records: Float64Array, count: number): void {
    for (let record = 0; record < count; record += 1) {
      for (let channel = 0; channel < this.#channels; channel += 1) {
        const mean = records[record * this.#channels + channel] ?? 0;
        const at = TALLY_WIDTH * channel;
        const side = mean >= LEAST_OFFSET ? 1 : mean <= -LEAST_OFFSET ? -1 : 0;
        const held = this.#tallies[at + SIDE] ?? 0;
        this.#tallies[at + SUM] = (this.#tallies[at + SUM] ?? 0) + mean;
        this.#tallies[at + SIDE] = this.#windows === 0 || held === side ? side : 0;
      }
      this.#windows += 1;
    }
  }

  findings(frames: number): readonly DetectorFinding[] {
    if (this.#windows === 0) return [];
    const channels: number[] = [];
    let furthest = 0;
    for (let channel = 0; channel < this.#channels; channel += 1) {
      if ((this.#tallies[TALLY_WIDTH * channel + SIDE] ?? 0) === 0) continue;
      channels.push(channel);
      const mean = (this.#tallies[TALLY_WIDTH * channel + SUM] ?? 0) / this.#windows;
      if (Math.abs(mean) > Math.abs(furthest)) furthest = mean;
    }
    if (channels.length === 0) return [];
    return [
      {
        kind: FindingKind.DcOffset,
        range: findingRange(0, frames, frames),
        channels,
        measure: { value: furthest, unit: MeasureUnit.Linear },
        treatment: { kind: 'steps', steps: [dcOffsetRemovalStep()] },
      },
    ];
  }
}

/** A DC offset on any channel. */
export const DC_OFFSET_DETECTOR: AudioDetector = {
  identity: { key: 'dc-offset', label: 'DC offset', version: 1 },
  finds: [FindingKind.DcOffset],
  parameters: [],
  refusal: () => undefined,
  open: ({ input, sampleRate, dsp }) => {
    const window = WINDOW_SECONDS * sampleRate;
    return openPass(
      dsp,
      {
        kind: DetectorKind.DcOffset,
        channels: input.roles.length,
        sampleRate,
        window,
        // Windows end to end, so the mean of the means is the mean of the frames they cover.
        hop: window,
      },
      (features) => new DcOffsetJudge(features.channels),
      // Silence after the audio would draw the last window's mean towards zero.
      { kind: 'none' },
    );
  },
};
