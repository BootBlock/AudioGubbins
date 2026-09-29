/**
 * What the main thread asks a render worker for, and what it is told back.
 *
 * A render job as the engine states it (`RenderJob`), less what cannot cross
 * a thread: the sources are described rather than bound, and the sinks stay
 * with the caller, who is written each chunk as it arrives.
 */

import type { SampleRate } from '@audiogubbins/domain';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';
import type {
  CancellationSignal,
  DspImplementation,
  JobPriority,
  RenderProgress,
  RenderQualityProfile,
  RenderRange,
  RenderSink,
  RenderSummary,
} from '@audiogubbins/audio-engine';

import type { SourceDescription } from '../protocol/source-descriptions.js';

/** A render the main thread asks for: a render job, with its sources described. */
export interface RenderRequest {
  readonly graph: GraphDescriptor;
  readonly sampleRate: SampleRate;
  readonly range: RenderRange;
  readonly chunkFrames: number;
  readonly quality: RenderQualityProfile;
  /**
   * Each graph input's audio. A recorded source's arrays are transferred to
   * the worker, not copied, so the caller loses them, and every other view of
   * the same buffers, once the render starts: a long clip is then held once,
   * by the worker. A caller that still needs the audio passes a copy.
   */
  readonly sources: readonly SourceDescription[];
}

/** How a render is run and where its audio goes. */
export interface RenderRunOptions {
  readonly priority: JobPriority;
  readonly signal?: CancellationSignal;
  readonly onProgress?: (progress: RenderProgress) => void;
  /** Where each sink's audio is written, by node. Every sink of the graph is bound. */
  readonly sinks: ReadonlyMap<NodeId, RenderSink>;
}

/** What a render in a worker did, and the DSP it ran on. */
export interface WorkerRenderSummary extends RenderSummary {
  readonly dsp: DspImplementation;
  /** Why the reference path ran, when it did (ADR-0031). */
  readonly dspFallbackReason: string | undefined;
}
