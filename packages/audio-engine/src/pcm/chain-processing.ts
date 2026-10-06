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
 *
 * A run may start part way through the stream, as a preview does, and every
 * request says where: a processor that plays back what its pass made of the
 * whole stream (a machine-learning processor) must start playing at that
 * frame, which only the run can tell it. Where a preview may start, and
 * whether the chain can run as it is heard at all, is the chain's to say
 * before the run is made, so playback chooses between running it and hearing
 * a render of it first (ADR-0061).
 */

import type {
  CancellationSignal,
  ChannelLayout,
  DomainResult,
  EffectChain,
  ParameterId,
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

  /**
   * The frame of the stream the run's first {@link ChainRun.process} call is
   * given, from 0 to {@link length}: 0 for a run from the stream's start, and
   * a frame {@link ChainProcessing.listening} allows for a preview.
   */
  readonly start: number;
}

/** What how a chain is heard depends on: the chain, and the stream as it runs it. */
export type ListeningRequest = Pick<ChainRequest, 'chain' | 'input' | 'sampleRate' | 'quality'>;

/** How a run of a chain may start part way through a stream, for a preview. */
export interface PartWayStart {
  /** Frames it needs to settle: the longest lead-in of any processor it runs. */
  readonly leadIn: number;

  /**
   * Frames a part-way start must fall a whole number of into the stream, so
   * every processor it runs frames its audio as a run from the start does:
   * the least common multiple of their frame grids.
   */
  readonly frameGrid: number;
}

/**
 * How playback hears a chain: run as it plays, started part way after its
 * lead-in, or from a render of the whole stream made ahead, where a processor
 * it runs measures its whole input first or cannot keep to the audio thread's
 * schedule (ADR-0061). Either way the chain may be started part way, which a
 * reader that has no render to read falls back to.
 */
export type ChainListening =
  | { readonly kind: 'live'; readonly partWay: PartWayStart }
  | {
      readonly kind: 'rendered';
      readonly partWay: PartWayStart;
      /** Why it cannot run as it is heard, naming the processors, worded for the person. */
      readonly reason: string;
    };

/** A chain running over a stream from its request's start. */
export interface ChainRun {
  /** Frames its output lags its input, which its reader trims. */
  readonly latency: number;
  /** The layout it writes. */
  readonly layout: ChannelLayout;

  /** Processes the next `frames` frames, at most the request's block, from `input` into `output`. */
  process(input: readonly Float32Array[], output: readonly Float32Array[], frames: number): void;

  /**
   * Changes a running numeric parameter of one processor, smoothed by its
   * kernel from the next frame it is given, or says why its kernel cannot
   * take the change running.
   */
  setParameter(processor: ProcessorId, parameter: ParameterId, value: number): DomainResult<void>;

  release(): void;
}

/** What runs chains: the effect rack's realisation of a chain as the engine's graph. */
export interface ChainProcessing {
  /** How playback hears the chain and may start it part way, or why the chain cannot run. */
  listening(request: ListeningRequest): DomainResult<ChainListening>;

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
