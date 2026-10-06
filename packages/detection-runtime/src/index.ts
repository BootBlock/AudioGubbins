/**
 * The public contract of the AudioGubbins detection worker (ADR-0061,
 * ADR-0062): the page's end of the worker that reads a target's processed
 * audio once, runs the assistants' detectors over it and answers what they
 * found and recommend, with the results kept for the operation's life.
 *
 * The worker itself is a thread entry, `threads/detection-worker.ts`, which
 * the application's bundler builds on its own. Everything absent from this
 * list is internal and may change without being a contract change
 * (REQ-REPO-186).
 */

export {
  DetectionHost,
  type DetectionOutcome,
  type DetectionSubject,
  type DetectionWatch,
  type DetectionWorkerPort,
} from './detection-host.js';
export { ToDetectionWorkerKind, type ToDetectionWorker } from './detection-messages.js';
export {
  type AssistantReport,
  type DetectionResult,
  type LearnedState,
} from './detection-result.js';
