/**
 * The search for better loop boundaries (ADR-0103, the plan's candidate
 * search), over the region without its loop's crossfade, since the crossfade
 * belongs to the points being moved.
 *
 * One streamed pass keeps what every pair needs (`loop-capture.ts`); the pairs
 * are found (`candidate-pairs.ts`), measured by the same rules as the loop
 * itself (`seam-metrics.ts`), costed and ordered (`candidate-cost.ts`); a
 * returned candidate whose seam does not pass is offered the shortest
 * micro-crossfade that makes it pass (`micro-crossfade.ts`); and a loop with
 * too little audio before its start for any crossfade is also offered the
 * candidate that moves its start forward by the crossfade's length, keeping the
 * audio before it as an intro.
 */

import { throwIfCancelled, type SampleRate } from '@audiogubbins/domain';
import type { PcmSource } from '@audiogubbins/audio-engine';

import { byCost, candidateCost } from './candidate-cost.js';
import {
  MOST_PAIRS,
  correlatedPairs,
  keptLengthPairs,
  startAnchors,
  type BoundaryPair,
  type SearchBounds,
} from './candidate-pairs.js';
import { driftSpan } from './cycle-stability.js';
import { captureLoop, type CaptureRequest, type LoopCapture } from './loop-capture.js';
import type { AnalysedLoop, LoopSearch } from './loop-request.js';
import {
  analysisWindow,
  envelopeCellFrames,
  longestMicroCrossfade,
  measuringMargin,
  type SeamPlace,
} from './loop-windows.js';
import type { MeasuringKit } from './measuring-kit.js';
import {
  crossfadeFits,
  microCrossfadeLengths,
  passingShape,
  suggestCrossfade,
  type SuggestedCrossfade,
} from './micro-crossfade.js';
import { measurePair, type LoopMetrics, type PairMeasurement } from './seam-metrics.js';
import type { ReadingTools } from './source-reading.js';

/** A pair of loop boundaries a search suggests. */
export interface LoopCandidate {
  /** Its place in the list, from 1. */
  readonly rank: number;
  readonly start: number;
  /** The first frame after the loop, in region frames. */
  readonly end: number;
  /** How far each boundary moved from the loop's, in frames, later positive. */
  readonly moved: { readonly start: number; readonly end: number };
  readonly cost: number;
  /** Measured without a crossfade. */
  readonly metrics: LoopMetrics;
  /** The shortest crossfade that makes its seam pass, where its seam does not pass alone. */
  readonly crossfade: SuggestedCrossfade | undefined;
  /** Whether it moves the loop's start forward to make room for its crossfade, the audio before kept as an intro. */
  readonly makesRoomForCrossfade: boolean;
}

/** What a search runs with, apart from the audio. */
export interface SearchTools extends ReadingTools {
  /** Told of each chunk the pass reads, by its frames. */
  readonly onFrames: (frames: number) => void;
  /** Told of each pair measured. */
  readonly onPair: () => void;
}

/** What one pair's measurement leaves to be ordered. */
interface Measured {
  readonly pair: BoundaryPair;
  readonly measurement: PairMeasurement;
  readonly cost: number;
  readonly distance: number;
  readonly start: number;
  readonly end: number;
}

/** The pass a search over `loop` makes. */
export function searchCapture(
  loop: AnalysedLoop,
  search: LoopSearch,
  regionLength: number,
  sampleRate: SampleRate,
): CaptureRequest {
  const length = loop.end - loop.start;
  const window = analysisWindow(sampleRate, length);
  const startReach = longestMicroCrossfade(sampleRate);
  return {
    start: loop.start,
    end: loop.end,
    regionLength,
    radius: search.radiusFrames,
    margin: measuringMargin(sampleRate, window),
    envelopeCell: envelopeCellFrames(sampleRate),
    driftReach: driftSpan(sampleRate, length + 2 * search.radiusFrames) + startReach,
    startReach,
  };
}

/** The place of a pair of boundaries in a region of `regionLength`, with its own window. */
function placeOf(pair: BoundaryPair, regionLength: number, sampleRate: SampleRate): SeamPlace {
  return {
    start: pair.start,
    end: pair.end,
    regionLength,
    window: analysisWindow(sampleRate, pair.end - pair.start),
  };
}

/** Whether a candidate's seam needs a crossfade: its discontinuity or phase does not pass. */
function needsCrossfade(metrics: LoopMetrics): boolean {
  const failing = (verdict: string): boolean => verdict === 'warn' || verdict === 'fail';
  return failing(metrics.discontinuity.verdict) || failing(metrics.phaseMismatch.verdict);
}

/** The pairs a search measures. */
function pairsOf(
  capture: LoopCapture,
  kit: MeasuringKit,
  bounds: SearchBounds,
): readonly BoundaryPair[] {
  const pairs = bounds.keepLength
    ? keptLengthPairs(capture, bounds)
    : correlatedPairs(capture, kit, bounds, startAnchors(capture, bounds));
  return pairs.slice(0, MOST_PAIRS);
}

