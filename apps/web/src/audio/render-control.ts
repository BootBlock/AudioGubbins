/**
 * Rendering the test signal offline: planning each render against what the
 * machine has, running it as the plan and the person decide, and keeping the
 * scheduler the renders queue on to the person's settings and playback.
 *
 * Before a render starts it is assessed (`assessRender`): its chunks planned
 * from the profile and the memory the page has left, its processing mode
 * chosen from what the last render measured and any mode the person set, and
 * its priority from the mode (REQ-ARCH-079, REQ-ARCH-084, REQ-ARCH-087). A
 * render that nothing warns about, or whose warnings the plan already answers,
 * starts at once. One whose warning offers a safer strategy than the one
 * chosen waits for the person to choose between them; it is never refused for
 * its size.
 *
 * The render host, its scheduler and the DSP module are made on the first
 * render, not at start-up, and each render runs in a worker of its own; what
 * the main thread does per chunk is fingerprint it. The profile sets the chunk
 * length and how many background jobs may run beside playback, the priority
 * policy how the queue shares its slots, and none of them changes a bit of
 * what is rendered.
 */

import { channelCount, type DomainResult } from '@audiogubbins/domain';
import {
  TransportMode,
  assessRender,
  conversionTableBudget,
  type PerformanceSettings,
  type PriorityScheduler,
  type RenderStrategy,
} from '@audiogubbins/audio-engine';
import type { RenderHost } from '@audiogubbins/audio-runtime';
import type { ResourceFigures } from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';

import { durationText } from '../audio-format.js';
import type { AudioSettings } from '../state/audio-settings-store.js';
import { RenderStage, type AudioView, type AudioViewStore } from '../state/audio-view-store.js';
import type { Observable } from '../state/observable.js';
import { reasonsOf, type Reasons } from '../state/reasons.js';
import {
  awaitingDecision,
  type ContestedAssessment,
  type RenderStrategyStore,
} from '../state/render-strategy-store.js';
import { fingerprintSink } from './fingerprint-sink.js';
import {
  RENDER_SAMPLE_RATE,
  STEREO,
  testSignalRender,
  type TestSignalRender,
} from './test-signal.js';

/** What rendering is made of: the host, and the scheduler its jobs queue on. */
export interface RenderParts {
  readonly host: RenderHost;
  readonly scheduler: Pick<
    PriorityScheduler,
    'setInteractive' | 'setPolicy' | 'setBackgroundConcurrencyWhileInteractive'
  >;
}

/** How a render asked for began. */
export type RenderStart =
  | { readonly kind: 'started'; readonly strategy: RenderStrategy }
  /** A warning offers a safer strategy, and the person is asked to choose; `told` says what to. */
  | { readonly kind: 'awaiting-decision'; readonly told: string }
  | { readonly kind: 'refused'; readonly reasons: Reasons };

/** Which of the two strategies a waiting render runs under. */
export const RenderDecision = {
  /** The safer strategy the warning offers. */
  Safer: 'safer',
  /** The strategy chosen, over the warning. */
  AsChosen: 'as-chosen',
} as const;

/** Which of the two strategies a waiting render runs under. */
export type RenderDecision = (typeof RenderDecision)[keyof typeof RenderDecision];

/** Whether the person is playing, which is interactive work the scheduler puts first. */
function playing(view: AudioView): boolean {
  const mode = view.playback?.transport.mode;
  return mode === TransportMode.Playing || mode === TransportMode.Suspended;
}

/** What a waiting render asks the person, in one announcement. */
function decisionAsked(assessment: ContestedAssessment): string {
  const warned = assessment.strategy.plan.warnings.map((warning) => warning.explanation);
  return `${warned.join(' ')} Render in the background, or render as chosen?`;
}

/** Renders the test signal offline. */
export class RenderControl {
  readonly #view: AudioViewStore;
  readonly #settings: Observable<AudioSettings>;
  readonly #strategy: RenderStrategyStore;
  readonly #open: (settings: PerformanceSettings) => Promise<DomainResult<RenderParts>>;
  readonly #resources: () => ResourceFigures;
  readonly #now: () => number;
  readonly #announce: (text: string) => void;
  readonly #logger: Logger;
  /** Cancels a render running when the application is taken down. */
  readonly #cancellation = new AbortController();
  #parts: Promise<DomainResult<RenderParts>> | undefined;
  #stopFollowing: (() => void) | undefined;
  /** The render waiting on the person's decision, as it was built when assessed. */
  #waiting: TestSignalRender | undefined;
  /** The frames the running render has reached. */
  #framesRendered = 0;

