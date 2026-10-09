/**
 * Clicks: where a short predictor fails by far more than the music around it
 * does, as the de-click finds them (`clicks.rs`).
 *
 * The extractor is the de-click's own: its blocks, the power of two at or above
 * 20 ms, and its judgement of an event at the de-click's default sensitivity, a
 * residual's deviation from its block's median above that many times the median
 * absolute deviation. Events on one channel are one click by the de-click's own
 * rule (`joinsClick`), and each click is a finding on its channel, measured by
 * its largest deviation over the median absolute deviation, in decibels,
 * treated by the de-click where the de-click repairs a click that long
 * (`repairsClick`) and otherwise by nothing, saying why. The audio is mirrored
 * past its end, so its last part block is judged against a deviation of the
 * music's.
 */

import { FindingKind, MeasureUnit, type DetectorFinding } from '@audiogubbins/domain';
import { DetectorKind, gainToDecibels } from '@audiogubbins/audio-engine';

import {
  clickGeometry,
  joinsClick,
  repairedFrames,
  repairsClick,
  type ClickGeometry,
} from '../repair/click-geometry.js';
import type { AudioDetector } from './audio-detector.js';
import { findingRange, openPass, type RecordJudge } from './feature-pass.js';
import { CLICK_SENSITIVITY, LONGEST_CLICK, deClickStep } from './treatments.js';

/**
 * The least median absolute deviation a click is measured against: 2⁻²⁴, the
 * last bit of a full-scale sample, below which a block is silence and the
 * extractor judges a residual by that bit alone.
 */
const LEAST_DEVIATION = 1 / 16_777_216;

/** Each channel's click in progress: where it starts, its last event, and its largest ratio. */
const START = 0;
const LAST = 1;
const RATIO = 2;
const SPAN_WIDTH = 3;

/** A click found: its channel, its first and last flagged frames, and its largest ratio. */
interface Click {
  readonly channel: number;
  readonly start: number;
  readonly last: number;
  readonly ratio: number;
}

/** Why the de-click of `geometry` leaves a click of `frames` frames, its guards counted, at `rate`. */
function tooLong(frames: number, geometry: ClickGeometry, rate: number): string {
  const milliseconds = (frames * 1_000) / rate;
  const longest = (geometry.longest * 1_000) / rate;
  return `This click lasts ${milliseconds.toFixed(2)} ms, longer than the ${longest.toFixed(2)} ms the de-click repairs, so the de-click leaves it as a sound.`;
}

/** The finding of `click`, in audio of `frames` frames at `rate`, for a de-click of `geometry`. */
function findingOf(
  click: Click,
  frames: number,
  geometry: ClickGeometry,
  rate: number,
): DetectorFinding {
  const repaired = repairsClick(geometry, click.start, click.last);
  return {
    kind: FindingKind.Click,
    range: findingRange(click.start, click.last + 1, frames),
    channels: [click.channel],
    measure: { value: gainToDecibels(click.ratio), unit: MeasureUnit.Decibels },
    treatment: repaired
      ? { kind: 'steps', steps: [deClickStep()] }
      : {
          kind: 'none',
          reason: tooLong(repairedFrames(click.start, click.last), geometry, rate),
        },
  };
}

/** The judge of click events, gathering each channel's into clicks. */
class ClickJudge implements RecordJudge {
  /** Per channel, a click in progress, its start negative where there is none. */
  readonly #spans: Float64Array;
  readonly #found: Click[] = [];
  readonly #geometry: ClickGeometry;
  readonly #rate: number;

  constructor(channels: number, geometry: ClickGeometry, rate: number) {
    this.#geometry = geometry;
    this.#rate = rate;
    this.#spans = new Float64Array(SPAN_WIDTH * channels);
    for (let channel = 0; channel < channels; channel += 1) {
      this.#spans[SPAN_WIDTH * channel + START] = -1;
    }
  }

  read(records: Float64Array, count: number): void {
    for (let record = 0; record < count; record += 1) {
      const at = 4 * record;
      const channel = records[at] ?? 0;
      const sample = records[at + 1] ?? 0;
      const ratio =
        Math.abs(records[at + 2] ?? 0) / Math.max(records[at + 3] ?? 0, LEAST_DEVIATION);
      this.#event(channel, sample, ratio);
    }
  }

  findings(frames: number): readonly DetectorFinding[] {
    for (let channel = 0; channel * SPAN_WIDTH < this.#spans.length; channel += 1) {
      this.#close(channel);
    }
    // A click of the mirrored tail alone, past the audio's end, is left out.
    return this.#found
      .filter((click) => click.start < frames)
      .toSorted((one, other) => one.start - other.start || one.channel - other.channel)
      .map((click) => findingOf(click, frames, this.#geometry, this.#rate));
  }

  /** Adds an event on `channel` at `sample` to its click, or starts another. */
  #event(channel: number, sample: number, ratio: number): void {
    const at = SPAN_WIDTH * channel;
    const start = this.#spans[at + START] ?? -1;
    const last = this.#spans[at + LAST] ?? 0;
    if (start >= 0 && joinsClick(last, sample)) {
      this.#spans[at + LAST] = sample;
      this.#spans[at + RATIO] = Math.max(this.#spans[at + RATIO] ?? 0, ratio);
      return;
    }
    this.#close(channel);
    this.#spans[at + START] = sample;
    this.#spans[at + LAST] = sample;
    this.#spans[at + RATIO] = ratio;
  }

  /** Makes a finding of `channel`'s click in progress, if it has one. */
  #close(channel: number): void {
    const at = SPAN_WIDTH * channel;
    const start = this.#spans[at + START] ?? -1;
    if (start < 0) return;
    this.#spans[at + START] = -1;
    this.#found.push({
      channel,
      start,
      last: this.#spans[at + LAST] ?? start,
      ratio: this.#spans[at + RATIO] ?? 0,
    });
  }
}

/** Clicks, on the de-click's own extractor and blocks. */
export const CLICK_DETECTOR: AudioDetector = {
  identity: { key: 'clicks', label: 'Clicks', version: 1 },
  finds: [FindingKind.Click],
  parameters: [],
  refusal: () => undefined,
  open: ({ input, sampleRate, dsp }) => {
    const geometry = clickGeometry(sampleRate, LONGEST_CLICK.defaultValue);
    const { block } = geometry;
    return openPass(
      dsp,
      {
        kind: DetectorKind.Clicks,
        channels: input.roles.length,
        sampleRate,
        block,
        sensitivity: CLICK_SENSITIVITY.defaultValue,
      },
      (features) => new ClickJudge(features.channels, geometry, sampleRate),
      { kind: 'mirror', block },
    );
  },
};
