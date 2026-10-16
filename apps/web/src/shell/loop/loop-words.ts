/**
 * The words the Loop panel shows a loop's analysis in (ADR-0103): what each
 * check measures, its verdict as a word, its value and threshold in its unit,
 * the audio it compared the seam with, and how a candidate and its suggested
 * crossfade read. A verdict is always a word, never a colour alone.
 */

import type { FadeShape } from '@audiogubbins/domain';
import {
  metricThreshold,
  type CrossfadeSuitability,
  type LoopCandidate,
  type LoopMetric,
  type LoopMetrics,
  type MetricName,
  type MetricUnit,
  type SeamReference,
  type Verdict,
} from '@audiogubbins/loop-analysis';
import { counted } from '@audiogubbins/text';

import { FADE_SHAPE_NAMES } from '../inspector/edit-words.js';

const FIGURES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const PRECISE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const PERCENT = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 });
const MILLISECONDS = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

/** A number with the typographic minus, which a screen reader says as "minus". */
function signed(text: string): string {
  return text.replace('-', '−');
}

/** A verdict, as a word that stands without its colour. */
export const VERDICT_WORDS: Readonly<Record<Verdict, string>> = {
  pass: 'Passes',
  warn: 'Warning',
  fail: 'Fails',
  'not-applicable': 'Not applicable',
};

/** What a seam metric compared the loop's seam with. */
const REFERENCE_WORDS: Readonly<Record<SeamReference, string>> = {
  'post-end': 'the audio after the loop’s end',
  'pre-start': 'the audio before the loop’s start',
  adjacent: 'the loop’s own end and start',
};

/** `value` in `unit`, as a reader reads it. */
function valueWords(value: number, unit: MetricUnit): string {
  switch (unit) {
    case 'deviations':
      return `${PRECISE.format(value)} deviations`;
    case 'dBFS':
      return `${signed(FIGURES.format(value))} dBFS`;
    case 'dB':
      return `${PRECISE.format(value)} dB`;
    case 'degrees':
      return `${FIGURES.format(value)}°`;
    case 'frames':
      return counted(value, 'frame', 'frames');
    case 'ratio':
      return `${PERCENT.format(value)} of channels`;
  }
}

/** Where metric `name`'s verdict changes, as a reader reads it. */
function thresholdWords(name: MetricName): string {
  const { unit, pass, warn } = metricThreshold(name);
  const passes = `passes at ${valueWords(pass, unit)} or less`;
  return Number.isFinite(warn)
    ? `${passes}, warns to ${valueWords(warn, unit)}, fails above`
    : `${passes}, warns above`;
}

/** One check of a loop, as the panel lists it. */
export interface CheckRow {
  readonly key: string;
  /** What it measures. */
  readonly label: string;
  readonly verdict: Verdict;
  /** Its value, or why it was not measured. */
  readonly value: string;
  readonly threshold: string;
  /** The audio the seam was compared with, where it says. */
  readonly reference: string | undefined;
  /** The worst channel, by its name, where one was. */
  readonly channel: string | undefined;
}

/** A check of a metric of the table. */
function metricRow(
  key: string,
  label: string,
  name: MetricName,
  metric: LoopMetric,
  channels: readonly string[],
): CheckRow {
  return {
    key,
    label,
    verdict: metric.verdict,
    value:
      metric.verdict === 'not-applicable'
        ? (metric.reason ?? 'Not measured.')
        : valueWords(metric.value, metric.unit),
    threshold: thresholdWords(name),
    reference: metric.reference === undefined ? undefined : REFERENCE_WORDS[metric.reference],
    channel:
      metric.channel === undefined
        ? undefined
        : (channels[metric.channel] ?? `Channel ${String(metric.channel + 1)}`),
  };
}