  constructor(options: {
    readonly view: AudioViewStore;
    /** The person's audio settings: the profile, the priority policy and any render mode set. */
    readonly settings: Observable<AudioSettings>;
    readonly strategy: RenderStrategyStore;
    /** Makes the parts, starting from `settings`; called on the first render. */
    readonly open: (settings: PerformanceSettings) => Promise<DomainResult<RenderParts>>;
    /** What the machine has left now, from the capability probes. */
    readonly resources: () => ResourceFigures;
    /** Milliseconds on a monotonic clock, for the time a render took. */
    readonly now: () => number;
    readonly announce: (text: string) => void;
    readonly logger: Logger;
  }) {
    this.#view = options.view;
    this.#settings = options.settings;
    this.#strategy = options.strategy;
    this.#open = options.open;
    this.#resources = options.resources;
    this.#now = options.now;
    this.#announce = options.announce;
    this.#logger = options.logger;
  }

  /**
   * Assesses a render of the test signal and starts it, or asks the person to
   * decide how it runs, or says why it cannot start.
   */
  render(): RenderStart {
    const settings = this.#settings.get();
    const render = testSignalRender(
      settings.chosen.settings.renderChunkMilliseconds,
      settings.renderQuality,
    );
    if (!render.ok) return { kind: 'refused', reasons: reasonsOf(render.failures) };
    const { request } = render.value;
    const { availableMemoryBytes } = this.#resources();
    const { measuredCostRatio } = this.#strategy.get();
    const assessed = assessRender({
      frames: request.range.length,
      // What a render hands back is its output, in the test signal's layout.
      channels: channelCount(STEREO),
      sampleRate: request.sampleRate,
      settings: settings.chosen.settings,
      ...(availableMemoryBytes === undefined ? {} : { availableMemoryBytes }),
      ...(measuredCostRatio === undefined ? {} : { measuredCostRatio }),
      ...(settings.renderMode === undefined ? {} : { override: settings.renderMode }),
    });
    if (!assessed.ok) return { kind: 'refused', reasons: reasonsOf(assessed.failures) };
    const { strategy, safer } = assessed.value;
    if (safer !== undefined) {
      const contested = { strategy, safer };
      this.#waiting = render.value;
      this.#strategy.awaitDecision(contested);
      return { kind: 'awaiting-decision', told: decisionAsked(contested) };
    }
    this.#start(render.value, strategy);
    return { kind: 'started', strategy };
  }

