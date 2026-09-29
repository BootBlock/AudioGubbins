/**
 * The runs of one loaded processor: feeding it from a timeline frame,
 * starting it, and halting it.
 *
 * A run is a set of pumps from one frame, started fresh every time: every
 * play, and every seek while playing, halts and resets the processor first
 * and pumps from the transport's position. Resuming the old pumps instead
 * would need the processor's count of what it consumed and the pumps' to be
 * carried across the halt, and a halt lands a quantum or two after it is
 * sent, so the two would disagree by frames nobody can see. A fresh run
 * costs one refill of the time ahead, and keeps both counts starting at zero
 * together: the pumps' at the run, the processor's at its `started`.
 *
 * Each run is named by a number raised with every run, sent with its `start`
 * and carried back by every reply about it. A reply crosses while the main
 * thread moves on, so a `started` or an end posted just before a halt arrived
 * can land after the next run began; the name is how it is told apart, where
 * its arrival order cannot be.
 *
 * It decides nothing about the transport: it reports whether a reply belongs
 * to the current run, and the session applies what it means.
 */

import type { NodeId } from '@audiogubbins/audio-graph';
import {
  Cancelled,
  createCancellationSource,
  type CancellationSource,
} from '@audiogubbins/audio-engine';
import { succeed, type DomainResult, type SampleCount } from '@audiogubbins/domain';

import type { Schedule } from '../schedule.js';
import { ToProcessorKind } from '../protocol/processor-messages.js';
import { ConsumptionTicker } from './consumption-ticker.js';
import type { EngineLink } from './engine-link.js';
import type { PlaybackFeeds, RunningPump } from './feed-bindings.js';

/** Where a run has reached. */
const RunStage = {
  /** Its pumps are filling the feeds, and the processor has not been told to start. */
  Priming: 'priming',
  /** The processor has been told to start and has not said it has. */
  Starting: 'starting',
  Running: 'running',
} as const;

type RunStage = (typeof RunStage)[keyof typeof RunStage];

interface Run {
  /** The name the processor carries back in every reply about the run. */
  readonly id: number;
  readonly cancellation: CancellationSource;
  readonly pumps: readonly RunningPump[];
  stage: RunStage;
  ticker: ConsumptionTicker | undefined;
}

/** What a loaded processor's runs are driven with. */
export interface ProcessorRunsOptions {
  readonly link: EngineLink;
  readonly feeds: PlaybackFeeds;
  readonly schedule: Schedule;
  /** How often the pumps hear what the processor has consumed. */
  readonly tickMilliseconds: number;
  /** The context frame the main thread's clock has reached. */
  readonly contextFrame: () => number;
  /** Hears a pump that stopped on an error of its source's, not by being cancelled. */
  readonly feedFailed: (node: NodeId, error: unknown) => void;
}

/** A loaded processor's runs, one at a time. */
export class ProcessorRuns {
  readonly #options: ProcessorRunsOptions;
  #run: Run | undefined;
  /** The name of the last run started; zero before the first, which the processor never names. */
  #lastRunId = 0;

  constructor(options: ProcessorRunsOptions) {
    this.#options = options;
  }

  /** Whether a run has been asked for and the processor has not yet said it started. */
  get starting(): boolean {
    return this.#run !== undefined && this.#run.stage !== RunStage.Running;
  }

  /**
   * Halts and resets the processor after the current run, pumps from `from`,
   * and tells the processor to start once every feed has audio queued. Answers
   * whether it was told: `false` where another run or a halt came first.
   */
  async start(from: SampleCount): Promise<DomainResult<boolean>> {
    this.halt();
    const { link, feeds, schedule } = this.#options;
    const cancellation = createCancellationSource();
    const started = feeds.start(
      from,
      (message, transfer) => {
        link.send(message, transfer);
      },
      schedule,
      cancellation.signal,
    );
    if (!started.ok) {
      // Pumps started before the one refused are stopped with it.
      cancellation.cancel();
      return started;
    }
    this.#lastRunId += 1;
    const run: Run = {
      id: this.#lastRunId,
      cancellation,
      pumps: started.value.pumps,
      stage: RunStage.Priming,
      ticker: undefined,
    };
    this.#run = run;
    for (const { node, pump } of run.pumps) {
      void pump.done.catch((error: unknown) => {
        // A pump cancelled by a halt stops with its signal's reason, which is
        // the halt's doing and nobody's problem.
        if (run.cancellation.signal.aborted && error instanceof Cancelled) return;
        this.#options.feedFailed(node, error);
      });
    }
    await started.value.primed;
    if (this.#run !== run) return succeed(false);
    link.send({ kind: ToProcessorKind.Start, run: run.id });
    run.stage = RunStage.Starting;
    return succeed(true);
  }

  /**
   * Takes the processor's `started` of run `runId` at `contextFrame`, and
   * answers whether it started the run waiting on it; the pumps are ticked
   * from that frame on. A `started` of any other run is an earlier one's.
   */
  started(runId: number, contextFrame: number): boolean {
    const run = this.#run;
    if (run?.id !== runId || run.stage !== RunStage.Starting) return false;
    run.stage = RunStage.Running;
    run.ticker = new ConsumptionTicker(
      {
        schedule: this.#options.schedule,
        intervalMilliseconds: this.#options.tickMilliseconds,
        contextFrame: this.#options.contextFrame,
        tick: (consumed) => {
          for (const { pump } of run.pumps) pump.tick(consumed);
        },
      },
      contextFrame,
    );
    return true;
  }

  /** Whether the processor said it started run `runId`, and it is still the current one. */
  isRunning(runId: number): boolean {
    return this.#run?.id === runId && this.#run.stage === RunStage.Running;
  }

  /**
   * Ends the current run: its pumps and ticks stop, the processor halts, and
   * what the feeds hold is discarded, the rings marked before the reset is
   * sent so the reset can see the mark. Nothing is sent without a run.
   */
  halt(): void {
    const run = this.#run;
    if (run === undefined) return;
    this.#run = undefined;
    run.ticker?.stop();
    run.cancellation.cancel();
    const { link, feeds } = this.#options;
    link.send({ kind: ToProcessorKind.Halt });
    feeds.discard();
    link.send({ kind: ToProcessorKind.Reset });
  }

  /** Stops the current run without a word to the processor, which has gone. */
  abandon(): void {
    const run = this.#run;
    if (run === undefined) return;
    this.#run = undefined;
    run.ticker?.stop();
    run.cancellation.cancel();
  }
}
