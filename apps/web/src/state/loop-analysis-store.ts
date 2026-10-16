/**
 * The loop analyses of the session (ADR-0103, ADR-0106): for each region a
 * person asked about, the analysis of its loop, running, answered or failed,
 * kept for the Loop panel and for the commands that apply or audition what it
 * found.
 *
 * An analysis is derived from audio and reproducible from the region's plan,
 * so it is the session's and is never saved (C15): what persists is the loop
 * the person chooses from it, which only a region command writes. Each is kept
 * with what it was asked of: the region's sound with its loop's crossfade and
 * without it, and the loop itself, written out whole; the request; and the
 * analysis's version. So a reader tells when an edit since has made it stale;
 * undoing the edit makes it current again.
 */

import type { LoopAnalysis, LoopAnalysisRequest } from '@audiogubbins/loop-analysis';

import { observable, type Observable } from './observable.js';

/** What an analysis of a region's loop was asked of. */
export interface LoopAsked {
  /** The region, by its identity in the project. */
  readonly region: string;
  /** What it was called when asked, for what is said of it. */
  readonly name: string;
  /** The region's sound with and without its loop's crossfade, and its loop (`loopIdentity`). */
  readonly identity: string;
  readonly request: LoopAnalysisRequest;
  /** The version of the analysis it ran, which a change to a metric or the search raises. */
  readonly version: number;
}

/** A loop analysis of the session. */
export type LoopAnalysisRecord =
  | (LoopAsked & {
      readonly kind: 'running';
      /** Its work done and in all, in frames' worth. */
      readonly done: number;
      readonly total: number;
    })
  | (LoopAsked & { readonly kind: 'done'; readonly analysis: LoopAnalysis })
  | (LoopAsked & { readonly kind: 'failed'; readonly reason: string });

/** The loop analyses of the session, by the region each is of. */
export type LoopAnalyses = ReadonlyMap<string, LoopAnalysisRecord>;

/** The session's loop analyses, which the analysis control writes and everything else reads. */
export interface LoopAnalysisStore extends Observable<LoopAnalyses> {
  /** The analysis of `region`, if one was asked for this session. */
  readonly of: (region: string) => LoopAnalysisRecord | undefined;
  /** Keeps `record` as its region's, in place of the one it had. */
  readonly put: (record: LoopAnalysisRecord) => void;
  /** Forgets the analysis of `region`. */
  readonly forget: (region: string) => void;
}

/**
 * Whether `record` is of the region's sound as `identity` writes it now, by
 * the analysis this build runs, so what it found holds of the loop as heard.
 */
export function isCurrent(record: LoopAsked, identity: string, version: number): boolean {
  return record.identity === identity && record.version === version;
}

/** Makes the session's store of loop analyses, empty. */
export function createLoopAnalysisStore(): LoopAnalysisStore {
  const analyses = observable<LoopAnalyses>(new Map());
  return {
    get: analyses.get,
    subscribe: analyses.subscribe,
    of: (region) => analyses.get().get(region),
    put: (record) => {
      analyses.update((current) => new Map([...current, [record.region, record]]));
    },
    forget: (region) => {
      analyses.update((current) => {
        if (!current.has(region)) return current;
        const next = new Map(current);
        next.delete(region);
        return next;
      });
    },
  };
}
