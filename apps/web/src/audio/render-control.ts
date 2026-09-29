/**
 * Rendering the test signal offline, and following the person's profile and
 * playback with the scheduler the renders queue on.
 *
 * The render host, its scheduler and the DSP module are made on the first
 * render, not at start-up. Each render runs in a worker of its own, at
 * foreground priority, since a person asked for it and is waiting on it
 * (REQ-ARCH-084); what the main thread does per chunk is fingerprint it. The
 * profile sets the chunk length and how many background jobs may run beside
 * playback, and neither changes a bit of what is rendered.
 */

import type { DomainResult } from '@audiogubbins/domain';
import {
  JobPriority,
  PRESET_SETTINGS,
  TransportMode,
  type PresetProfile,
  type PriorityScheduler,
} from '@audiogubbins/audio-engine';
import type { RenderHost } from '@audiogubbins/audio-runtime';

import { RenderStage, type AudioView, type AudioViewStore } from '../state/audio-view-store.js';
import { reasonsOf, type Reasons } from '../state/reasons.js';
import { fingerprintSink } from './fingerprint-sink.js';
import { RENDER_SAMPLE_RATE, testSignalRender, type TestSignalRender } from './test-signal.js';

/** What rendering is made of: the host, and the scheduler its jobs queue on. */
export interface RenderParts {
  readonly host: RenderHost;
  readonly scheduler: Pick<
    PriorityScheduler,
    'setInteractive' | 'setBackgroundConcurrencyWhileInteractive'
  >;
}

/** Whether the person is playing, which is interactive work the scheduler puts first. */
function playing(view: AudioView): boolean {
  const mode = view.playback?.transport.mode;
  return mode === TransportMode.Playing || mode === TransportMode.Suspended;
}

/** Renders the test signal offline. */
export class RenderControl {
  readonly #view: AudioViewStore;
  readonly #open: (profile: PresetProfile) => Promise<DomainResult<RenderParts>>;
  readonly #now: () => number;
  readonly #announce: (text: string) => void;
  /** Cancels a render running when the application is taken down. */
  readonly #cancellation = new AbortController();
  #parts: Promise<DomainResult<RenderParts>> | undefined;
  #stopFollowing: (() => void) | undefined;

  constructor(options: {
    readonly view: AudioViewStore;
    /** Makes the parts for the profile chosen; called on the first render. */
    readonly open: (profile: PresetProfile) => Promise<DomainResult<RenderParts>>;
    /** Milliseconds on a monotonic clock, for the time a render took. */
    readonly now: () => number;
    readonly announce: (text: string) => void;
  }) {
    this.#view = options.view;
    this.#open = options.open;
    this.#now = options.now;
    this.#announce = options.announce;
  }

  /** Starts a render of the test signal, or says why it cannot start. */
  render(): Reasons | undefined {
    const settings = PRESET_SETTINGS[this.#view.get().profile];
    const render = testSignalRender(settings.renderChunkMilliseconds);
    if (!render.ok) return reasonsOf(render.failures);
    this.#view.renderProgressed(0, render.value.request.range.length);
    void this.#run(render.value);
    return undefined;
  }

  /** Cancels a render that is running and stops following the view. */
  dispose(): void {
    this.#cancellation.abort();
    this.#stopFollowing?.();
  }

  async #run({ request, output }: TestSignalRender): Promise<void> {
    try {
      const parts = await this.#ready();
      if (!parts.ok) {
        this.#failed(reasonsOf(parts.failures));
        return;
      }
      const sink = fingerprintSink();
      const started = this.#now();
      const rendered = await parts.value.host.render(request, {
        priority: JobPriority.Foreground,
        signal: this.#cancellation.signal,
        onProgress: (progress) => {
          this.#view.renderProgressed(progress.framesRendered, progress.framesTotal);
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
      this.#announce(`The test signal rendered in ${(milliseconds / 1000).toFixed(1)} seconds.`);
    } catch (error) {
      // A worker or its code that could not be loaded, or the render cancelled
      // because the application is being taken down, which nobody is left to
      // hear.
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
    const pending = (this.#parts ??= this.#open(this.#view.get().profile));
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

  /** Keeps the scheduler to the person's profile and playback from now on. */
  #follow(parts: RenderParts): void {
    const apply = (): void => {
      const view = this.#view.get();
      parts.scheduler.setInteractive(playing(view));
      const limited = parts.scheduler.setBackgroundConcurrencyWhileInteractive(
        PRESET_SETTINGS[view.profile].backgroundConcurrencyWhileInteractive,
      );
      // A preset's limit is a whole number of at least one, the one thing the
      // scheduler refuses, so a refusal is a preset written wrongly.
      if (!limited.ok) throw new Error(limited.failures[0].summary);
    };
    apply();
    this.#stopFollowing = this.#view.subscribe(apply);
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
