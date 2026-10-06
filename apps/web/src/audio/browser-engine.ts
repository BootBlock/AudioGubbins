/**
 * The audio engine as the browser runs it, which the page does not carry until
 * audio is first asked for.
 *
 * Reached by `import()` alone, from `browser-audio.ts`, so the first paint of
 * someone who never presses Play or Render loads none of it: not the DSP
 * module's bytes, not the thread modules, and not the session, the graph
 * compiler, the scheduler or the render host. The bytes come through the
 * bundle rather than a request, since the page makes none (REQ-PRIV-161), and
 * the bundler builds each thread module on its own, as the worklet and the
 * workers load it (ADR-0030). The DSP module is compiled here once, on the
 * main thread, and the session and the render host are each given the result,
 * which they post to the feeder worker and each render worker compiled and to
 * the worklet as bytes. Each feeder is connected to the preview worker, whose
 * renders it plays the chains it cannot run as they play from (ADR-0061).
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';
import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  CachePurpose,
  createPriorityScheduler,
  type PerformanceSettings,
} from '@audiogubbins/audio-engine';
import {
  PlaybackSession,
  compileDspModule,
  createRenderHost,
  type ContextLifecycle,
  type PlaybackThreads,
  type PreviewHost,
} from '@audiogubbins/audio-runtime';
import engineProcessorUrl from '@audiogubbins/audio-runtime/threads/engine-processor.ts?worker&url';
import feederWorkerUrl from '@audiogubbins/audio-runtime/threads/feeder-worker.ts?worker&url';
import renderWorkerUrl from '@audiogubbins/audio-runtime/threads/render-worker.ts?worker&url';
import { DSP_MODULE_BYTES } from 'virtual:audiogubbins/dsp-module';

import type { ChosenProfile } from '../state/audio-settings-store.js';
import { browserSchedule } from './browser-schedule.js';
import type { PlaybackSessionPort } from './playback-parts.js';
import type { RenderParts } from './render-control.js';

/**
 * How many renders run at once. Two, so a second render the person asks for
 * does not wait behind a long one, and no more, since each is a thread and a
 * module instance of its own and a device with few cores is not asked to host
 * a queue of them (REQ-ARCH-087).
 */
const RENDER_CONCURRENCY = 2;

/**
 * The feeder worker, a module worker as the render worker is, the channel it
 * feeds the worklet on, and its connection to the preview worker.
 */
function playbackThreads(previews: PreviewHost): PlaybackThreads {
  return {
    createFeeder: () => new Worker(feederWorkerUrl, { type: 'module' }),
    createChannel: () => new MessageChannel(),
    connectPreviews: () => previews.connect(CachePurpose.Playback),
  };
}

/** What a session is made with, beside what the engine brings. */
export interface SessionOptions {
  readonly lifecycle: ContextLifecycle;
  readonly profile: ChosenProfile;
  readonly logger: Logger;
}

/** The engine, loaded, with its DSP compiled: what every session and render of the page shares. */
export interface BrowserEngine {
  readonly openSession: (options: SessionOptions) => PlaybackSessionPort;
  readonly openRendering: (settings: PerformanceSettings) => DomainResult<RenderParts>;
}

/** The engine, with the DSP module compiled from the bytes the bundle carries. */
export async function browserEngine(
  capabilities: AudioRuntimeCapabilities,
  previews: PreviewHost,
): Promise<BrowserEngine> {
  const dspModule = await compileDspModule(DSP_MODULE_BYTES, capabilities);
  const threads = playbackThreads(previews);
  return {
    openSession: ({ lifecycle, profile, logger }) =>
      new PlaybackSession({
        lifecycle,
        capabilities,
        dsp: dspModule,
        profile: profile.profile,
        settings: profile.settings,
        workletModuleUrl: engineProcessorUrl,
        threads,
        schedule: browserSchedule,
        logger,
      }),
    openRendering: (settings) =>
      mapResult(
        createPriorityScheduler({
          concurrency: RENDER_CONCURRENCY,
          backgroundConcurrencyWhileInteractive: settings.backgroundConcurrencyWhileInteractive,
        }),
        (scheduler) => ({
          scheduler,
          host: createRenderHost({
            // A module worker: the development server serves it as a module
            // with imports, and the build's single file runs as one as well.
            createWorker: () => new Worker(renderWorkerUrl, { type: 'module' }),
            scheduler,
            dsp: dspModule,
            schedule: browserSchedule,
          }),
        }),
      ),
  };
}
