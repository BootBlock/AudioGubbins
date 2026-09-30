/**
 * The audio part's real collaborators, each made when a command first needs
 * it: the browser's audio context here, and the engine, from the module the
 * page loads only then.
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
import { ContextLifecycle, browserAudioContext } from '@audiogubbins/audio-runtime';

import type { BrowserEngine } from './browser-engine.js';
import { browserSchedule } from './browser-schedule.js';
import type { OpenPlayback } from './playback-control.js';
import type { RenderParts } from './render-control.js';

/**
 * The engine, loaded and its DSP compiled on first use and shared by every
 * session and render after it: compiling is the expensive half of WebAssembly,
 * and the compiled module is posted unchanged to the feeder worker and each
 * render worker. The AudioWorklet alone compiles its own, from the bytes.
 */
export function browserEngineLoader(
  capabilities: AudioRuntimeCapabilities,
): () => Promise<BrowserEngine> {
  let loading: Promise<BrowserEngine> | undefined;
  return () => {
    if (loading !== undefined) return loading;
    const attempt = import('./browser-engine.js').then(({ browserEngine }) =>
      browserEngine(capabilities),
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

/** What the browser's audio parts are made from. */
export interface BrowserAudioOptions {
  readonly capabilities: AudioRuntimeCapabilities;
  readonly engine: () => Promise<BrowserEngine>;
  readonly logger: Logger;
}

/**
 * A context's life and a session over it, for a profile, the context made when
 * first asked for, at the programme's rate where it has one.
 */
export function browserPlayback(options: BrowserAudioOptions): OpenPlayback {
  const { capabilities, engine, logger } = options;
  return (profile, rate) => {
    const lifecycle = new ContextLifecycle({
      createContext: browserAudioContext(capabilities),
      watchDevices: watchAudioDevices,
      latencyHint: profile.settings.latencyHint,
      ...(rate === undefined ? {} : { sampleRate: rate }),
      schedule: browserSchedule,
      logger,
    });
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
      close: () => lifecycle.close(),
    };
  };
}

/** The render host and its scheduler, starting from `settings`' share for background work. */
export function browserRendering(
  engine: () => Promise<BrowserEngine>,
): (settings: PerformanceSettings) => Promise<DomainResult<RenderParts>> {
  return async (settings) => (await engine()).openRendering(settings);
}
