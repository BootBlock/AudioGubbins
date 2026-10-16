/**
 * One cost over a candidate's metrics and how far it moved (the plan's
 * candidate search, steps 5 and 6), and the order candidates are offered in.
 *
 * The cost J is the sum of `discontinuity/4`, `levelMismatch/1`,
 * `spectralMismatch/1.5`, `phaseMismatch/15`, `10^((dcMismatch + 60)/20)`,
 * `cycleStability.seam/3` and `0.25 · (|S′ − S| + |E′ − E|) / R`: each metric
 * over the value at which it stops passing, so each counts one at its
 * threshold, the DC mismatch as a gain, since its dBFS fall without bound, and
 * a metric not applicable adding nothing. Ties fall to the smaller move, then
 * the earlier start, then the earlier end, so the same audio, settings and
 * algorithm version give the same list.
 */

import { decibelsToGain } from '@audiogubbins/audio-engine';

import type { LoopMetrics } from './seam-metrics.js';
import type { LoopMetric } from './verdicts.js';

/** What a metric adds: its value over `scale`, or nothing where it is not applicable. */
function term(metric: LoopMetric, scale: number): number {
  return metric.verdict === 'not-applicable' ? 0 : metric.value / scale;
}

/** The cost of a pair with `metrics`, moved `moved` frames in all over a search of radius `radius`. */
export function candidateCost(metrics: LoopMetrics, moved: number, radius: number): number {
  const dc =
    metrics.dcMismatch.verdict === 'not-applicable'
      ? 0
      : decibelsToGain(metrics.dcMismatch.value + 60);
  return (
    term(metrics.discontinuity, 4) +
    term(metrics.levelMismatch, 1) +
    term(metrics.spectralMismatch, 1.5) +
    term(metrics.phaseMismatch, 15) +
    dc +
    term(metrics.cycleStability.seam, 3) +
    (0.25 * moved) / radius
  );
}

/** What candidates are ordered by. */
export interface Ranked {
  readonly start: number;
  readonly end: number;
  readonly cost: number;
  /** |S′ − S| + |E′ − E|. */
  readonly distance: number;
}

/** The order candidates are offered in: by cost, then the smaller move, the earlier start, the earlier end. */
export function byCost(a: Ranked, b: Ranked): number {
  if (a.cost !== b.cost) return a.cost < b.cost ? -1 : 1;
  return a.distance - b.distance || a.start - b.start || a.end - b.end;
}
