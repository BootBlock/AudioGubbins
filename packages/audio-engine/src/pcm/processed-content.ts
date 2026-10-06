/**
 * A stream of a plan heard through its chain (ADR-0060).
 *
 * A processed stream is rendered from its own start, so what any reader hears
 * of it is one answer: the run is made from the stream's first frame, the
 * chain's latency is run off and cut, and each frame read is the chain's output
 * for that frame of input. Past the stream's end the chain is fed silence until
 * its latency is flushed, and what it would add after that, a reverb's tail, is
 * not heard: the stream keeps its length.
 *
 * Reads are made one at a time, in order, as every reader of a plan makes them,
 * and the edited source that reaches this gives them turns (`read-turns.ts`),
 * since two readers of one source share this run. A read behind the last one
 * starts the run again from the stream's start, so it is still the canonical
 * answer, and a read that fails or is cancelled part way leaves the run where
 * its last whole chunk left it, never half primed. A preview may instead start
 * part way through, the run begun at least the chain's lead-in before the frame
 * asked for, on the chain's frame grid, which is what playback does after a
 * seek either way, and says it is a preview (ADR-0061): the lead-in is run
 * through and not given, so the first frame heard is what a render from the
 * start gives there. Either way the run is told the frame it starts at, so a
 * processor that plays back a whole pass plays it from there.
 *
 * A numeric parameter changed while it plays reaches the run it has, which
 * smooths it in, and the chain it keeps, so a run made again after a seek
 * starts with the new value (`running-parameters.ts`).
 */

