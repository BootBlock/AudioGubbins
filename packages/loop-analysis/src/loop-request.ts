/**
 * What a loop analysis is asked (ADR-0103): the region's loop as it is placed,
 * in region frames, and whether to search for better boundaries.
 *
 * The request is checked once against the region it is read from, here, so
 * every later step reads a loop it knows lies inside the region and a search it
 * knows is bounded.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainResult,
  type FadeShape,
  type SampleRate,
} from '@audiogubbins/domain';

/** How a search for better boundaries is bounded. */
export interface LoopSearch {
  /** How far either boundary may move, in frames: 20 ms by default, at most 2 s. */
  readonly radiusFrames: number;
  /** Whether a candidate keeps the loop's length, moving both boundaries together. */
  readonly keepLength: boolean;
  /** How many candidates to return, 1 to 16; 5 by default. */
  readonly candidates: number;
}

/** The loop being analysed, as the region's plan places it. */
export interface AnalysedLoop {
  /** Where playback returns to, in region frames. */
  readonly start: number;
  /** The first frame after the loop, where playback jumps back from, in region frames. */
  readonly end: number;
  /** The frames its crossfade spans, or zero for a hard join. */
  readonly crossfadeLength: number;
  readonly crossfadeShape: FadeShape;
}

/** A loop analysis's question. */
export interface LoopAnalysisRequest {
  readonly loop: AnalysedLoop;
  /** Search for candidate boundaries; absent to measure the loop alone. */
  readonly search?: LoopSearch;
}

/** The fewest frames a loop is analysed with: shorter, no seam metric has a sample to stand on. */
export const SHORTEST_LOOP_FRAMES = 16;

/** The search radius when none is chosen, in seconds. */
const DEFAULT_RADIUS_SECONDS = 0.02;

/** The widest search radius, in seconds. */
const WIDEST_RADIUS_SECONDS = 2;

/** The candidates a search returns when none is chosen, and the most it returns. */
const DEFAULT_CANDIDATES = 5;
export const MOST_CANDIDATES = 16;

/** The search a person gets without choosing: 20 ms either way, the length free, five candidates. */
export function defaultLoopSearch(sampleRate: SampleRate): LoopSearch {
  return {
    radiusFrames: Math.max(1, Math.round(DEFAULT_RADIUS_SECONDS * sampleRate)),
    keepLength: false,
    candidates: DEFAULT_CANDIDATES,
  };
}

/** The widest radius a search may take at `sampleRate`, in frames. */
export function widestRadiusFrames(sampleRate: SampleRate): number {
  return Math.round(WIDEST_RADIUS_SECONDS * sampleRate);
}

function refused(
  code: string,
  summary: string,
  details: Record<string, number>,
): DomainResult<never> {
  return fail(failure(code, FailureKind.Rejected, summary, { details }));
}

/** Why `loop` cannot be analysed in a region of `regionLength` frames, or `undefined` where it can. */
function loopProblem(loop: AnalysedLoop, regionLength: number): DomainResult<never> | undefined {
  const { start, end, crossfadeLength } = loop;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end > regionLength ||
    start >= end
  ) {
    return refused(
      'loop.outside-region',
      'A loop is analysed only where its start comes before its end, both inside the region.',
      { start, end, regionLength },
    );
  }
  if (end - start < SHORTEST_LOOP_FRAMES) {
    return refused(
      'loop.too-short',
      `A loop shorter than ${String(SHORTEST_LOOP_FRAMES)} frames has too few frames to measure.`,
      { frames: end - start },
    );
  }
  if (
    !Number.isSafeInteger(crossfadeLength) ||
    crossfadeLength < 0 ||
    crossfadeLength > Math.min(start, end - start)
  ) {
    // A placed loop's crossfade is clamped to the audio before its start and to
    // the loop, so one beyond either did not come from a region's plan.
    return refused(
      'loop.crossfade-without-lead',
      "A loop's crossfade spans at most the audio before its start and the loop itself.",
      { crossfadeLength, start, length: end - start },
    );
  }
  return undefined;
}

/** Why `search` cannot run at `sampleRate`, or `undefined` where it can. */
function searchProblem(
  search: LoopSearch,
  sampleRate: SampleRate,
): DomainResult<never> | undefined {
  const radius = search.radiusFrames;
  if (!Number.isSafeInteger(radius) || radius < 1 || radius > widestRadiusFrames(sampleRate)) {
    return refused(
      'loop.search-radius-invalid',
      'A search moves each boundary by at least one frame and at most two seconds.',
      { radiusFrames: radius, widest: widestRadiusFrames(sampleRate) },
    );
  }
  if (
    !Number.isSafeInteger(search.candidates) ||
    search.candidates < 1 ||
    search.candidates > MOST_CANDIDATES
  ) {
    return refused(
      'loop.search-candidates-invalid',
      `A search returns from 1 to ${String(MOST_CANDIDATES)} candidates.`,
      { candidates: search.candidates },
    );
  }
  return undefined;
}

/** `request` checked against a region of `regionLength` frames at `sampleRate`. */
export function checkLoopRequest(
  request: LoopAnalysisRequest,
  regionLength: number,
  sampleRate: SampleRate,
): DomainResult<LoopAnalysisRequest> {
  return (
    loopProblem(request.loop, regionLength) ??
    (request.search === undefined ? undefined : searchProblem(request.search, sampleRate)) ??
    succeed(request)
  );
}
