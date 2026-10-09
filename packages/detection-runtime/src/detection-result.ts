/**
 * What a detection answers (ADR-0062): for each assistant run, its
 * recommendation over the findings of its detectors, and, for each step of
 * that recommendation, the state the step's processor learned from the
 * stretch the treatment names, so applying it needs nothing read again.
 *
 * Plain data, so it crosses a thread as a structured clone and is kept for
 * the operation's life. Every range in it counts frames of the source the
 * detection was asked to read, from that source's first frame. A detector's
 * findings have no bound, a click a millisecond over an hour among them, so a
 * report carries the first {@link MOST_FINDINGS_SHOWN} of each kind and says
 * how many there were; its recommendation was made from all of them.
 */

import type { FindingKind, ProcessorState, Recommendation } from '@audiogubbins/domain';

/**
 * The most findings of one kind a report carries, the first in time order:
 * enough to see where a fault falls and how it is spread, and few enough to
 * send to the page, keep among its results and list in a panel.
 */
export const MOST_FINDINGS_SHOWN = 200;

/** How many findings of one kind there are. */
export interface KindCount {
  readonly kind: FindingKind;
  readonly count: number;
}

/** What a step of a recommendation learned. */
export type LearnedState =
  /** Its processor reads no state. */
  | { readonly kind: 'none' }
  | { readonly kind: 'learned'; readonly state: ProcessorState }
  /** It needs state that could not be learned, and why, so it cannot be applied. */
  | { readonly kind: 'refused'; readonly reason: string };

/** One assistant's answer. */
export interface AssistantReport {
  /** The assistant's British-English label, for its view. */
  readonly label: string;
  /**
   * What it recommends, made from every finding, holding the first
   * {@link MOST_FINDINGS_SHOWN} findings of each kind.
   */
  readonly recommendation: Recommendation;
  /** For each of the recommendation's steps, in their order, what it learned. */
  readonly learned: readonly LearnedState[];
  /** How many findings of each kind it weighed, in the order the kinds were first found. */
  readonly found: readonly KindCount[];
  /** For each of the recommendation's steps, in their order, how many of each kind it treats. */
  readonly treated: readonly (readonly KindCount[])[];
}

/** What a detection found and recommends. */
export interface DetectionResult {
  /** The frames heard, from the start of the range read. */
  readonly frames: number;
  /** Each assistant's answer, in the order the assistants were asked for. */
  readonly reports: readonly AssistantReport[];
}