/**
 * The candidate that moves the start of a loop with too little audio before it
 * for any crossfade forward by the shortest crossfade that then passes.
 */
function roomForCrossfade(
  capture: LoopCapture,
  kit: MeasuringKit,
  loop: AnalysedLoop,
  radius: number,
  lengths: readonly number[],
): { readonly measured: Measured; readonly crossfade: SuggestedCrossfade } | undefined {
  if (lengths.some((length) => length <= loop.start)) return undefined;
  for (const length of lengths) {
    const pair = { start: loop.start + length, end: loop.end };
    const place = placeOf(pair, capture.regionLength, capture.sampleRate);
    if (!crossfadeFits(place, length)) continue;
    const crossfade = passingShape(capture, kit, place, length);
    if (crossfade === undefined) continue;
    const measurement = measurePair(capture, kit, place);
    return {
      measured: {
        pair,
        measurement,
        cost: candidateCost(measurement.metrics, length, radius),
        distance: length,
        start: pair.start,
        end: pair.end,
      },
      crossfade,
    };
  }
  return undefined;
}

/** A measured pair as it is offered, with the crossfade it takes. */
interface Offered {
  readonly candidate: Measured;
  readonly crossfade: SuggestedCrossfade | undefined;
  readonly makesRoomForCrossfade: boolean;
}

/** Every pair a search finds, measured and costed, the host given its turn after each. */
async function measuredPairs(
  capture: LoopCapture,
  kit: MeasuringKit,
  loop: AnalysedLoop,
  search: LoopSearch,
  tools: SearchTools,
): Promise<Measured[]> {
  const { regionLength, sampleRate } = capture;
  const bounds: SearchBounds = {
    start: loop.start,
    end: loop.end,
    regionLength,
    radius: search.radiusFrames,
    keepLength: search.keepLength,
    window: analysisWindow(sampleRate, loop.end - loop.start),
  };
  const measured: Measured[] = [];
  for (const pair of pairsOf(capture, kit, bounds)) {
    const measurement = measurePair(capture, kit, placeOf(pair, regionLength, sampleRate));
    const distance = Math.abs(pair.start - loop.start) + Math.abs(pair.end - loop.end);
    measured.push({
      pair,
      measurement,
      cost: candidateCost(measurement.metrics, distance, search.radiusFrames),
      distance,
      start: pair.start,
      end: pair.end,
    });
    tools.onPair();
    await tools.yieldToHost();
    throwIfCancelled(tools.signal);
  }
  return measured;
}

/** `chosen` each with the micro-crossfade its seam needs, and the start moved to make room, where the loop has no lead. */
function offeredWithCrossfades(
  capture: LoopCapture,
  kit: MeasuringKit,
  loop: AnalysedLoop,
  radius: number,
  chosen: readonly Measured[],
): readonly Offered[] {
  const { regionLength, sampleRate } = capture;
  const offered: Offered[] = chosen.map((candidate) => ({
    candidate,
    crossfade: needsCrossfade(candidate.measurement.metrics)
      ? suggestCrossfade(
          capture,
          kit,
          placeOf(candidate.pair, regionLength, sampleRate),
          microCrossfadeLengths(sampleRate, candidate.measurement.dominantHertz),
        )
      : undefined,
    makesRoomForCrossfade: false,
  }));
  const loopPlace = placeOf(loop, regionLength, sampleRate);
  const lengths = microCrossfadeLengths(
    sampleRate,
    measurePair(capture, kit, loopPlace).dominantHertz,
  );
  const room = roomForCrossfade(capture, kit, loop, radius, lengths);
  if (
    room !== undefined &&
    !chosen.some(({ start, end }) => start === room.measured.start && end === room.measured.end)
  ) {
    offered.push({
      candidate: room.measured,
      crossfade: room.crossfade,
      makesRoomForCrossfade: true,
    });
  }
  return offered;
}

/** The candidates a search of `search` around `loop` finds in `plain`, best first. */
export async function searchCandidates(
  plain: PcmSource,
  loop: AnalysedLoop,
  search: LoopSearch,
  kit: MeasuringKit,
  tools: SearchTools,
): Promise<readonly LoopCandidate[]> {
  const request = searchCapture(loop, search, plain.length ?? 0, plain.sampleRate);
  const capture = await captureLoop(plain, request, tools, tools.onFrames);
  const measured = await measuredPairs(capture, kit, loop, search, tools);
  const chosen = measured.sort(byCost).slice(0, search.candidates);
  return [...offeredWithCrossfades(capture, kit, loop, search.radiusFrames, chosen)]
    .sort((a, b) => byCost(a.candidate, b.candidate))
    .map(({ candidate, crossfade, makesRoomForCrossfade }, index) => ({
      rank: index + 1,
      start: candidate.start,
      end: candidate.end,
      moved: { start: candidate.start - loop.start, end: candidate.end - loop.end },
      cost: candidate.cost,
      metrics: candidate.measurement.metrics,
      crossfade,
      makesRoomForCrossfade,
    }));
}
