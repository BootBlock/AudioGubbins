/**
 * One loop analysis in the detection worker (ADR-0103): a region's loop
 * measured, and on request better boundaries searched for, over the region's
 * audio read twice through the engine, with its loop's crossfade (`heard`) and
 * without it (`plain`).
 *
 * The analysis answers a value and applies nothing: the region's loop is the
 * project's, moved only by a command the person runs, so an analysis that is
 * refused, fails or is cancelled leaves it as it was. The worker answers every
 * job's cancellation one way, by the signal's reason thrown, so the analysis's
 * own answer to one, a failure, is turned into that here; every other refusal
 * it makes is its answer.
 */

import type { PcmSource } from '@audiogubbins/audio-engine';
import { throwIfCancelled, type DomainResult } from '@audiogubbins/domain';
import {
  analyseLoop,
  type LoopAnalysis,
  type LoopAnalysisRequest,
  type LoopTools,
} from '@audiogubbins/loop-analysis';

/** A region's audio as a loop analysis reads it. */
export interface LoopAudio {
  /** With its loop's crossfade, as the region's plan realises it. */
  readonly heard: PcmSource;
  /** Without it. */
  readonly plain: PcmSource;
}

/**
 * The analysis `request` asks for of the region `audio` is, or why there is
 * none. A cancellation is thrown, as the signal's reason.
 */
export async function runLoopAnalysis(
  audio: LoopAudio,
  request: LoopAnalysisRequest,
  tools: LoopTools,
): Promise<DomainResult<LoopAnalysis>> {
  const analysed = await analyseLoop(audio.heard, audio.plain, request, tools);
  if (!analysed.ok) throwIfCancelled(tools.signal);
  return analysed;
}
