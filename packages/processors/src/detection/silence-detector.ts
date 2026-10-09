/**
 * Silence: stretches quiet on every channel, at the edges of the audio heard
 * and as pauses within it, which trimming takes out (REQ-AUDIO-018,
 * `silence.rs`).
 *
 * A frame is quiet where no channel's sample passes the threshold. The
 * extractor's runs are cut at its blocks' edges, so a run that ends a block is
 * joined to one that starts the next before it is weighed. A quiet stretch at
 * the start or the end of the audio heard at least the shortest edge silence
 * long is taken out whole, as a trim takes it; one within at least the shortest
 * pause long is a pause, shortened to the pause kept, half of it kept on each
 * side, so the phrases either side keep a breath between them. Each of the four
 * is a parameter a person sets, as any silence trimmer lets them, for a quiet
 * recording or a noisy room; the defaults suit a clean one. Every finding is on
 * every channel, since a trim or a delete takes every channel's frames, and is
 * measured by the largest magnitude it holds, as a linear amplitude so a
 * stretch of digital silence is measured too. Audio that is quiet throughout
 * has one finding, which nothing treats: taking it out would leave nothing.
 */

import {
  FindingKind,
  MeasureUnit,
  ParameterTaper,
  unsafeBrandId,
  type DetectorFinding,
  type NumericParameterDescriptor,
} from '@audiogubbins/domain';
import { DetectorKind, decibelsToGain } from '@audiogubbins/audio-engine';

import type { AudioDetector } from './audio-detector.js';
import { findingRange, openPass, type RecordJudge } from './feature-pass.js';

/** A block's length: the power of two at or above a tenth of a second, as clipping's. */
const BLOCK_SECONDS = 0.1;

/**
 * The loudest sample a quiet frame holds, in dBFS: −60 by default, a
 * thousandth of full scale, under the quiet passages of any programme and near
 * the noise of a good analogue chain, so a join across a stretch taken out
 * steps by no more than twice it. A noisy room needs it higher, and a quiet
 * recording's fade lower.
 */
const THRESHOLD: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a7000000-0001'),
  key: 'threshold',
  label: 'Threshold',
  minimum: -120,
  maximum: -20,
  defaultValue: -60,
  taper: ParameterTaper.Decibel,
  unit: 'dBFS',
  step: 0.1,
};

/** The shortest quiet stretch at an edge taken out: 10 ms by default, under the shortest gap heard. */
const SHORTEST_EDGE: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a7000000-0002'),
  key: 'shortest-edge',
  label: 'Shortest edge silence',
  minimum: 0.001,
  maximum: 10,
  defaultValue: 0.01,
  taper: ParameterTaper.Logarithmic,
  unit: 's',
  step: 0.001,
};

/**
 * The shortest pause shortened: half a second by default. A shorter quiet
 * within is the phrasing of speech or music, not dead air between phrases.
 */
const SHORTEST_PAUSE: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a7000000-0003'),
  key: 'shortest-pause',
  label: 'Shortest pause',
  minimum: 0.05,
  maximum: 60,
  defaultValue: 0.5,
  taper: ParameterTaper.Logarithmic,
  unit: 's',
  step: 0.01,
};

/** What is left of a pause: a quarter of a second by default, a breath between phrases. */
const PAUSE_KEPT: NumericParameterDescriptor = {
  kind: 'numeric',
  id: unsafeBrandId<'ParameterId'>('a7000000-0004'),
  key: 'pause-kept',
  label: 'Pause kept',
  minimum: 0,
  maximum: 10,
  defaultValue: 0.25,
  taper: ParameterTaper.Linear,
  unit: 's',
  step: 0.01,
};

/** Why nothing treats audio quiet throughout. */
const ALL_QUIET =
  'It is quiet throughout, so taking the silence out would leave nothing. Delete it, or analyse a range that holds sound as well.';

/** A quiet run: its first and end frames, and its largest magnitude. */
interface Run {
  readonly start: number;
  end: number;
  peak: number;
}

/** How long each kind of quiet stretch must be, in frames, and how much of a pause is kept. */
interface QuietLengths {
  readonly edge: number;
  readonly pause: number;
  readonly kept: number;
}

/** The judge of silence events, joining their runs and weighing each as an edge or a pause. */
class SilenceJudge implements RecordJudge {
  readonly #channels: number;
  readonly #lengths: QuietLengths;
  /**
   * The runs that may be found, in order: a pause long enough, or the first
   * run while it may be the leading edge, and the last, which may yet be
   * joined or be the trailing edge.
   */
  readonly #runs: Run[] = [];

