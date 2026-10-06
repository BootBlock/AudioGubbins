/**
 * A stream of a plan heard through its chain (ADR-0060).
 *
 * A processed stream is rendered from its own start, so what any reader hears
 * of it is one answer: the run is made from the stream's first frame, the
 * chain's latency is run off and cut, and each frame read is the chain's
 * output for that frame of input. Past the stream's end the chain is fed
 * silence until its latency is flushed, and what it would add after that, a
 * reverb's tail, is not heard: the stream keeps its length.
 *
 * Reads are made in order, as every reader of a plan makes them. A read
 * behind the last one starts the run again from the stream's start, so it is
 * still the canonical answer. A preview may instead start part way through,
 * the run begun at least the chain's lead-in before the frame asked for, on
 * the chain's frame grid, which is what playback does after a seek, and says
 * it is a preview (ADR-0061). Either way the run is told the frame it starts
 * at, so a processor that plays back a whole pass plays it from there.
 */

import {
  FailureKind,
  failure,
  throwIfCancelled,
  type CancellationSignal,
  type ChannelLayout,
  type EffectChain,
  type QualitySettings,
  type SampleRate,
} from '@audiogubbins/domain';

import type { CanonicalDsp } from '../dsp/canonical-dsp.js';
import type { ChainProcessing, ChainRun, StreamReader } from './chain-processing.js';
import type { ContentReader } from './plan-content.js';
import { MediaReadFailure } from './plan-content.js';

/** How a processed stream may be started: from its own start only, or part way for a preview. */
export const ProcessedStart = { Canonical: 'canonical', Preview: 'preview' } as const;

/** How a processed stream may be started. */
export type ProcessedStart = (typeof ProcessedStart)[keyof typeof ProcessedStart];

/**
 * How a reader of edited sound runs the chains its plans name: the rack's
 * processing, the quality it runs them at, and whether it may start a stream
 * part way through. Every reader states it, so none can skip a rack.
 */
export interface PlanProcessing {
  readonly processing: ChainProcessing;
  readonly quality: QualitySettings;
  readonly start: ProcessedStart;
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
  readonly #chain: EffectChain;
  readonly #input: StreamInput;
  readonly #settings: ProcessedSettings;
  readonly #inputScratch: Float32Array[];
  readonly #outputScratch: Float32Array[];
  #running: Running | undefined;

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
    if (running === undefined || start < running.produced) {
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
    this.#running = running;
    await this.#consume(running, run.latency, undefined, 0, signal);
    running.produced = from;
    return running;
  }

  /**
   * The frame a run that gives frame `start` next begins at: the stream's
   * first, or for a preview the grid point at or before `start` less the
   * chain's lead-in.
   */
  #runStart(start: number): number {
    if (this.#settings.start === ProcessedStart.Canonical) return 0;
    const partWay = this.#settings.processing.partWayStart({
      chain: this.#chain,
      input: this.#input.layout,
      sampleRate: this.#input.sampleRate,
      quality: this.#settings.quality,
    });
    if (!partWay.ok) throw new MediaReadFailure(partWay.failures[0]);
    const { leadIn, frameGrid } = partWay.value;
    return Math.floor(Math.max(0, start - leadIn) / frameGrid) * frameGrid;
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