  /**
   * Starts the render waiting on the person's decision, under the strategy
   * they chose, or says there is none waiting.
   */
  proceed(decision: RenderDecision): RenderStart {
    const contested = awaitingDecision(this.#strategy.get());
    const waiting = this.#waiting;
    if (contested === undefined || waiting === undefined) {
      return { kind: 'refused', reasons: ['No render is waiting for a decision.'] };
    }
    this.#waiting = undefined;
    const strategy = decision === RenderDecision.Safer ? contested.safer : contested.strategy;
    this.#start(waiting, strategy);
    return { kind: 'started', strategy };
  }

  /**
   * The frames the running render has reached, as its worker last reported,
   * for a display to read where it shows them: a report comes with every
   * chunk, far oftener than anything reading it redraws.
   */
  framesRendered(): number {
    return this.#framesRendered;
  }

  /** Cancels a render that is running and stops following the settings and playback. */
  dispose(): void {
    this.#cancellation.abort();
    this.#stopFollowing?.();
  }

  #start(render: TestSignalRender, strategy: RenderStrategy): void {
    this.#strategy.decide(strategy);
    // Measured again as it starts, which may be after the person decided: the
    // tables of its conversions get what the page has left beside a chunk.
    const budget = conversionTableBudget(
      {
        channels: channelCount(STEREO),
        availableMemoryBytes: this.#resources().availableMemoryBytes,
      },
      strategy.plan,
    );
    const request = {
      ...render.request,
      chunkFrames: strategy.plan.chunkFrames,
      ...(budget === undefined ? {} : { coefficientBudgetBytes: budget }),
    };
    this.#framesRendered = 0;
    this.#view.renderStarted(request.range.length);
    // The one place a render's promise ends: whatever escapes the render's
    // own handling is a fault, reported rather than left unobserved.
    this.#run({ ...render, request }, strategy).catch((thrown: unknown) => {
      this.#logger.error('An offline render failed in a way it could not report.', {
        reason: thrown instanceof Error ? thrown.message : typeof thrown,
      });
      this.#failed(['The render stopped unexpectedly. The diagnostic log has the details.']);
    });
  }

  async #run({ request, output }: TestSignalRender, strategy: RenderStrategy): Promise<void> {
    try {
      const parts = await this.#ready();
      if (!parts.ok) {
        this.#failed(reasonsOf(parts.failures));
        return;
      }
      const sink = fingerprintSink();
      const started = this.#now();
      const rendered = await parts.value.host.render(request, {
        priority: strategy.priority,
        signal: this.#cancellation.signal,
        onProgress: (progress) => {
          // Kept, not published: the panel reads it once a display frame.
          this.#framesRendered = progress.framesRendered;
        },
        sinks: new Map([[output, sink]]),
      });
      if (!rendered.ok) {
        this.#failed(reasonsOf(rendered.failures));
        return;
      }
      const { frames, dsp, dspFallbackReason } = rendered.value;
      const milliseconds = this.#now() - started;
      this.#view.renderFinished({
        frames,
        sampleRate: RENDER_SAMPLE_RATE,
        milliseconds,
        dsp,
        fallbackReason: dspFallbackReason,
        fingerprint: sink.fingerprint(),
      });
      if (frames > 0) {
        this.#strategy.measured(milliseconds / 1000 / (frames / RENDER_SAMPLE_RATE));
      }
      this.#announce(`The test signal rendered in ${durationText(milliseconds)}.`);
    } catch (error) {
      // A worker or its code that could not be loaded, or the render cancelled
      // because the application is being taken down, which nobody is left to
      // hear. Anything that is not an error goes on to the terminal handler.
      if (!(error instanceof Error)) throw error;
      if (this.#cancellation.signal.aborted) return;
      this.#failed([`The render stopped: ${error.message}`]);
    }
  }

  /**
   * The parts, made on the first render. A failure to make them is made again
   * by the next render: a chunk that could not be fetched once may be later.
   */
  async #ready(): Promise<DomainResult<RenderParts>> {
    const pending = (this.#parts ??= this.#open(this.#settings.get().chosen.settings));
    const forget = (): void => {
      if (this.#parts === pending) this.#parts = undefined;
    };
    const parts = await pending.catch((error: unknown) => {
      forget();
      throw error;
    });
    if (!parts.ok) forget();
    else if (this.#stopFollowing === undefined) this.#follow(parts.value);
    return parts;
  }

  /** Keeps the scheduler to the person's settings and playback from now on. */
  #follow(parts: RenderParts): void {
    const apply = (): void => {
      const settings = this.#settings.get();
      parts.scheduler.setInteractive(playing(this.#view.get()));
      parts.scheduler.setPolicy(settings.priorityPolicy);
      const limited = parts.scheduler.setBackgroundConcurrencyWhileInteractive(
        settings.chosen.settings.backgroundConcurrencyWhileInteractive,
      );
      // Every profile's limit is a whole number of at least one: a preset's as
      // written, a Custom one as the settings store validated it. The limit is
      // the one thing the scheduler refuses, so a refusal is a defect.
      if (!limited.ok) throw new Error(limited.failures[0].summary);
    };
    apply();
    const stopView = this.#view.subscribe(apply);
    const stopSettings = this.#settings.subscribe(apply);
    this.#stopFollowing = () => {
      stopView();
      stopSettings();
    };
  }

  #failed(reasons: Reasons): void {
    this.#view.renderFailed(reasons);
    this.#announce(reasons.join(' '));
  }
}

/** Whether a render is running, which one render at a time allows no second of. */
export function rendering(view: AudioView): boolean {
  return view.render.stage === RenderStage.Running;
}
