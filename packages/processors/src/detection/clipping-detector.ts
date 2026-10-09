/**
 * Clipping: runs of samples held at the largest magnitude they reach, where
 * a converter or a stage ran out of headroom and flattened the waveform
 * (`clipping.rs`).
 *
 * A run is at least `MINIMUM_RUN_SECONDS` of samples within `EPSILON` of
 * their block's largest magnitude, longer than any crest of a sine of the
 * lowest audible frequency stays there. A run the extractor cuts at a block's
 * edge is joined to its continuation in the next block before it is held to
 * that length, and runs on several channels that overlap are one finding on
 * all of them, as a clip of a whole frame is one fault. Each finding is
 * measured by its magnitude in dBFS, and has no treatment in this build.
 */

import { FindingKind, MeasureUnit, type DetectorFinding } from '@audiogubbins/domain';
import { DetectorKind, gainToDecibels } from '@audiogubbins/audio-engine';

import type { AudioDetector } from './audio-detector.js';
import { findingRange, openPass, type RecordJudge } from './feature-pass.js';

/**
 * A block's length: the power of two at or above a tenth of a second, long
 * enough that a run is rarely cut at its edge and short enough that a block's
 * largest magnitude is the clip's, not a louder passage's elsewhere.
 */
const BLOCK_SECONDS = 0.1;

/**
 * How near its block's largest magnitude a sample is held: 2⁻¹⁶, half a
 * 16-bit step, so a clip stored at 16 bits and read back, or converted from
 * one sample format to another, is still one run.
 */
const EPSILON = 1 / 65_536;

/**
 * The shortest run: 120 µs. The crest of a full-scale 20 Hz sine stays within
 * `EPSILON` of its peak for about 88 µs, so a run longer than that is a
 * flattened waveform, not a smooth peak sampled finely.
 */
const MINIMUM_RUN_SECONDS = 0.000_12;

/**
 * The least magnitude a run is a clip at: 2⁻⁸, −48 dBFS, where `EPSILON` is a
 * 256th of it. Below, it is a passage so quiet that every sample of a block
 * lies within `EPSILON` of its peak, flat only beside the tolerance.
 */
const LEAST_CLIP = 1 / 256;

/** The fewest samples of a run at any rate: a peak and its two neighbours are not a flat top. */
const FEWEST_RUN_SAMPLES = 3;

/** Why nothing in this build treats clipping, and what can be done instead. */
const NO_DECLIPPER =
  'This build has no declipper, so nothing here restores the flattened peaks. Where the source can be recorded or exported again, lower the level before the stage that clipped; otherwise a limiter or a gentle low-pass can soften the harshness, though neither restores what was cut off.';

/** A run at its block's largest magnitude: its channel, first and end frames, and magnitude. */
interface Run {
  readonly channel: number;
  readonly start: number;
  end: number;
  magnitude: number;
}

/** A clip: the frames and channels of overlapping runs, and their magnitude. */
interface Clip {
  readonly start: number;
  end: number;
  readonly channels: Set<number>;
  magnitude: number;
}

/**
 * The clips `runs` make, in order: runs on several channels that overlap are
 * one clip on all of them.
 */
function clipsOf(runs: readonly Run[]): readonly Clip[] {
  const clips: Clip[] = [];
  for (const run of runs.toSorted((one, other) => one.start - other.start)) {
    const open = clips.at(-1);
    if (open !== undefined && run.start < open.end) {
      open.end = Math.max(open.end, run.end);
      open.channels.add(run.channel);
      open.magnitude = Math.max(open.magnitude, run.magnitude);
    } else {
      const { start, end, magnitude } = run;
      clips.push({ start, end, magnitude, channels: new Set([run.channel]) });
    }
  }
  return clips;
}

/** The judge of clipping events, joining and merging their runs. */
class ClippingJudge implements RecordJudge {
  readonly #minimumRun: number;
  /**
   * Per channel, its runs of at least the minimum in order, and the last
   * run, which a continuation in the next block may yet join.
   */
  readonly #runs: Run[][];

  constructor(channels: number, minimumRun: number) {
    this.#minimumRun = minimumRun;
    this.#runs = Array.from({ length: channels }, () => []);
  }

  read(records: Float64Array, count: number): void {
    for (let record = 0; record < count; record += 1) {
      const at = 4 * record;
      const channel = records[at] ?? 0;
      const runs = this.#runs[channel];
      const magnitude = records[at + 3] ?? 0;
      if (runs === undefined || magnitude < LEAST_CLIP) continue;
      const start = records[at + 1] ?? 0;
      const end = start + (records[at + 2] ?? 0);
      const last = runs.at(-1);
      if (last?.end === start) {
        last.end = end;
        last.magnitude = Math.max(last.magnitude, magnitude);
        continue;
      }
      // The last run is whole now, and kept only where it is long enough.
      if (last !== undefined && last.end - last.start < this.#minimumRun) runs.pop();
      runs.push({ channel, start, end, magnitude });
    }
  }

  findings(frames: number): readonly DetectorFinding[] {
    const runs = this.#runs
      .flat()
      .filter((run) => run.end - run.start >= this.#minimumRun && run.start < frames);
    return clipsOf(runs).map((clip) => ({
      kind: FindingKind.Clipping,
      range: findingRange(clip.start, clip.end, frames),
      channels: [...clip.channels].toSorted((one, other) => one - other),
      measure: { value: gainToDecibels(clip.magnitude), unit: MeasureUnit.Dbfs },
      treatment: { kind: 'none', reason: NO_DECLIPPER },
    }));
  }
}

/** The power of two at or above `seconds` at `rate`. */
function blockAt(rate: number): number {
  let block = 1;
  while (block < BLOCK_SECONDS * rate) block *= 2;
  return block;
}

/** Clipping, run by run. */
export const CLIPPING_DETECTOR: AudioDetector = {
  identity: { key: 'clipping', label: 'Clipping', version: 1 },
  finds: [FindingKind.Clipping],
  parameters: [],
  refusal: () => undefined,
  open: ({ input, sampleRate, dsp }) => {
    const block = blockAt(sampleRate);
    const minimumRun = Math.max(FEWEST_RUN_SAMPLES, Math.ceil(MINIMUM_RUN_SECONDS * sampleRate));
    return openPass(
      dsp,
      {
        kind: DetectorKind.Clipping,
        channels: input.roles.length,
        sampleRate,
        block,
        epsilon: EPSILON,
        // Every run, however short: the part of a run in one block may be
        // short and the whole long, so the judge joins them and then holds
        // the whole to the minimum.
        minimumRun: 1,
      },
      (features) => new ClippingJudge(features.channels, minimumRun),
      // Silence completes the last block: it holds no sample near the block's
      // largest magnitude, so it adds no run and cuts none.
      { kind: 'silence', block },
    );
  },
};
