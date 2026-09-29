/**
 * The ticks a ruler draws for a viewport, in the format the view writes time
 * in, which are also the grid a position snaps to.
 *
 * The step between labelled ticks is the smallest of a fixed ladder whose
 * spacing on screen is at least the minimum asked for: round numbers of samples
 * for a sample ruler, round times for a clock or milliseconds, and whole
 * frames, seconds and minutes for timecode. A tick at a round time sits on the
 * first boundary at or after that time and is labelled with the round time, so
 * a label never claims a sample it is not on by more than one sample. Minor
 * ticks divide the step where the division is whole and far enough apart to
 * see.
 */

import type { SampleCount, SampleRate } from '@audiogubbins/domain';

import { frameAt, frameStart, nominalFramesPerSecond, type FrameRate } from './frame-rate.js';
import { timecodeOf, timecodeText } from './timecode.js';
import {
  TimeFormatKind,
  TimePrecision,
  formatMicroseconds,
  formatPosition,
  type TimeFormat,
} from './time-format.js';
import { visibleRange, type ViewportState } from './viewport.js';
import { samplesInPixel } from './zoom.js';

/** A labelled tick. */
export interface RulerTick {
  readonly position: SampleCount;
  readonly label: string;
}

/** What a ruler draws: its labelled ticks and the ticks between them. */
export interface RulerTicks {
  readonly major: readonly RulerTick[];
  readonly minor: readonly SampleCount[];
}

/** How a ladder counts: the step in its unit, where tick `k` falls and what it is called. */
interface Ladder {
  /** Steps in the ladder's unit, smallest first. */
  readonly steps: readonly number[];
  /** Samples one unit spans, as a real number, for the spacing on screen. */
  readonly samplesPerUnit: number;
  /** The first boundary at or after unit `units`. */
  readonly positionOf: (units: number) => number;
  /** The unit that boundary `position` is at or after. */
  readonly unitAt: (position: number) => number;
  readonly labelOf: (units: number, step: number) => string;
}

const ONE_TWO_FIVE: readonly number[] = (() => {
  const steps: number[] = [];
  for (let power = 1; power <= 1e15; power *= 10) steps.push(power, power * 2, power * 5);
  return steps;
})();

/** Round times in microseconds, from a microsecond to a day. */
const TIME_STEPS: readonly number[] = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000,
  500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 15_000_000, 30_000_000, 60_000_000,
  120_000_000, 300_000_000, 600_000_000, 900_000_000, 1_800_000_000, 3_600_000_000, 7_200_000_000,
  21_600_000_000, 43_200_000_000, 86_400_000_000,
];

/** Frame steps: frames, then seconds, minutes and hours in nominal frames. */
function frameSteps(perSecond: number): readonly number[] {
  const seconds = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21_600];
  const frames = [1, 2, 5, 10].filter((step) => step < perSecond);
  return [...frames, ...seconds.map((second) => second * perSecond)];
}

function sampleLadder(rate: SampleRate): Ladder {
  return {
    steps: ONE_TWO_FIVE,
    samplesPerUnit: 1,
    positionOf: (units) => units,
    unitAt: (position) => position,
    labelOf: (units) => formatPosition(units, rate, { kind: TimeFormatKind.Samples }),
  };
}

function timeLadder(
  rate: SampleRate,
  kind: typeof TimeFormatKind.Clock | typeof TimeFormatKind.Milliseconds,
): Ladder {
  const bigRate = BigInt(rate);
  return {
    steps: TIME_STEPS,
    samplesPerUnit: rate / 1_000_000,
    positionOf: (units) => {
      const scaled = BigInt(units) * bigRate;
      return Number((scaled + 999_999n) / 1_000_000n);
    },
    unitAt: (position) => Number((BigInt(position) * 1_000_000n) / bigRate),
    labelOf: (units, step) =>
      formatMicroseconds(
        BigInt(units),
        kind,
        step < 1000 ? TimePrecision.Microseconds : TimePrecision.Milliseconds,
      ),
  };
}

function frameLadder(rate: SampleRate, frames: FrameRate): Ladder {
  return {
    steps: frameSteps(nominalFramesPerSecond(frames)),
    samplesPerUnit: (rate * frames.denominator) / frames.numerator,
    positionOf: (units) => frameStart(units, rate, frames),
    unitAt: (position) => frameAt(position, rate, frames),
    labelOf: (units) => timecodeText(timecodeOf(units, frames)),
  };
}

function ladderFor(format: TimeFormat, rate: SampleRate): Ladder {
  switch (format.kind) {
    case TimeFormatKind.Samples:
      return sampleLadder(rate);
    case TimeFormatKind.Milliseconds:
    case TimeFormatKind.Clock:
      return timeLadder(rate, format.kind);
    case TimeFormatKind.Timecode:
      return frameLadder(rate, format.frames);
  }
}

/**
 * A step past the ladder's largest, for a zoom so far out that even it would
 * crowd the ruler: the largest, times the whole number that spaces it enough.
 */
function beyondLadder(
  ladder: Ladder,
  spacingOf: (units: number) => number,
  minimum: number,
): number {
  const largest = ladder.steps.at(-1) ?? 1;
  return largest * Math.ceil(minimum / spacingOf(largest));
}

/** Divisions of a step, most first, for its minor ticks. */
const DIVISIONS = [10, 5, 4, 2] as const;

/** Minor ticks closer than this many CSS pixels are not drawn. */
const MINIMUM_MINOR_SPACING = 6;

function boundaryOf(value: number): SampleCount {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a tick inside the visible range is a boundary within the timeline
  return value as SampleCount;
}

/**
 * The ticks of `view` for a timeline of `length` at `rate`, written in
 * `format`, with labelled ticks at least `minimumSpacing` CSS pixels apart.
 */
export function rulerTicks(
  view: ViewportState,
  length: SampleCount,
  rate: SampleRate,
  format: TimeFormat,
  minimumSpacing: number,
): RulerTicks {
  const ladder = ladderFor(format, rate);
  const perPixel = samplesInPixel(view.zoom);
  const spacingOf = (units: number): number => (units * ladder.samplesPerUnit) / perPixel;
  const step =
    ladder.steps.find((each) => spacingOf(each) >= minimumSpacing) ??
    beyondLadder(ladder, spacingOf, minimumSpacing);
  const division = DIVISIONS.find(
    (each) => step % each === 0 && spacingOf(step / each) >= MINIMUM_MINOR_SPACING,
  );
  const minorStep = division === undefined ? undefined : step / division;

  const shown = visibleRange(view, length);
  const firstUnit = Math.max(0, ladder.unitAt(shown.start));
  const major: RulerTick[] = [];
  const minor: SampleCount[] = [];
  const unitStep = minorStep ?? step;
  for (let units = Math.ceil(firstUnit / unitStep) * unitStep; ; units += unitStep) {
    const position = ladder.positionOf(units);
    if (position > shown.end) break;
    if (position < shown.start) continue;
    if (units % step === 0)
      major.push({ position: boundaryOf(position), label: ladder.labelOf(units, step) });
    else minor.push(boundaryOf(position));
  }
  return { major, minor };
}

/** Every tick of the ruler, labelled or not, in order: the grid a position snaps to. */
export function gridPositions(ticks: RulerTicks): readonly SampleCount[] {
  return [...ticks.major.map((tick) => tick.position), ...ticks.minor].sort((a, b) => a - b);
}
