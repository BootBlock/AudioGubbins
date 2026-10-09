/**
 * The audio part's real collaborators, each made when a command first needs
 * it: the browser's audio context here, held for playback and the inputs alike
 * by `context-host.ts`, and the engine, from the module the page loads only
 * then.
 *
 * The context is made by this module, which the page carries from the start,
 * because it is made and started inside the person's gesture, before anything
 * is awaited; the engine that plays through it follows once loaded. The
 * composition root hands these to the playback and render controls, which
 * take them as functions so their tests hand them fakes: jsdom has no audio
 * context, worklet or worker, and a real one would answer to the machine's
 * devices rather than to the test.
 */

import { mapResult, type DomainResult } from '@audiogubbins/domain';
import { watchAudioDevices, type AudioRuntimeCapabilities } from '@audiogubbins/capabilities';
import type { Logger } from '@audiogubbins/diagnostics';
import type { PerformanceSettings } from '@audiogubbins/audio-engine';
import {
  ContextLifecycle,
  browserAudioContext,
  type PreviewHost,
} from '@audiogubbins/audio-runtime';

import type { ModelServices } from '../ml/model-services.js';
import type { BrowserEngine } from './browser-engine.js';
import { browserSchedule } from './browser-schedule.js';
import type { OpenCapture } from './capture-parts.js';
import { AudioContextHost } from './context-host.js';
import type { OpenPlayback } from './playback-parts.js';
import type { RenderParts } from './render-control.js';

/**
 * The engine, loaded and its DSP compiled on first use and shared by every
 * session and render after it: compiling is the expensive half of WebAssembly,
 * and the compiled module is posted unchanged to the feeder worker and each
 * render worker. The AudioWorklet alone compiles its own, from the bytes. Each
 * feeder reads its cached previews from `previews`, and each feeder and render
 * worker runs a chain's models through `models`.
 */
export function browserEngineLoader(
  capabilities: AudioRuntimeCapabilities,
  previews: PreviewHost,
  models: Pick<ModelServices, 'startChainWorker'>,
): () => Promise<BrowserEngine> {
  let loading: Promise<BrowserEngine> | undefined;
  return () => {
    if (loading !== undefined) return loading;
    const attempt = import('./browser-engine.js').then(({ browserEngine }) =>
      browserEngine(capabilities, previews, models),
    );
    loading = attempt;
    // Whoever awaits the attempt hears its failure; this only lets the next
    // command try again, since a chunk that could not be fetched once may be.
    void attempt.catch(() => {
      if (loading === attempt) loading = undefined;
    });
    return attempt;
  };
}

/** The host of the page's one audio context, each made in the browser when first asked for. */
export function browserContextHost(
  capabilities: AudioRuntimeCapabilities,
  logger: Logger,
): AudioContextHost {
  return new AudioContextHost(
    (latencyHint, rate) =>
      new ContextLifecycle({
        createContext: browserAudioContext(capabilities),
        watchDevices: watchAudioDevices,
        latencyHint,
        ...(rate === undefined ? {} : { sampleRate: rate }),
        schedule: browserSchedule,
        logger,
      }),
    logger,
  );
}

/** What the browser's audio parts are made from. */
export interface BrowserAudioOptions {
  readonly host: AudioContextHost;
  readonly engine: () => Promise<BrowserEngine>;
  readonly logger: Logger;
}

/**
 * A hold on the page's context and a session over it, for a profile, the
 * context made when first asked for, at the programme's rate where it has one.
 */
export function browserPlayback(options: BrowserAudioOptions): OpenPlayback {
  const { host, engine, logger } = options;
  return (profile, rate) => {
    const { lifecycle, release } = host.own(profile.settings.latencyHint, rate);
    return {
      // The session's Play asks the context to run again, and says why where
      // it would not, so this first request, made inside the gesture, has no
      // refusal of its own to report. A fault is another matter: nothing
      // awaits this request, so it is recorded here.
      startContext: () => {
        void lifecycle.ensureRunning().catch((error: unknown) => {
          logger.error('The audio context could not be started.', {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
      },
      // The lifecycle remembers a context the browser would not make, so the
      // Play that reads the rate hears that reason rather than a second try.
      contextRate: () => mapResult(lifecycle.context(), (context) => context.sampleRate),
      session: engine().then((loaded) => loaded.openSession({ lifecycle, profile, logger })),
      close: () => {
        release();
        return Promise.resolve();
      },
    };
  };
}

/** A capture session in the context `lifecycle` runs, once the engine's DSP is compiled. */
export function browserCapture(engine: () => Promise<BrowserEngine>, logger: Logger): OpenCapture {
  return async (lifecycle) => (await engine()).openCapture({ lifecycle, logger });
}

/** The render host and its scheduler, starting from `settings`' share for background work. */
export function browserRendering(
  engine: () => Promise<BrowserEngine>,
): (settings: PerformanceSettings) => Promise<DomainResult<RenderParts>> {
  return async (settings) => (await engine()).openRendering(settings);
}
