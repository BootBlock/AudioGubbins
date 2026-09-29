/**
 * The graph in the processor: how one comes to be loaded, how it goes, and
 * what is kept to load it again after its context is lost.
 *
 * A load checks the graph with `preparePlayback`, has the feeder make the
 * request's sources while the processor's module is added to the context,
 * makes a `LoadedProcessor` and waits for its answer, and publishes each step
 * in the status. Only a later load, an unload or a lost context overtakes a
 * load waiting on the module; a transport command does not, since it changes
 * nothing a load depends on.
 *
 * The feeder worker is started with the first graph that has inputs to feed
 * and lives as long as the loader. A request's sources are made in it once and
 * kept until another request replaces it, so the same request loaded again on
 * a new context after a loss plays them without the main thread sending
 * recorded audio it no longer holds.
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
import type { FromFeeder } from '../protocol/feeder-messages.js';
import type { Schedule } from '../schedule.js';
import { FeederLink, type FeederWorkerPort } from './feeder-link.js';
import { LoadedProcessor, type ChannelEnds, type LoadOutcome } from './loaded-processor.js';
import { PlaybackDspKind, type PlaybackDsp } from './playback-dsp.js';
import {
  preparePlayback,
  type PlaybackRequest,
  type PreparedPlayback,
} from './playback-preparation.js';
import type { PlaybackState } from './playback-state.js';
import {
  faultedStatus,
  loadingStatus,
  readyStatus,
  refusedStatus,
  type DspStatus,
} from './playback-status.js';
import { ProcessorReplies } from './processor-replies.js';
import { RequestSources, type SourcesOutcome } from './request-sources.js';
import { StabilityWatch } from './stability-watch.js';
import { superseded } from './superseded.js';
import { WorkletModule } from './worklet-module.js';

/** What the person is told when the processor never answers a load. */
const UNANSWERED_PROBLEM =
  'The audio processor did not answer when the graph was sent to it, so nothing can play. ' +
  'Reloading the page starts it again.';

/** What the person is told when the feeder never answers for the sources. */
const FEEDER_UNANSWERED_PROBLEM =
  'The feeder that reads the audio for playback did not answer, so nothing can play. ' +
  'Reloading the page starts it again.';

/** Why the threads run the reference path on a page that cannot compile WebAssembly. */
const NO_WEBASSEMBLY =
  'This page cannot compile WebAssembly. Processing runs on the reference path, which gives ' +
  'the same result more slowly.';

/** The threads playback starts beside the page's, which a test plays itself. */
export interface PlaybackThreads {
  /** Starts the feeder worker, the module `threads/feeder-worker.ts`. */
  readonly createFeeder: () => FeederWorkerPort;
  /** Makes a channel between the feeder and the processor: a `MessageChannel`. */
  readonly createChannel: () => ChannelEnds;
}

/** What graphs are loaded with. */
export interface GraphLoaderOptions {
  readonly lifecycle: ContextLifecycle;
  readonly capabilities: AudioRuntimeCapabilities;
  readonly dsp: PlaybackDsp;
  readonly profile: PerformanceProfile;
  readonly settings: PerformanceSettings;
  readonly workletModuleUrl: string;
  readonly threads: PlaybackThreads;
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
  readonly #dsp: PlaybackDsp;
  #loaded: LoadedProcessor | undefined;
  #replies: ProcessorReplies | undefined;
  /** The graph loaded or loading, kept to be loaded again on a new context after a loss. */
  #request: PlaybackRequest | undefined;
  #lostRequest: PlaybackRequest | undefined;
  /** Counts loads, unloads and losses, so a load another overtook stands down. */
  #generation = 0;
  #feeder: FeederLink | undefined;
  #sources: RequestSources | undefined;
  #requests = 0;