import {
  FailureKind,
  failure,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type ChannelLayout,
  type DomainResult,
  type EffectChain,
  type QualitySettings,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import type { CachedStreams } from './cached-streams.js';
import type { ChainProcessing, ChainRun, PartWayStart, StreamReader } from './chain-processing.js';
import type { ContentReader } from './plan-content.js';
import { MediaReadFailure } from './plan-content.js';
import type { ParameterChange, RunningParameters } from './running-parameters.js';

/** How a processed stream may be started: from its own start only, or part way for a preview. */
export const ProcessedStart = { Canonical: 'canonical', Preview: 'preview' } as const;

/** How a processed stream may be started. */
export type ProcessedStart = (typeof ProcessedStart)[keyof typeof ProcessedStart];

/**
 * How a reader of edited sound runs the chains its plans name: the rack's
 * processing, the quality it runs them at, and whether it may start a stream
 * part way through. Every reader states it, so none can skip a rack.
 *
 * A reader given a cache of renders reads from a render every stream it would
 * otherwise run from the stream's start, and every stream a preview cannot
 * run as it is heard (`cached-streams.ts`); one given running parameters
 * takes a parameter changed while it plays into the chains it runs
 * (`running-parameters.ts`).
 */
export interface PlanProcessing {
  readonly processing: ChainProcessing;
  readonly quality: QualitySettings;
  readonly start: ProcessedStart;
  readonly cached?: CachedStreams;
  readonly parameters?: RunningParameters;
}

/** What a processed stream is run with. */
export interface ProcessedSettings extends PlanProcessing {
  readonly dsp: CanonicalDsp;
}

/** Frames processed at a time, which bounds the scratch memory and changes no bit of the output. */
const CHUNK = 4_096;

/** A stream's segments, as its chain hears them. */
export interface StreamInput {
  readonly layout: ChannelLayout;
  readonly sampleRate: SampleRate;
  readonly length: number;
  readonly read: StreamReader;
}

/** The chain's run over the stream, and where it has got to. */
interface Running {
  readonly run: ChainRun;
  /** The next frame of input the chain is given. */
  raw: number;
  /** The next frame of output a reader is given: `raw` less the latency. */
  produced: number;
}

/** A stream heard through its chain, read in order. */
export class ProcessedContent implements ContentReader {
  readonly channels: number;
  /** As many frames as the stream's segments hold: a chain keeps a stream's length. */
  readonly length: number;
  #chain: EffectChain;
  readonly #input: StreamInput;
  readonly #settings: ProcessedSettings;
  readonly #inputScratch: Float32Array[];
  readonly #outputScratch: Float32Array[];
  #running: Running | undefined;
  /** Where a preview of the chain may start, asked once for each chain it runs. */
  #partWay: PartWayStart | undefined;

  constructor(
    chain: EffectChain,
    input: StreamInput,
    output: ChannelLayout,
    settings: ProcessedSettings,
  ) {
    this.#chain = chain;
    this.#input = input;
    this.#settings = settings;
    this.channels = output.roles.length;
    this.length = input.length;
    this.#inputScratch = input.layout.roles.map(() => new Float32Array(CHUNK));
    this.#outputScratch = output.roles.map(() => new Float32Array(CHUNK));
  }

  async read(
    start: number,
    frames: number,
    into: readonly Float32Array[],
    signal?: CancellationSignal,
  ): Promise<void> {
    let running = this.#running;
    if (running === undefined || start < running.produced || this.#runStart(start) > running.raw) {
      running = await this.#begin(start, signal);
    }
    await this.#advance(running, start - running.produced, undefined, signal);
    await this.#advance(running, frames, into, signal);
  }

  /** A run made afresh, primed to give frame `start` next, or as near before it as a preview may. */
  async #begin(start: number, signal: CancellationSignal | undefined): Promise<Running> {
    this.release();
    const from = this.#runStart(start);
    const prepared = await this.#settings.processing.prepare(
      {
        chain: this.#chain,
        input: this.#input.layout,
        sampleRate: this.#input.sampleRate,
        length: this.#input.length,
        quality: this.#settings.quality,
        blockFrames: CHUNK,
        dsp: this.#settings.dsp,
        start: from,
      },
      this.#input.read,
      signal,
    );
    if (!prepared.ok) throw new MediaReadFailure(prepared.failures[0]);
    const run = prepared.value;
    if (run.layout.roles.length !== this.channels) {
      run.release();
      throw new MediaReadFailure(
        failure(
          'pcm.processed-layout',
          FailureKind.Rejected,
          'A chain makes other channels than its stream holds.',
        ),
      );
    }
    const running: Running = { run, raw: from, produced: from };
    // Held only once its latency is run off: a run cancelled while it primes
    // would otherwise count the frames it ran off as frames it gave.
    let primed = false;
    try {
      await this.#consume(running, run.latency, undefined, 0, signal);
      primed = true;
    } finally {
      if (!primed) run.release();
    }
    running.produced = from;
    this.#running = running;
    return running;
  }

  /**
   * The frame a run that gives frame `start` next begins at: the stream's
   * first, or for a preview the grid point at or before `start` less the
   * chain's lead-in. A preview reading forwards past that point starts again
   * there too, as a seek ahead does, rather than running the chain over all
   * it skips.
   */
  #runStart(start: number): number {
    if (this.#settings.start === ProcessedStart.Canonical) return 0;
    const { leadIn, frameGrid } = this.#partWayStart();
    return Math.floor(Math.max(0, start - leadIn) / frameGrid) * frameGrid;
  }

  #partWayStart(): PartWayStart {
    if (this.#partWay !== undefined) return this.#partWay;
    const listening = this.#settings.processing.listening({
      chain: this.#chain,
      input: this.#input.layout,
      sampleRate: this.#input.sampleRate,
      quality: this.#settings.quality,
    });
    if (!listening.ok) throw new MediaReadFailure(listening.failures[0]);
    this.#partWay = listening.value.partWay;
    return this.#partWay;
  }

  /**
   * Takes `chain`, the chain with `change` made, into what runs: the run it
   * has, smoothed by the processor's kernel from the next frame, and the run
   * it makes after a seek.
   */
  setParameter(chain: EffectChain, change: ParameterChange): DomainResult<void> {
    const running = this.#running;
    const taken =
      running === undefined
        ? succeed(undefined)
        : running.run.setParameter(change.processor, change.parameter, change.value);
    if (taken.ok) {
      // A value may move the lead-in, as a longer look-ahead does.
      this.#chain = chain;
      this.#partWay = undefined;
    }
    return taken;
  }

  /** Gives the next `count` frames of output into `into`, or runs them off where it is absent. */
  async #advance(
    running: Running,
    count: number,
    into: readonly Float32Array[] | undefined,
    signal: CancellationSignal | undefined,
  ): Promise<void> {
    let done = 0;
    while (done < count) {
      throwIfCancelled(signal);
      const frames = Math.min(CHUNK, count - done);
      await this.#consume(running, frames, into, done, signal);
      done += frames;
    }
  }

  /** Runs `count` frames of input through the chain, writing what it gives into `into` at `offset`. */
  async #consume(
    running: Running,
    count: number,
    into: readonly Float32Array[] | undefined,
    offset: number,
    signal: CancellationSignal | undefined,
  ): Promise<void> {
    for (let done = 0; done < count;) {
      const frames = Math.min(CHUNK, count - done);
      const real = Math.max(0, Math.min(frames, this.#input.length - running.raw));
      const input = this.#inputScratch.map((channel) => channel.subarray(0, frames));
      for (const channel of input) channel.fill(0);
      if (real > 0) {
        await this.#input.read(
          running.raw,
          real,
          input.map((channel) => channel.subarray(0, real)),
          signal,
        );
      }
      const output = this.#outputScratch.map((channel) => channel.subarray(0, frames));
      running.run.process(input, output, frames);
      if (into !== undefined) {
        output.forEach((channel, index) => into[index]?.set(channel, offset + done));
      }
      running.raw += frames;
      running.produced += frames;
      done += frames;
    }
  }

  release(): void {
    this.#running?.run.release();
    this.#running = undefined;
  }
}
