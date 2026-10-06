/**
 * A machine-learning processor's whole pass: its inference over the stream,
 * whose answer is the processor's output over the whole stream, which its
 * kernel plays back (ADR-0062, decision 19 of the phase).
 *
 * The pass hears the stream a chunk at a time, read through `finiteSample`
 * as every kernel reads its input, converts it to the model's rate with the
 * canonical resampler where the two differ, and hands it to the processor's
 * model stream, which runs the model in fixed runs (`chunk-schedule.ts`) and
 * gives back its output at the model's rate as it is made; that is converted
 * back and gathered. Each `add` answers once its chunk has been through the
 * model, so slow inference holds the reading of the stream back, and the
 * pass keeps only the context the next run needs on the input side.
 *
 * The model's sessions are opened once, on the first chunk, and let go when
 * the pass ends however it ends: answered, refused, cancelled or released.
 * A refusal, the model's or the bound's, is the answer from then on and the
 * rest of the stream is not run; a cancellation throws, as every cancelled
 * pass does.
 *
 * The output is held in memory until the kernel has it, so a stream whose
 * output would pass {@link MOST_OUTPUT_SAMPLES} is refused with the reason
 * before anything is run past it. Its length is the stream's, frame for
 * frame: the model stream's own delay is its to undo.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  throwIfCancelled,
  type CancellationSignal,
  type DomainFailureResult,
  type DomainResult,
} from '@audiogubbins/domain';
import { resamplingQualityOf } from '@audiogubbins/audio-engine';

import type { MeasuringRun } from '../framework/processor-type.js';
import { finiteSample } from '../framework/sample-safety.js';
import type { Measurement, Measurer } from '../framework/whole-pass.js';
import type { ModelDefinition } from './model-definition.js';
import { openModel, type ModelServices, type ModelSessions } from './model-sessions.js';
import { PlanarOutput } from './planar-output.js';
import { RateStage } from './rate-stage.js';

/**
 * The most samples, over every channel, a pass's output may hold: 2²⁶, 256
 * MiB of `Float32Array`, an hour of mono or 23 minutes of stereo at 48 kHz.
 * The output is one allocation, carried in memory by the graph setting it
 * reaches the kernel in and copied once more as it is made planar, so the
 * bound keeps a pass well inside what a browser tab's worker can be given on
 * a device with a few gigabytes; a longer stream needs the cached render path
 * that writes its output to storage as it is made, which lifts the bound.
 */
export const MOST_OUTPUT_SAMPLES = 2 ** 26;

/** Receives a model stream's output at the model's rate, one array per channel. */
export type ModelOutput = (output: readonly Float32Array[], frames: number) => Promise<void>;

/**
 * A processor's model at work over one stream, at the model's rate: what it
 * makes of its input, and the output it gives back through the `ModelOutput`
 * it was made with, as many frames in all as it heard.
 */
export interface ModelStream {
  /** Hears the first `frames` frames of `input`, giving back the output that is ready. */
  hear(
    input: readonly Float32Array[],
    frames: number,
    signal: CancellationSignal | undefined,
  ): Promise<DomainResult<void>>;
  /** The stream has ended: gives back the rest of its output. */
  end(signal: CancellationSignal | undefined): Promise<DomainResult<void>>;
  /** Frees what it works with, whether or not it ended. */
  release(): void;
}

/** Makes a processor's model stream for a run, over the sessions the pass opened. */
export type ModelStreamOf = (
  sessions: ModelSessions,
  run: MeasuringRun,
  emit: ModelOutput,
) => ModelStream;

/** The frames of input made finite at a time. */
const FINITE_FRAMES = 4_096;

/** A pass's model stream and the sessions under it, while they are open. */
interface Opened {
  readonly sessions: ModelSessions;
  readonly stream: ModelStream;
}

export class ModelPass implements Measurer {
  readonly #run: MeasuringRun;
  readonly #definition: ModelDefinition;
  readonly #services: ModelServices;
  readonly #streamOf: ModelStreamOf;
  readonly #finite: readonly Float32Array[];
  readonly #output: PlanarOutput;
  readonly #toModel: DomainResult<RateStage>;
  readonly #fromModel: DomainResult<RateStage>;
  #opened: Opened | undefined;
  /** The frames of the stream heard. */
  #heard = 0;
  #answer: DomainResult<Measurement> | undefined;
  #released = false;

