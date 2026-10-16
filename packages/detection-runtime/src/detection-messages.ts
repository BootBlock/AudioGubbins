/**
 * The messages between the page and the detection worker.
 *
 * Each direction is one discriminated union, and each message is read field
 * by field on arrival (`detection-message-reading.ts`), so a malformed one is
 * refused with the field that was wrong rather than acted on. A job is one
 * piece of work, named by the page: a detection by the assistants, a loop
 * analysis (ADR-0103) or a loudness measurement. A target is what it reads, an
 * asset or a region, of which the worker runs one job of each kind at a time:
 * a request of a kind for a target cancels the one of that kind before it. The
 * page gives it a port to the preview worker once, which a racked sound is
 * read from a render through (ADR-0061).
 */

import type { DetectorValues, EditRange, QualityMode } from '@audiogubbins/domain';
import type { MessagePortLike, PcmDescription } from '@audiogubbins/audio-engine';
import type { LoopAnalysis, LoopAnalysisRequest } from '@audiogubbins/loop-analysis';

import type { DetectionResult } from './detection-result.js';
import type { LoudnessMeasurement } from './loudness-run.js';

/** What the page asks of the worker. */
export const ToDetectionWorkerKind = {
  /** Read a range of a source, run the assistants' detectors over it, and answer. */
  Detect: 'detect',
  /** Measure a region's loop, and on request search for better boundaries, and answer. */
  AnalyseLoop: 'analyse-loop',
  /** Measure the loudness and true peak of a range of a source, and answer. */
  MeasureLoudness: 'measure-loudness',
  /** Stop a job, queued or running, and answer nothing more for it. */
  Cancel: 'cancel',
  /** Read processed streams from the preview worker's renders, through the port given. */
  Previews: 'previews',
} as const;

/** Audio described for the worker, with the channels it is read in. */
export interface DescribedAudio {
  readonly channels: number;
  readonly description: PcmDescription;
}

/** A detection the page asks for. */
export interface DetectRequest {
  readonly kind: typeof ToDetectionWorkerKind.Detect;
  readonly job: string;
  /** What it analyses, one detection at a time. */
  readonly target: string;
  readonly channels: number;
  /** The audio, described as the render and the peaks describe it. */
  readonly description: PcmDescription;
  /**
   * The audio a recommended step learns its state from, and its channels,
   * where that is not {@link description}: the audio its processor will
   * receive (`detection-run.ts`).
   */
  readonly learning?: DescribedAudio;
  /** The quality an edited sound's chains run at: the final render's (ADR-0061). */
  readonly quality: QualityMode;
  /** The frames of the source to read. */
  readonly range: EditRange;
  /** The keys of the assistants to run, in the order their reports are answered. */
  readonly assistants: readonly string[];
  /** What a person set of how their detectors judge; anything not set is a default. */
  readonly detectors: DetectorValues;
}

/** A loop analysis the page asks for (ADR-0103). */
export interface AnalyseLoopRequest {
  readonly kind: typeof ToDetectionWorkerKind.AnalyseLoop;
  readonly job: string;
  /** The region whose loop it analyses, one loop analysis at a time. */
  readonly target: string;
  readonly channels: number;
  /** The region's audio with its loop's crossfade, as its plan realises it: the loop as heard. */
  readonly heard: PcmDescription;
  /** The region's audio without its loop's crossfade: what the crossfade and the candidates are measured on. */
  readonly plain: PcmDescription;
  /** The quality the region's chains run at: the final render's (ADR-0061). */
  readonly quality: QualityMode;
  readonly request: LoopAnalysisRequest;
}

/** A loudness measurement the page asks for. */
export interface MeasureLoudnessRequest {
  readonly kind: typeof ToDetectionWorkerKind.MeasureLoudness;
  readonly job: string;
  /** What it measures, one loudness measurement at a time. */
  readonly target: string;
  readonly channels: number;
  readonly description: PcmDescription;
  /** The quality an edited sound's chains run at: the final render's (ADR-0061). */
  readonly quality: QualityMode;
  /** The frames of the source to measure. */
  readonly range: EditRange;
}

/** A job the page asks the worker to do. */
export type WorkRequest = DetectRequest | AnalyseLoopRequest | MeasureLoudnessRequest;

export type ToDetectionWorker =
  | WorkRequest
  | { readonly kind: typeof ToDetectionWorkerKind.Cancel; readonly job: string }
  | {
      readonly kind: typeof ToDetectionWorkerKind.Previews;
      /** The worker's end of its channel to the preview worker, transferred. */
      readonly port: MessagePortLike;
    };

/** What the worker tells the page. */
export const FromDetectionWorkerKind = {
  /** How far a job has gone. */
  Progress: 'progress',
  /** A detection's answer. */
  Done: 'done',
  /** A loop analysis's answer. */
  LoopAnalysed: 'loop-analysed',
  /** A loudness measurement's answer. */
  LoudnessMeasured: 'loudness-measured',
  /** The job cannot be done, and why. */
  Failed: 'failed',
  Cancelled: 'cancelled',
  /** A message the worker could not read, which names no job it can answer. */
  Refused: 'refused',
} as const;

export type FromDetectionWorker =
  | {
      readonly kind: typeof FromDetectionWorkerKind.Progress;
      readonly job: string;
      /**
       * The frames read of the frames it reads; for a loop analysis, the work
       * done of all it does, each pair of boundaries measured counted at the
       * frames it measures.
       */
      readonly framesRead: number;
      readonly framesTotal: number;
    }
  | {
      readonly kind: typeof FromDetectionWorkerKind.Done;
      readonly job: string;
      readonly result: DetectionResult;
    }
  | {
      readonly kind: typeof FromDetectionWorkerKind.LoopAnalysed;
      readonly job: string;
      readonly analysis: LoopAnalysis;
    }
  | {
      readonly kind: typeof FromDetectionWorkerKind.LoudnessMeasured;
      readonly job: string;
      readonly measurement: LoudnessMeasurement;
    }
  | {
      readonly kind: typeof FromDetectionWorkerKind.Failed;
      readonly job: string;
      readonly reason: string;
    }
  | { readonly kind: typeof FromDetectionWorkerKind.Cancelled; readonly job: string }
  | { readonly kind: typeof FromDetectionWorkerKind.Refused; readonly reason: string };