  constructor(channels: number, lengths: QuietLengths) {
    this.#channels = channels;
    this.#lengths = lengths;
  }

  read(records: Float64Array, count: number): void {
    for (let record = 0; record < count; record += 1) {
      const at = 4 * record;
      const start = records[at] ?? 0;
      const end = start + (records[at + 1] ?? 0);
      const peak = records[at + 2] ?? 0;
      const last = this.#runs.at(-1);
      if (last?.end === start) {
        last.end = end;
        last.peak = Math.max(last.peak, peak);
        continue;
      }
      // The last run is whole now, and not the trailing edge: kept only as
      // the leading edge or a pause.
      if (last !== undefined && !this.#mayBeFound(last)) this.#runs.pop();
      this.#runs.push({ start, end, peak });
    }
  }

  findings(frames: number): readonly DetectorFinding[] {
    const { edge, pause, kept } = this.#lengths;
    const findings: DetectorFinding[] = [];
    for (const run of this.#runs) {
      if (run.start >= frames) continue;
      const end = Math.min(run.end, frames);
      const leading = run.start === 0;
      const trailing = end === frames;
      if (leading && trailing) {
        findings.push(
          this.#finding(0, frames, frames, run.peak, { kind: 'none', reason: ALL_QUIET }),
        );
      } else if (leading || trailing) {
        if (end - run.start >= edge) {
          findings.push(this.#finding(run.start, end, frames, run.peak, { kind: 'removal' }));
        }
      } else if (end - run.start >= pause) {
        const before = Math.floor(kept / 2);
        const from = run.start + before;
        const to = end - (kept - before);
        findings.push(this.#finding(from, to, frames, run.peak, { kind: 'removal' }));
      }
    }
    return findings;
  }

  /** Whether a whole run that is not the last may be found: the leading edge or a pause. */
  #mayBeFound(run: Run): boolean {
    const length = run.end - run.start;
    return run.start === 0 ? length >= this.#lengths.edge : length >= this.#lengths.pause;
  }

  #finding(
    start: number,
    end: number,
    frames: number,
    peak: number,
    treatment: DetectorFinding['treatment'],
  ): DetectorFinding {
    return {
      kind: FindingKind.Silence,
      range: findingRange(start, end, frames),
      channels: Array.from({ length: this.#channels }, (_, channel) => channel),
      measure: { value: peak, unit: MeasureUnit.Linear },
      treatment,
    };
  }
}

/** The value of `parameter` in `values`, or its default. */
function valueOf(
  values: ReadonlyMap<string, number>,
  parameter: NumericParameterDescriptor,
): number {
  return values.get(parameter.key) ?? parameter.defaultValue;
}

/** The power of two at or above `BLOCK_SECONDS` at `rate`. */
function blockAt(rate: number): number {
  let block = 1;
  while (block < BLOCK_SECONDS * rate) block *= 2;
  return block;
}

/** Silence at the edges and pauses within, which trimming takes out. */
export const SILENCE_DETECTOR: AudioDetector = {
  identity: { key: 'silence', label: 'Silence', version: 1 },
  finds: [FindingKind.Silence],
  parameters: [THRESHOLD, SHORTEST_EDGE, SHORTEST_PAUSE, PAUSE_KEPT],
  refusal: (values) =>
    valueOf(values, PAUSE_KEPT) < valueOf(values, SHORTEST_PAUSE)
      ? undefined
      : 'The pause kept must be shorter than the shortest pause, or no pause would be shortened.',
  open: ({ input, sampleRate, dsp, values }) => {
    const value = (parameter: NumericParameterDescriptor): number => valueOf(values, parameter);
    const block = blockAt(sampleRate);
    const lengths: QuietLengths = {
      edge: Math.ceil(value(SHORTEST_EDGE) * sampleRate),
      pause: Math.ceil(value(SHORTEST_PAUSE) * sampleRate),
      kept: Math.round(value(PAUSE_KEPT) * sampleRate),
    };
    return openPass(
      dsp,
      {
        kind: DetectorKind.Silence,
        channels: input.roles.length,
        sampleRate,
        block,
        threshold: decibelsToGain(value(THRESHOLD)),
      },
      (features) => new SilenceJudge(features.channels, lengths),
      // Silence completes the last block, so a quiet stretch that ends the
      // audio is read to its end; what it adds past the end is not heard.
      { kind: 'silence', block },
    );
  },
};