  constructor(
    run: MeasuringRun,
    definition: ModelDefinition,
    services: ModelServices,
    streamOf: ModelStreamOf,
  ) {
    this.#run = run;
    this.#definition = definition;
    this.#services = services;
    this.#streamOf = streamOf;
    const channels = run.input.roles.length;
    this.#finite = Array.from({ length: channels }, () => new Float32Array(FINITE_FRAMES));
    this.#output = new PlanarOutput(run.output.roles.length);
    const quality = resamplingQualityOf(run.quality.resampling);
    const { dsp, sampleRate } = run;
    this.#toModel = RateStage.between(dsp, sampleRate, definition.sampleRate, channels, quality);
    this.#fromModel = RateStage.between(
      dsp,
      definition.sampleRate,
      sampleRate,
      run.output.roles.length,
      quality,
    );
  }

  async add(
    input: readonly Float32Array[],
    frames: number,
    signal?: CancellationSignal,
  ): Promise<void> {
    if (this.#released) throw new Error('A released model pass was given more input.');
    if (this.#answer?.ok === true) throw new Error('A finished model pass was given more input.');
    throwIfCancelled(signal);
    if (this.#answer !== undefined) return;
    this.#heard += frames;
    const bound = this.#boundRefusal();
    if (bound !== undefined) {
      this.#refuse(bound);
      return;
    }
    const opened = await this.#open(signal);
    if (opened === undefined) return;
    const toModel = this.#stage(this.#toModel);
    if (toModel === undefined) return;
    for (let start = 0; start < frames && !this.#answered(); start += FINITE_FRAMES) {
      const length = Math.min(FINITE_FRAMES, frames - start);
      this.#readFinite(input, start, length);
      await toModel.push(this.#finite, length, (chunk, ready) =>
        this.#hear(opened, chunk, ready, signal),
      );
    }
  }

  async result(signal?: CancellationSignal): Promise<DomainResult<Measurement>> {
    if (this.#answer !== undefined) return this.#answer;
    if (this.#released) throw new Error('A released model pass was asked for its result.');
    throwIfCancelled(signal);
    const opened = await this.#open(signal);
    const toModel = this.#stage(this.#toModel);
    const fromModel = this.#stage(this.#fromModel);
    if (opened !== undefined && toModel !== undefined && fromModel !== undefined) {
      await toModel.finish((chunk, ready) => this.#hear(opened, chunk, ready, signal));
      if (!this.#answered()) this.#check(await opened.stream.end(signal), signal);
      if (!this.#answered()) {
        await fromModel.finish((chunk, ready) => {
          this.#output.write(chunk, ready);
          return Promise.resolve();
        });
        this.#answer = succeed(this.#output.planar(this.#heard));
      }
    }
    this.#close();
    return this.#answer ?? this.#refusalOfNothing();
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#close();
    if (this.#toModel.ok) this.#toModel.value.release();
    if (this.#fromModel.ok) this.#fromModel.value.release();
  }

  /**
   * Whether the pass has its answer: a refusal made where a model run, a
   * stage or the bound refused, which may happen in any awaited call.
   */
  #answered(): boolean {
    return this.#answer !== undefined;
  }

  /** The sessions and model stream, opened on first need, or nothing where the pass was refused. */
  async #open(signal: CancellationSignal | undefined): Promise<Opened | undefined> {
    if (this.#opened !== undefined || this.#answer !== undefined) return this.#opened;
    const sessions = await openModel(this.#definition, this.#services, signal);
    if (!sessions.ok) {
      this.#refuse(sessions);
      return undefined;
    }
    if (this.#released) {
      // Released while its sessions were being opened: they are let go now.
      sessions.value.release();
      return undefined;
    }
    const fromModel = this.#stage(this.#fromModel);
    if (fromModel === undefined) {
      sessions.value.release();
      return undefined;
    }
    const stream = this.#streamOf(sessions.value, this.#run, (output, frames) =>
      fromModel.push(output, frames, (chunk, ready) => {
        this.#output.write(chunk, ready);
        return Promise.resolve();
      }),
    );
    this.#opened = { sessions: sessions.value, stream };
    return this.#opened;
  }

  /** Hands converted input to the model stream, unless the pass has already been answered. */
  async #hear(
    opened: Opened,
    chunk: readonly Float32Array[],
    frames: number,
    signal: CancellationSignal | undefined,
  ): Promise<void> {
    if (this.#answer !== undefined) return;
    this.#check(await opened.stream.hear(chunk, frames, signal), signal);
  }

  /** Takes a model stream's refusal as the answer; a cancellation throws instead. */
  #check(heard: DomainResult<void>, signal: CancellationSignal | undefined): void {
    if (heard.ok) return;
    throwIfCancelled(signal);
    this.#refuse(heard);
  }

  /** The stage, or nothing once its refusal has been made the answer. */
  #stage(made: DomainResult<RateStage>): RateStage | undefined {
    if (made.ok) return made.value;
    this.#refuse(made);
    return undefined;
  }

  #refuse(refusal: DomainFailureResult): void {
    this.#answer ??= refusal;
    this.#close();
  }

  #close(): void {
    this.#opened?.stream.release();
    this.#opened?.sessions.release();
    this.#opened = undefined;
  }

  #readFinite(input: readonly Float32Array[], start: number, length: number): void {
    for (const [channel, into] of this.#finite.entries()) {
      const from = input[channel];
      for (let frame = 0; frame < length; frame += 1) {
        into[frame] = finiteSample(from?.[start + frame] ?? 0);
      }
    }
  }

  #boundRefusal(): DomainFailureResult | undefined {
    const samples = this.#heard * this.#run.output.roles.length;
    if (samples <= MOST_OUTPUT_SAMPLES) return undefined;
    const { pack } = this.#definition.identity;
    return fail(
      failure(
        'processor.model-output-too-long',
        FailureKind.Rejected,
        `This stream is too long for ${pack} to process in memory: its output would hold more than ${String(MOST_OUTPUT_SAMPLES)} samples over its channels. Process a shorter range.`,
        { details: { pack, frames: this.#heard, most: MOST_OUTPUT_SAMPLES } },
      ),
    );
  }

  /** The answer of a pass refused before it had a reason, which a fault alone makes. */
  #refusalOfNothing(): DomainResult<Measurement> {
    throw new Error('A model pass ended with no answer and no refusal.');
  }
}