/** Each seam check: its key, what it measures, its row of the thresholds, and where it is read. */
const SEAM_CHECKS: readonly (readonly [
  key: string,
  label: string,
  name: MetricName,
  read: (metrics: LoopMetrics) => LoopMetric,
])[] = [
  ['discontinuity', 'Click at the seam', 'discontinuity', (m) => m.discontinuity],
  ['dc-mismatch', 'DC offset across the seam', 'dcMismatch', (m) => m.dcMismatch],
  ['net-dc', 'DC offset over the loop', 'netDc', (m) => m.netDc],
  ['level', 'Level jump at the seam', 'levelMismatch', (m) => m.levelMismatch],
  ['phase', 'Phase jump at the seam', 'phaseMismatch', (m) => m.phaseMismatch],
  ['spectral', 'Change of tone at the seam', 'spectralMismatch', (m) => m.spectralMismatch],
  [
    'zero-start',
    'Start’s distance from a zero crossing',
    'zeroCrossing',
    (m) => m.zeroCrossing.start,
  ],
  ['zero-end', 'End’s distance from a zero crossing', 'zeroCrossing', (m) => m.zeroCrossing.end],
  [
    'zero-signs',
    'Channels changing sign across the seam',
    'zeroCrossingSigns',
    (m) => m.zeroCrossing.signs,
  ],
  ['cycle-seam', 'Level at the seam against the loop’s', 'cycleSeam', (m) => m.cycleStability.seam],
  ['cycle-drift', 'Level drift over the loop', 'cycleDrift', (m) => m.cycleStability.drift],
];

/**
 * Whether a seam or cycle-stability check of `metrics` warns or fails: the
 * checks a loop's processing can upset (ADR-0107), the crossfade's apart.
 */
export function seamFaulted(metrics: LoopMetrics): boolean {
  return SEAM_CHECKS.some(([, , , read]) => {
    const { verdict } = read(metrics);
    return verdict === 'warn' || verdict === 'fail';
  });
}

/** The crossfade's check, where the loop has one. */
function crossfadeRow(crossfade: CrossfadeSuitability): CheckRow {
  return {
    key: 'crossfade',
    label: `Crossfade’s level change, best ${shapeWords(crossfade.shape)}`,
    verdict: crossfade.verdict,
    value: `${valueWords(crossfade.levelChangeDb, 'dB')}, correlation ${signed(PRECISE.format(crossfade.correlation))}`,
    threshold: thresholdWords('crossfade'),
    // Measured on the region without its crossfade, across the two spans it joins.
    reference: 'the audio the crossfade joins, without it',
    channel: undefined,
  };
}

/** Every check of `metrics`, in the order the plan's table lists them; `channels` names each channel. */
export function checkRows(metrics: LoopMetrics, channels: readonly string[]): readonly CheckRow[] {
  const rows = SEAM_CHECKS.map(([key, label, name, read]) =>
    metricRow(key, label, name, read(metrics), channels),
  );
  return metrics.crossfade === undefined ? rows : [...rows, crossfadeRow(metrics.crossfade)];
}

/** A fade shape's name, as a reader reads it. */
export function shapeWords(shape: FadeShape): string {
  return (FADE_SHAPE_NAMES.get(shape) ?? shape).toLowerCase();
}

/** `frames` at `sampleRate` in milliseconds, as a reader reads a short span. */
export function millisecondsWords(frames: number, sampleRate: number): string {
  return `${MILLISECONDS.format((frames * 1000) / sampleRate)} ms`;
}

/** How far a boundary moved, in frames, later positive. */
function movedWords(frames: number): string {
  if (frames === 0) return 'unmoved';
  const by = counted(Math.abs(frames), 'frame', 'frames');
  return frames > 0 ? `${by} later` : `${by} earlier`;
}

/** How a candidate moves the loop, in words. */
export function candidateMoveWords(candidate: LoopCandidate): string {
  const moved = `Start ${movedWords(candidate.moved.start)}, end ${movedWords(candidate.moved.end)}`;
  return candidate.makesRoomForCrossfade
    ? `${moved}; it moves the start to make room for a crossfade`
    : moved;
}

/** The crossfade suggested for a candidate, in words. */
export function suggestionWords(candidate: LoopCandidate, sampleRate: number): string {
  const { crossfade } = candidate;
  return crossfade === undefined
    ? 'None needed: its seam passes without one.'
    : `${millisecondsWords(crossfade.lengthFrames, sampleRate)}, ${shapeWords(crossfade.shape)}`;
}