  constructor(options: GraphLoaderOptions) {
    this.#options = options;
    this.#module = new WorkletModule(options.workletModuleUrl, options.logger);
    this.#dsp = options.capabilities.webAssembly
      ? options.dsp
      : { kind: PlaybackDspKind.Unavailable, reason: NO_WEBASSEMBLY };
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
    const sources = this.#sourcesFor(request, prepared.value);
    const [module, made] = await Promise.all([this.#module.addTo(port), sources?.made]);
    if (generation !== this.#generation) {
      return superseded(
        'Another load, or the loss of the audio context, came first, so this load stood down.',
      );
    }
    if (!module.ok) {
      state.update(faultedStatus(state.status, module.failures[0].summary));
      return module;
    }
    const sourced = made === undefined ? succeed(undefined) : this.#sourcesMade(made);
    if (!sourced.ok) return sourced;
    const loaded = this.#attach(port, request, prepared.value, stability, sources);
    return this.#answered(loaded, await loaded.outcome, sourced.value);
  }

  /** Lets go of the graph, its node and its binding to the feeder, ending a load still waiting. */
  unload(): void {
    this.#generation += 1;
    const loaded = this.#loaded;
    this.#loaded = undefined;
    this.#replies = undefined;
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

  /** Lets go of everything: the graph, the sources and the feeder worker. */
  dispose(): void {
    this.unload();
    this.#sources?.abandon();
    this.#sources = undefined;
    this.#feeder?.dispose();
    this.#feeder = undefined;
  }

  /**
   * The request's sources in the feeder, made now unless they were made for
   * it already, or none for a graph with nothing to feed. The last request's
   * are released, as nothing will play them again.
   */
  #sourcesFor(request: PlaybackRequest, prepared: PreparedPlayback): RequestSources | undefined {
    if (this.#sources?.request === request) return this.#sources;
    this.#sources?.release();
    this.#sources = undefined;
    if (!prepared.feeds.any) return undefined;
    this.#requests += 1;
    this.#sources = new RequestSources({
      feeder: this.#feederLink(),
      request,
      id: this.#requests,
      dsp: this.#dsp,
      schedule: this.#options.schedule,
      logger: this.#options.logger,
    });
    return this.#sources;
  }

  /** The feeder worker, started with the first graph that needs it. */
  #feederLink(): FeederLink {
    if (this.#feeder !== undefined) return this.#feeder;
    const { threads, logger } = this.#options;
    const feeder = new FeederLink(threads.createFeeder(), logger);
    feeder.subscribe((reply: FromFeeder) => {
      this.#replies?.applyFeeder(reply);
    });
    this.#feeder = feeder;
    return feeder;
  }

  /** The feeder's DSP once the sources are made, or why the load cannot go on. */
  #sourcesMade(made: SourcesOutcome): DomainResult<DspStatus> {
    const { state } = this.#options;
    switch (made.kind) {
      case 'made':
        return succeed(made.dsp);
      case 'refused': {
        const reasons = made.failures.map((one) => one.summary);
        state.update(refusedStatus(state.status, reasons));
        return fail(
          failure(
            'playback.sources-refused',
            FailureKind.Rejected,
            `The audio to play could not be made: ${reasons.join(' ')}`,
          ),
        );
      }
      case 'unanswered':
        state.update(faultedStatus(state.status, FEEDER_UNANSWERED_PROBLEM));
        return fail(
          failure('playback.feeder-unanswered', FailureKind.Retryable, FEEDER_UNANSWERED_PROBLEM),
        );
      case 'abandoned':
        return superseded('The audio to play was replaced before the feeder had made it.');
    }
  }

  /** Makes the processor's node for a prepared graph, and hears its replies while it is current. */
  #attach(
    port: AudioContextPort,
    request: PlaybackRequest,
    prepared: PreparedPlayback,
    stability: StabilityWatch,
    sources: RequestSources | undefined,
  ): LoadedProcessor {
    const { schedule, logger, state, threads } = this.#options;
    const loaded = new LoadedProcessor({
      port,
      graph: request.graph,
      prepared,
      dsp: this.#dsp,
      feeder:
        sources === undefined
          ? undefined
          : { link: sources.feeder, request: sources.id, createChannel: threads.createChannel },
      schedule,
      logger,
    });
    const replies = new ProcessorReplies({
      runs: loaded.runs,
      state,
      stability,
      logger,
      faulted: (problem) => {
        if (this.#loaded === loaded) this.#options.faulted(problem);
      },
      feedFailed: (node, reason) => {
        if (this.#loaded === loaded) this.#feedFailed(node, reason);
      },
    });
    loaded.onReply((reply) => {
      if (this.#loaded === loaded) replies.apply(reply);
    });
    this.#loaded = loaded;
    this.#replies = replies;
    return loaded;
  }

  /** What a load comes to, once the processor has answered or the load has ended. */
  #answered(
    loaded: LoadedProcessor,
    outcome: LoadOutcome,
    feederDsp: DspStatus | undefined,
  ): DomainResult<void> {
    const { state, logger } = this.#options;
    switch (outcome.kind) {
      case 'loaded':
        state.update(readyStatus(state.status, outcome.dsp, feederDsp, outcome.latencyFrames));
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

  #feedFailed(node: NodeId, reason: string): void {
    this.#options.logger.error('Reading the audio for a graph input failed.', { node, reason });
    this.#options.faulted(`The audio for ${node} could not be read: ${reason}`);
  }
}
