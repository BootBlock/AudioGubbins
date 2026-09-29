/**
 * The graph in the processor: how one comes to be loaded, how it goes, and
 * what is kept to load it again after its context is lost.
 *
 * A load checks the graph with `preparePlayback`, adds the processor's module
 * to the context, makes a `LoadedProcessor` and waits for its answer, and
 * publishes each step in the status. Only a later load, an unload or a lost
 * context overtakes a load waiting on the module; a transport command does
 * not, since it changes nothing a load depends on.
 */

import {
  FailureKind,
  fail,
  failure,
  succeed,
  type DomainFailure,
  type DomainResult,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { NodeId } from '@audiogubbins/audio-graph';
import type { PerformanceProfile, PerformanceSettings } from '@audiogubbins/audio-engine';

import type { AudioContextPort } from '../context/audio-context-port.js';
import type { ContextLifecycle } from '../context/context-lifecycle.js';
import type { Schedule } from '../schedule.js';
import {
  LoadedProcessor,
  WorkletDspKind,
  type LoadOutcome,
  type WorkletDsp,
} from './loaded-processor.js';
import {
  preparePlayback,
  type PlaybackRequest,
  type PreparedPlayback,
} from './playback-preparation.js';
import type { PlaybackState } from './playback-state.js';
import { faultedStatus, loadingStatus, readyStatus, refusedStatus } from './playback-status.js';
import { ProcessorReplies } from './processor-replies.js';
import { StabilityWatch } from './stability-watch.js';
import { WorkletModule } from './worklet-module.js';

/** What the person is told when the processor never answers a load. */
const UNANSWERED_PROBLEM =
  'The audio processor did not answer when the graph was sent to it, so nothing can play. ' +
  'Reloading the page starts it again.';

/** Why the worklet runs the reference path on a page that cannot compile WebAssembly. */
const NO_WEBASSEMBLY =
  'This page cannot compile WebAssembly. Processing runs on the reference path, which gives ' +
  'the same result more slowly.';

/** What graphs are loaded with. */
export interface GraphLoaderOptions {
  readonly lifecycle: ContextLifecycle;
  readonly capabilities: AudioRuntimeCapabilities;
  readonly dsp: WorkletDsp;
  readonly profile: PerformanceProfile;
  readonly settings: PerformanceSettings;
  readonly workletModuleUrl: string;
  readonly schedule: Schedule;
  readonly logger: Logger;
  readonly state: PlaybackState;
  /** Hears that processing of the loaded graph stopped, and why. */
  readonly faulted: (problem: string) => void;
}

/** Summaries of failures, as the person reads them in `problems`. */
export function summaries(failures: readonly DomainFailure[]): readonly string[] {
  return failures.map((one) => one.summary);
}

/** The graph in the processor, one at a time. */
export class GraphLoader {
  readonly #options: GraphLoaderOptions;
  readonly #module: WorkletModule;
  #loaded: LoadedProcessor | undefined;
  /** The graph loaded or loading, kept to be loaded again on a new context after a loss. */
  #request: PlaybackRequest | undefined;
  #lostRequest: PlaybackRequest | undefined;
  /** Counts loads, unloads and losses, so a load another overtook stands down. */
  #generation = 0;

  constructor(options: GraphLoaderOptions) {
    this.#options = options;
    this.#module = new WorkletModule(options.workletModuleUrl, options.logger);
  }

  /** The graph in the processor, or on its way there. */
  get current(): LoadedProcessor | undefined {
    return this.#loaded;
  }

  /** The graph whose context was lost, which Play loads again. */
  get lostRequest(): PlaybackRequest | undefined {
    return this.#lostRequest;
  }

  /**
   * Loads a graph, replacing the one there was, and settles when the
   * processor has it, has refused it, or has not answered in time.
   */
  async load(request: PlaybackRequest): Promise<DomainResult<void>> {
    const { state, lifecycle } = this.#options;
    this.unload();
    const generation = this.#generation;
    this.#request = request;
    this.#lostRequest = undefined;
    const { port, clock } = state.timing();
    const prepared = preparePlayback(request, clock.contextRate, port.destination, this.#options);
    if (!prepared.ok) {
      state.update(refusedStatus(state.status, summaries(prepared.failures)));
      return prepared;
    }
    const stability = new StabilityWatch(clock.contextRate, this.#options);
    const loading = { ...state.status, device: lifecycle.report };
    state.update(loadingStatus(loading, stability.assess(state.frame())));
    const module = await this.#module.addTo(port);
    if (generation !== this.#generation) {
      return fail(
        failure(
          'playback.superseded',
          FailureKind.Conflict,
          'Another load, or the loss of the audio context, came first, so this load stood down.',
        ),
      );
    }
    if (!module.ok) {
      state.update(faultedStatus(state.status, module.failures[0].summary));
      return module;
    }
    const loaded = this.#attach(port, request, prepared.value, stability);
    return this.#answered(loaded, await loaded.outcome);
  }

  /** Lets go of the graph, its node and its feeds, ending a load still waiting. */
  unload(): void {
    this.#generation += 1;
    const loaded = this.#loaded;
    this.#loaded = undefined;
    if (loaded === undefined) return;
    loaded.abandon(
      fail(
        failure(
          'playback.load-superseded',
          FailureKind.Conflict,
          'The graph was replaced or released before the processor had it.',
        ),
      ),
    );
    loaded.dispose();
  }

  /** The context closed, taking the graph with it; `problem` says so to a load still waiting. */
  lost(problem: string): void {
    this.#lostRequest = this.#request;
    this.#loaded?.abandon(fail(failure('playback.context-lost', FailureKind.Retryable, problem)));
    this.unload();
    this.#module.forget();
  }

  /** Makes the processor's node for a prepared graph, and hears its replies while it is current. */
  #attach(
    port: AudioContextPort,
    request: PlaybackRequest,
    prepared: PreparedPlayback,
    stability: StabilityWatch,
  ): LoadedProcessor {
    const { capabilities, dsp, schedule, logger, state } = this.#options;
    const loaded = new LoadedProcessor({
      port,
      graph: request.graph,
      prepared,
      dsp: capabilities.webAssembly
        ? dsp
        : { kind: WorkletDspKind.Unavailable, reason: NO_WEBASSEMBLY },
      schedule,
      logger,
      feedFailed: (node, error) => {
        if (this.#loaded === loaded) this.#feedFailed(node, error);
      },
    });
    const replies = new ProcessorReplies({
      runs: loaded.runs,
      state,
      stability,
      logger,
      faulted: (problem) => {
        if (this.#loaded === loaded) this.#options.faulted(problem);
      },
    });
    loaded.onReply((reply) => {
      if (this.#loaded === loaded) replies.apply(reply);
    });
    this.#loaded = loaded;
    return loaded;
  }

  /** What a load comes to, once the processor has answered or the load has ended. */
  #answered(loaded: LoadedProcessor, outcome: LoadOutcome): DomainResult<void> {
    const { state, logger } = this.#options;
    switch (outcome.kind) {
      case 'loaded':
        state.update(readyStatus(state.status, outcome.dsp, outcome.latencyFrames));
        return succeed(undefined);
      case 'refused':
        logger.warning('The audio processor refused the graph.', {
          reasons: outcome.reasons.join(' '),
        });
        state.update(refusedStatus(state.status, outcome.reasons));
        if (this.#loaded === loaded) this.unload();
        return fail(
          failure(
            'playback.graph-refused',
            FailureKind.Rejected,
            `The audio processor refused the graph: ${outcome.reasons.join(' ')}`,
          ),
        );
      case 'unanswered':
        state.update(faultedStatus(state.status, UNANSWERED_PROBLEM));
        if (this.#loaded === loaded) this.unload();
        return fail(failure('playback.load-unanswered', FailureKind.Retryable, UNANSWERED_PROBLEM));
      case 'abandoned':
        return outcome.failure;
    }
  }

  #feedFailed(node: NodeId, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.#options.logger.error('Reading the audio for a graph input failed.', { node, reason });
    this.#options.faulted(`The audio for ${node} could not be read: ${reason}`);
  }
}
