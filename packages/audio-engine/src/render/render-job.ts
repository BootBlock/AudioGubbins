/**
 * A render job: what an offline render produces, from what, and how well.
 *
 * The job is the whole of a render's input, so the same job renders the same
 * bits on the same version (REQ-ARCH-049): the graph, the audio bound to each
 * of its inputs, the span to render, the rate it is rendered at, and the
 * quality mode. It names no thread and no browser, so a render worker and a
 * test run the same job.
 */

import type {
  CancellationSignal,
  QualityMode,
  SampleCount,
  SampleRate,
} from '@audiogubbins/domain';
import type { GraphDescriptor, NodeId } from '@audiogubbins/audio-graph';

import type { ResamplingQuality } from '../dsp/canonical-dsp.js';
import type { MeterTarget } from '../nodes/node-implementation.js';
import type { AudioFrameBlock } from '../pcm/frame-block.js';
import type { PcmSource } from '../pcm/pcm-source.js';

/** Where one sink's rendered audio is written, a chunk at a time. */
export interface RenderSink {
  /**
   * Writes the next chunk. The block is the renderer's and is overwritten by
   * the next chunk once the promise settles, so a sink that keeps audio
   * copies it.
   */
  write(block: AudioFrameBlock, signal?: CancellationSignal): Promise<void>;
}

/** The span of the timeline a render covers, in frames at the render's rate. */
export interface RenderRange {
  readonly start: SampleCount;
  readonly length: SampleCount;
}

/** Everything an offline render is made from. */
export interface RenderJob {
  readonly graph: GraphDescriptor;

  /** The rate the graph runs at and every sink is written at. */
  readonly sampleRate: SampleRate;

  /**
   * The audio each graph input reads, by node. A source at another rate is
   * converted to the render's rate explicitly, at the mode's resampling grade,
   * and the render's summary says so (REQ-ARCH-085).
   */
  readonly sources: ReadonlyMap<NodeId, PcmSource>;

  /** Where each sink's audio is written, by node. Every sink of the graph is bound. */
  readonly sinks: ReadonlyMap<NodeId, RenderSink>;

  /** Where each meter reports, by node; a meter left unbound measures nothing. */
  readonly meters?: ReadonlyMap<NodeId, MeterTarget>;
  readonly range: RenderRange;

  /**
   * The quality the render runs at (ADR-0061), `MAXIMUM_QUALITY` unless the
   * person chooses another (REQ-AUDIO-143). A conversion of rate takes the
   * grade of its final-render settings.
   */
  readonly quality: QualityMode;

  /** Frames rendered at a time, which bounds memory and never changes a bit of the output. */
  readonly chunkFrames: number;

  /**
   * The bytes each conversion may give its filter's table of coefficients,
   * from the memory the host measured as available, or `undefined` where it
   * could not tell. A table past it is not built, and that conversion computes
   * its taps as it goes, slower and with the same bits (REQ-ARCH-087).
   */
  readonly coefficientBudgetBytes?: number;
}

/** How far a render has got. */
export interface RenderProgress {
  readonly framesRendered: number;
  readonly framesTotal: number;
}

/** A source the render converted to its rate. */
export interface RenderConversion {
  readonly node: NodeId;
  readonly from: SampleRate;
  readonly to: SampleRate;
  readonly quality: ResamplingQuality;
}

/** What a finished render did. */
export interface RenderSummary {
  /** Frames written to each sink: the range's length. */
  readonly frames: SampleCount;

  /** The frames of latency trimmed from the start of each sink's audio, by node. */
  readonly latencyTrimmed: ReadonlyMap<NodeId, SampleCount>;
  readonly conversions: readonly RenderConversion[];
}

/** How a render reports and hands back control; none of it changes the audio. */
export interface RenderOptions {
  readonly signal?: CancellationSignal;
  readonly onProgress?: (progress: RenderProgress) => void;

  /**
   * Awaited between chunks, for a host whose thread must answer messages
   * while it renders, such as a worker that is asked to cancel.
   */
  readonly yieldToHost?: () => Promise<void>;
}
