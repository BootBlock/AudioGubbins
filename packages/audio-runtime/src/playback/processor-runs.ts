/**
 * The runs of one loaded processor: starting it afresh from a timeline frame,
 * going on after a pause, and halting it.
 *
 * A pause keeps everything: the processor halts where it is with the graph's
 * history and the feeds' audio intact, and the feeder, finding no room, waits.
 * Playing again goes on with the very next frame, so every frame is played
 * once, the graph's latency included, however often playback pauses; and a
 * halt that lands a quantum or two after it was sent costs nothing, since the
 * processor's own count says where it halted. A start from anywhere else, the
 * first play, a play after a stop, or a seek, is a fresh run: the feeder
 * rewinds every feed to it and pumps from its frame, and once every feed has
 * audio queued the processor is told to start, which it does once the rewind
 * has reached it, with the graph made again.
 *
 * Each run is named by a number raised with every run, sent with its `start`
 * and carried back by every reply about it. A reply crosses while the main
 * thread moves on, so a `started`, a report or an end posted just before a
 * halt arrived can land after the next run began; the name is how it is told
 * apart, where its arrival order cannot be.
 *
 * It decides nothing about the transport: it reports whether a reply belongs
 * to the current run, and the session applies what it means.
 */

import { succeed, type DomainResult, type SampleCount } from '@audiogubbins/domain';

import { ToFeederKind } from '../protocol/feeder-messages.js';
import { ToProcessorKind } from '../protocol/processor-messages.js';
import type { EngineLink } from './engine-link.js';
import type { FeederLink } from './feeder-link.js';

/** Where a run has reached. */
const RunStage = {
  /** The feeder is filling the feeds, and the processor has not been told to start. */
  Priming: 'priming',
  /** The processor has been told to start and has not said it has. */
  Starting: 'starting',
  Running: 'running',
} as const;

type RunStage = (typeof RunStage)[keyof typeof RunStage];

interface Run {
  /** The name the processor carries back in every reply about the run. */
  readonly id: number;
  stage: RunStage;
  /** Ends the wait for the feeds to prime: by the feeder's word, or by the run ending first. */
  primed: () => void;
}

/** What a loaded processor's runs are driven with. */
export interface ProcessorRunsOptions {
  readonly link: EngineLink;
  /** The feeder of the graph's inputs, or none for a graph that makes its own audio. */
  readonly feeder: FeederLink | undefined;
}

/** A loaded processor's runs, one at a time. */
export class ProcessorRuns {
  readonly #options: ProcessorRunsOptions;
  #run: Run | undefined;
  /** The name of the last run started; zero before the first, which the processor never names. */
  #lastRunId = 0;

  /** The fresh run whose audio the processor holds, halted, to go on with. */
  #held: number | undefined;

  /** The run a pause halted, whose `halted` says where the transport paused. */
  #paused: number | undefined;

  constructor(options: ProcessorRunsOptions) {
    this.#options = options;
  }

  /** Whether a run has been asked for and the processor has not yet said it started. */
  get starting(): boolean {
    return this.#run !== undefined && this.#run.stage !== RunStage.Running;
  }

  /**
   * Starts a fresh run from `from`: halts what runs and discards what the
   * feeds hold, has the feeder rewind and fill them, and tells the processor
   * to start once they hold audio. Answers whether it was told: `false` where
   * another run, a halt or a fault came first.
   */
  async start(from: SampleCount): Promise<DomainResult<boolean>> {
    this.stop();
    const { link, feeder } = this.#options;
    this.#lastRunId += 1;
    const run: Run = { id: this.#lastRunId, stage: RunStage.Priming, primed: () => undefined };
    this.#run = run;
    if (feeder !== undefined) {
      const primed = new Promise<void>((resolve) => {
        run.primed = resolve;
      });
      feeder.send({ kind: ToFeederKind.Start, run: run.id, from });
      await primed;
      if (this.#run !== run) return succeed(false);
    }
    link.send({ kind: ToProcessorKind.Start, run: run.id, epoch: run.id, from });
    run.stage = RunStage.Starting;
    this.#held = run.id;
    return succeed(true);
  }

  /**
   * Goes on with the audio the processor holds from the last pause, at
   * `position`, where it paused. Answers whether it holds any to go on with.
   */
  resume(position: SampleCount): boolean {
    const held = this.#held;
    if (held === undefined) return false;
    this.#lastRunId += 1;
    const run: Run = { id: this.#lastRunId, stage: RunStage.Starting, primed: () => undefined };
    this.#run = run;
    this.#paused = undefined;
    this.#options.link.send({
      kind: ToProcessorKind.Start,
      run: run.id,
      epoch: held,
      from: position,
    });
    return true;
  }

  /** Takes the feeder's word that run `runId`'s feeds hold audio to start with. */
  primed(runId: number): void {
    const run = this.#run;
    if (run?.id === runId && run.stage === RunStage.Priming) run.primed();
  }

  /** Takes the processor's `started` of run `runId`, and answers whether it started the run waiting on it. */
  started(runId: number): boolean {
    const run = this.#run;
    if (run?.id !== runId || run.stage !== RunStage.Starting) return false;
    run.stage = RunStage.Running;
    return true;
  }

  /** Whether run `runId` is the current one: a reply about any other is about audio no longer playing. */
  isCurrent(runId: number): boolean {
    return this.#run?.id === runId;
  }

  /** Whether the processor said it started run `runId`, and it is still the current one. */
  isRunning(runId: number): boolean {
    return this.#run?.id === runId && this.#run.stage === RunStage.Running;
  }

  /** Whether a `halted` of run `runId` is the one a pause waits on to say where it paused. */
  halted(runId: number): boolean {
    if (this.#paused !== runId) return false;
    this.#paused = undefined;
    return true;
  }

  /**
   * Pauses: the processor halts and keeps what it holds, for {@link resume}.
   * A fresh run still priming is called off instead, as nothing of it played.
   */
  pause(): void {
    const run = this.#run;
    if (run === undefined) return;
    if (run.stage === RunStage.Priming) {
      this.stop();
      return;
    }
    this.#run = undefined;
    this.#paused = run.id;
    this.#options.link.send({ kind: ToProcessorKind.Halt });
  }

  /**
   * Stops: the processor halts, the feeder stops, and what the feeds hold is
   * no longer gone on with, so the next start is fresh. Nothing is sent where
   * nothing runs or is held.
   */
  stop(): void {
    const run = this.#run;
    const held = this.#held;
    this.#run = undefined;
    this.#held = undefined;
    this.#paused = undefined;
    run?.primed();
    if (run === undefined && held === undefined) return;
    if (run !== undefined) this.#options.link.send({ kind: ToProcessorKind.Halt });
    this.#options.feeder?.send({ kind: ToFeederKind.Stop });
  }

  /** Forgets every run without a word to the processor or the feeder, whose processor has gone. */
  abandon(): void {
    const run = this.#run;
    this.#run = undefined;
    this.#held = undefined;
    this.#paused = undefined;
    run?.primed();
  }
}
