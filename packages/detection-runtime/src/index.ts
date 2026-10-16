/**
 * The public contract of the AudioGubbins detection worker (ADR-0061,
 * ADR-0062, ADR-0103): the page's end of the worker that reads a target's
 * processed audio once, runs the assistants' detectors over it and answers
 * what they found and recommend, analyses a region's loop, or measures a
 * target's loudness, with the answers kept for the operation's life; and the
 * rules that read an assistant's report for applying it.
 *
 * The worker itself is a thread entry, `threads/detection-worker.ts`, which
 * the application's bundler builds on its own. Everything absent from this
 * list is internal and may change without being a contract change
 * (REQ-REPO-186).
 */

export {
  DetectionHost,
  type DetectionOutcome,
  type DetectionWatch,
  type DetectionWorkerPort,
  type JobEnded,
  type LoopOutcome,
  type LoudnessOutcome,
} from './detection-host.js';
export { type DetectionSubject, type LoopSubject, type LoudnessSubject } from './job-subjects.js';
export { type LoudnessMeasurement } from './loudness-run.js';
export { ToDetectionWorkerKind, type ToDetectionWorker } from './detection-messages.js';
export {
  type AssistantReport,
  type DetectionResult,
  type KindCount,
  type LearnedState,
} from './detection-result.js';
export {
  type DetectionScope,
  SILENCE_PARTS,
  type SilencePart,
  learnedStates,
  silenceRemovals,
  treatmentPlacement,
} from './report-reading.js';
