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
 * worker load it (ADR-0030). The DSP module is compiled here once, on the main
 * thread, and posted to each render worker; the worklet is given its bytes.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';
import type { AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import {
  PRESET_SETTINGS,
  createPriorityScheduler,
  type PresetProfile,
} from '@audiogubbins/audio-engine';
import {
  DspModuleAvailabilityKind,
  PlaybackSession,
  compileDspModule,
  createRenderHost,
  type ContextLifecycle,
  type DspModuleAvailability,
  type PlaybackSessionOptions,
} from '@audiogubbins/audio-runtime';
import engineProcessorUrl from '@audiogubbins/audio-runtime/threads/engine-processor.ts?worker&url';
import renderWorkerUrl from '@audiogubbins/audio-runtime/threads/render-worker.ts?worker&url';
import { DSP_MODULE_BYTES } from 'virtual:audiogubbins/dsp-module';

import { browserSchedule } from './browser-schedule.js';
import type { PlaybackSessionPort } from './playback-control.js';
import type { RenderParts } from './render-control.js';

/**
 * How many renders run at once. Two, so a second render the person asks for
 * does not wait behind a long one, and no more, since each is a thread and a
 * module instance of its own and a device with few cores is not asked to host
 * a queue of them (REQ-ARCH-087).
 */
const RENDER_CONCURRENCY = 2;

/** The DSP as the render host is given it: the module, or why there is none. */
function renderDsp(
  availability: DspModuleAvailability,
): { readonly module: WebAssembly.Module } | { readonly unavailable: string } {
  return availability.kind === DspModuleAvailabilityKind.Compiled
    ? { module: availability.module }
    : { unavailable: availability.reason };
}

/**
 * The DSP as the worklet is given it: the module's bytes, which the processor
 * compiles in its own scope, since a browser may refuse a compiled module
 * posted to a worklet; or, where this page could not compile them, why not,
 * so the worklet reports the same reason rather than failing on its own.
 */
function workletDsp(availability: DspModuleAvailability): PlaybackSessionOptions['dsp'] {
  return availability.kind === DspModuleAvailabilityKind.Compiled
    ? { kind: 'bytes', bytes: DSP_MODULE_BYTES }
    : { kind: 'unavailable', reason: availability.reason };
}

/** What a session is made with, beside what the engine brings. */
export interface SessionOptions {
  readonly lifecycle: ContextLifecycle;
  readonly profile: PresetProfile;
  readonly logger: Logger;
}

/** The engine, loaded, with its DSP compiled: what every session and render of the page shares. */
export interface BrowserEngine {
  readonly openSession: (options: SessionOptions) => PlaybackSessionPort;
  readonly openRendering: (profile: PresetProfile) => DomainResult<RenderParts>;
}

/** The engine, with the DSP module compiled from the bytes the bundle carries. */
export async function browserEngine(
  capabilities: AudioRuntimeCapabilities,
): Promise<BrowserEngine> {
  const dspModule = await compileDspModule(DSP_MODULE_BYTES, capabilities);
  return {
    openSession: ({ lifecycle, profile, logger }) =>
      new PlaybackSession({
        lifecycle,
        capabilities,
        dsp: workletDsp(dspModule),
        profile,
        settings: PRESET_SETTINGS[profile],
        workletModuleUrl: engineProcessorUrl,
        schedule: browserSchedule,
        logger,
      }),
    openRendering: (profile) =>
      mapResult(
        createPriorityScheduler({
          concurrency: RENDER_CONCURRENCY,
          backgroundConcurrencyWhileInteractive:
            PRESET_SETTINGS[profile].backgroundConcurrencyWhileInteractive,
        }),
        (scheduler) => ({
          scheduler,
          host: createRenderHost({
            // A module worker: the development server serves it as a module
            // with imports, and the build's single file runs as one as well.
            createWorker: () => new Worker(renderWorkerUrl, { type: 'module' }),
            scheduler,
            dsp: renderDsp(dspModule),
            schedule: browserSchedule,
          }),
        }),
      ),
  };
}
