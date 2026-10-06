/**
 * What a detection answers (ADR-0062): for each assistant run, its
 * recommendation over the findings of its detectors, and, for each step of
 * that recommendation, the state the step's processor learned from the
 * stretch the treatment names, so applying it needs nothing read again.
 *
 * Plain data, so it crosses a thread as a structured clone and is kept for
 * the operation's life. Every range in it counts frames of the source the
 * detection was asked to read, from that source's first frame.
 */

import type { ProcessorState, Recommendation } from '@audiogubbins/domain';

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
  readonly recommendation: Recommendation;
  /** For each of the recommendation's steps, in their order, what it learned. */
  readonly learned: readonly LearnedState[];
}

/** What a detection found and recommends. */
export interface DetectionResult {
  /** The frames heard, from the start of the range read. */
  readonly frames: number;
  /** Each assistant's answer, in the order the assistants were asked for. */
  readonly reports: readonly AssistantReport[];
}
