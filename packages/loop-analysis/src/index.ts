/**
 * The public contract of @audiogubbins/loop-analysis (ADR-0100, ADR-0103).
 *
 * Seamless-loop analysis over a region's audio, read through the sources it is
 * given in bounded chunks: the seam's metrics with their verdicts, the search
 * for candidate boundaries with the micro-crossfades that make them pass, and
 * the plans that audition a loop by cycling it. It runs in the detection
 * worker, returns values and applies nothing.
 */

export {
  LOOP_ANALYSIS_VERSION,
  type LoopAnalysis,
  type LoopTools,
  analyseLoop,
} from './analyse-loop.js';
export {
  type AnalysedLoop,
  type LoopAnalysisRequest,
  type LoopSearch,
  MOST_CANDIDATES,
  SHORTEST_LOOP_FRAMES,
  defaultLoopSearch,
  widestRadiusFrames,
} from './loop-request.js';
export { type LoopCandidate } from './candidate-search.js';
export { type SuggestedCrossfade } from './micro-crossfade.js';
export { type CrossfadeSuitability } from './crossfade-suitability.js';
export { type LoopMetrics } from './seam-metrics.js';
export { type LoopMetric, type MetricUnit, type SeamReference, type Verdict } from './verdicts.js';
export {
  type LoopAudition,
  type LoopAuditionMode,
  extendedAuditionPlan,
  loopAuditionPlan,
} from './audition-plans.js';
