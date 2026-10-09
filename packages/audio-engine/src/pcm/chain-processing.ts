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
  ChainListening,
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
   * given, from 0 to {@link ChainRequest.length}: 0 for a run from the
   * stream's start, and a frame {@link ChainProcessing.listening} allows for
   * a preview.
   */
  readonly start: number;
}

/**
 * A chain to run over a live input as it arrives, as monitoring hears an
 * input through one (ADR-0070): the request without the stream's length or a
 * start, since a live input has neither an end to measure to nor a frame
 * before its first.
 */
export type LiveChainRequest = Omit<ChainRequest, 'length' | 'start'>;

/** What how a chain is heard depends on: the chain, and the stream as it runs it. */
export type ListeningRequest = Pick<ChainRequest, 'chain' | 'input' | 'sampleRate' | 'quality'>;

/** What the memory a chain's whole passes hold depends on: how it is heard, and the stream's length. */
export type MeasurementRequest = ListeningRequest & Pick<ChainRequest, 'length'>;

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
   * The most bytes the whole passes of the request's chain hold at once over a
   * stream of its `length` frames, from the first pass to the end of the run
   * that reads them, or why the chain cannot run: a model's output over the
   * whole stream counts in full, a pass that measures a few numbers nothing. A
   * cache of renders counts it against its bound before it starts one.
   */
  measurementBytes(request: MeasurementRequest): DomainResult<number>;

  /**
   * The run of a chain over the stream `read` reads, after any pass over it
   * that a processor measuring its whole input needs, or why it cannot run.
   */
  prepare(
    request: ChainRequest,
    read: StreamReader,
    signal?: CancellationSignal,
  ): Promise<DomainResult<ChainRun>>;

  /**
   * The run of a chain over a live input with no end, made at once with no
   * measuring pass, so the audio thread can make it, or why it cannot run.
   * Only a chain whose {@link ChainProcessing.listening} is `live` can: one
   * that a processor measuring its whole input, or one that cannot keep to
   * the audio thread's schedule, keeps from running as it is heard is refused
   * with the listening's reason (ADR-0070).
   */
  prepareLive(request: LiveChainRequest): DomainResult<ChainRun>;
}
