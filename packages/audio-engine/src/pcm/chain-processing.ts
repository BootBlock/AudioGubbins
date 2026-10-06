/**
 * What the engine asks of whatever runs a chain of processors over a stream
 * of an edit plan (ADR-0060).
 *
 * A processed stream names its chain as a value; the engine reads the
 * stream's segments, and the port given here turns the chain into something
 * that processes them a block at a time. The port is the effect rack's, so
 * the engine depends on no processor: it is given one, as it is given the
 * canonical DSP. Preparing may read the whole stream first, since a processor
 * that measures its whole input (a loudness normalisation) needs a pass over
 * it before it can write anything.
 */

import type {
  CancellationSignal,
  ChannelLayout,
  DomainResult,
  EffectChain,
  ProcessorId,
  QualitySettings,
  SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';

/** Reads `frames` frames of a stream from frame `start` into `into`, one array per channel. */
export type StreamReader = (
  start: number,
  frames: number,
  into: readonly Float32Array[],
  signal?: CancellationSignal,
) => Promise<void>;

/** A chain to run over one stream, and what it runs with. */
export interface ChainRequest {
  readonly chain: EffectChain;
  /** The layout of the stream's segments, which the chain reads. */
  readonly input: ChannelLayout;
  readonly sampleRate: SampleRate;
  /** The frames the stream holds, which a measuring pass reads. */
  readonly length: number;
  readonly quality: QualitySettings;
  /** The most frames one call of {@link ChainRun.process} is given. */
  readonly blockFrames: number;
  readonly dsp: CanonicalDsp;
}

/** A chain running over a stream from its first frame. */
export interface ChainRun {
  /** Frames its output lags its input, which its reader trims. */
  readonly latency: number;
  /** The layout it writes. */
  readonly layout: ChannelLayout;

  /**
   * Frames it needs to settle when started part way through, for a preview:
   * the longest lead-in of any processor it runs.
   */
  readonly leadIn: number;

  /**
   * Frames a part-way start must fall a whole number of into the stream, so
   * every processor it runs frames its audio as a run from the start does:
   * the least common multiple of their frame grids.
   */
  readonly frameGrid: number;

  /** Processes the next `frames` frames, at most the request's block, from `input` into `output`. */
  process(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void;

  /** Changes a running numeric parameter of one processor, smoothed, or says why not. */
  setParameter(processor: ProcessorId, key: string, value: number): DomainResult<void>;

  release(): void;
}

/** What runs chains: the effect rack's realisation of a chain as the engine's graph. */
export interface ChainProcessing {
  /**
   * The run of a chain over the stream `read` reads, after any pass over it
   * that a processor measuring its whole input needs, or why it cannot run.
   */
  prepare(
    request: ChainRequest,
    read: StreamReader,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ChainRun>>;
}
