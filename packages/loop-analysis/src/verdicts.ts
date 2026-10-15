/**
 * What a loop metric says, and the thresholds that say it (ADR-0103, the
 * plan's metric table).
 *
 * Every metric is measured on each channel and reported once, for the worst
 * channel: the one whose verdict is worst, the larger value between two of one
 * verdict, the lower channel between two equal. Every metric here grows as the
 * seam gets worse, so the worse of two values is always the larger.
 */

/** A metric's verdict. */
export type Verdict = 'pass' | 'warn' | 'fail' | 'not-applicable';

/** What a seam metric compared: the audio that follows E or precedes S where the region has it, else the loop's own tail and head. */
export type SeamReference = 'post-end' | 'pre-start' | 'adjacent';

/** The unit a metric is stated in. */
export type MetricUnit = 'deviations' | 'dBFS' | 'dB' | 'degrees' | 'frames' | 'ratio';

/** One measured property of a loop's seam. */
export interface LoopMetric {
  /** In `unit`; 0 where not applicable. */
  readonly value: number;
  readonly unit: MetricUnit;
  readonly verdict: Verdict;
  /** The worst channel, or `undefined` where the metric is not applicable. */
  readonly channel: number | undefined;
  readonly reference?: SeamReference;
  /** Why the metric is not applicable. */
  readonly reason?: string;
}

/** The metrics the table states thresholds for. */
export type MetricName =
  | 'discontinuity'
  | 'dcMismatch'
  | 'netDc'
  | 'levelMismatch'
  | 'phaseMismatch'
  | 'spectralMismatch'
  | 'zeroCrossing'
  | 'zeroCrossingSigns'
  | 'crossfade'
  | 'cycleSeam'
  | 'cycleDrift';

interface Threshold {
  readonly unit: MetricUnit;
  /** The largest value that passes. */
  readonly pass: number;
  /** The largest value that warns; above it fails. Infinite where nothing fails. */
  readonly warn: number;
}

/** The plan's table of thresholds, one row per metric. */
const THRESHOLDS: Readonly<Record<MetricName, Threshold>> = {
  discontinuity: { unit: 'deviations', pass: 4, warn: 8 },
  dcMismatch: { unit: 'dBFS', pass: -60, warn: -40 },
  netDc: { unit: 'dBFS', pass: -60, warn: -40 },
  levelMismatch: { unit: 'dB', pass: 1, warn: 3 },
  phaseMismatch: { unit: 'degrees', pass: 15, warn: 45 },
  spectralMismatch: { unit: 'dB', pass: 1.5, warn: 4 },
  zeroCrossing: { unit: 'frames', pass: 1, warn: Number.POSITIVE_INFINITY },
  zeroCrossingSigns: { unit: 'ratio', pass: 0, warn: Number.POSITIVE_INFINITY },
  crossfade: { unit: 'dB', pass: 1.5, warn: 3 },
  cycleSeam: { unit: 'deviations', pass: 3, warn: 6 },
  cycleDrift: { unit: 'dB', pass: 1, warn: 3 },
};

/** The verdict of `value` for metric `name`. */
export function verdictOf(name: MetricName, value: number): Exclude<Verdict, 'not-applicable'> {
  const threshold = THRESHOLDS[name];
  if (value <= threshold.pass) return 'pass';
  return value <= threshold.warn ? 'warn' : 'fail';
}

/** How bad each verdict is, worst highest; not applicable is no worse than a pass. */
const SEVERITY: Readonly<Record<Verdict, number>> = {
  'not-applicable': 0,
  pass: 1,
  warn: 2,
  fail: 3,
};

/** The worse of two verdicts. */
function worseVerdict(a: Verdict, b: Verdict): Verdict {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

/** The worst of `verdicts`, read as a loop's verdict: a loop with nothing applicable passes. */
export function worstVerdict(verdicts: readonly Verdict[]): Exclude<Verdict, 'not-applicable'> {
  let worst: Verdict = 'pass';
  for (const verdict of verdicts) worst = worseVerdict(worst, verdict);
  return worst === 'not-applicable' ? 'pass' : worst;
}

/** One channel's reading of a metric, or why it has none. */
export type ChannelReading =
  | { readonly value: number; readonly reference?: SeamReference }
  | { readonly notApplicable: string };

/** Metric `name` not applicable, for `reason`. */
export function notApplicable(name: MetricName, reason: string): LoopMetric {
  return {
    value: 0,
    unit: THRESHOLDS[name].unit,
    verdict: 'not-applicable',
    channel: undefined,
    reason,
  };
}

/** Metric `name` of a single value covering every channel, such as a ratio over them. */
export function wholeMetric(
  name: MetricName,
  value: number,
  reference?: SeamReference,
): LoopMetric {
  return {
    value,
    unit: THRESHOLDS[name].unit,
    verdict: verdictOf(name, value),
    channel: undefined,
    ...(reference === undefined ? {} : { reference }),
  };
}

/**
 * Metric `name` from each channel's reading: the worst channel's, or not
 * applicable, with the first channel's reason, where no channel has a value.
 */
export function worstChannel(name: MetricName, readings: readonly ChannelReading[]): LoopMetric {
  let worst:
    | { readonly index: number; readonly value: number; readonly reference?: SeamReference }
    | undefined;
  let reason: string | undefined;
  readings.forEach((reading, index) => {
    if ('notApplicable' in reading) {
      reason ??= reading.notApplicable;
      return;
    }
    if (worst === undefined || reading.value > worst.value) {
      worst = {
        index,
        value: reading.value,
        ...(reading.reference === undefined ? {} : { reference: reading.reference }),
      };
    }
  });
  if (worst === undefined)
    return notApplicable(name, reason ?? 'The loop has no channel to measure.');
  return {
    value: worst.value,
    unit: THRESHOLDS[name].unit,
    verdict: verdictOf(name, worst.value),
    channel: worst.index,
    ...(worst.reference === undefined ? {} : { reference: worst.reference }),
  };
}
