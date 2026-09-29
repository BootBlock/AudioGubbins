/**
 * The public contract of the AudioGubbins audio runtime.
 *
 * The browser host of the audio engine (ADR-0030): the audio context and its
 * lifecycle, the compilation of the canonical DSP module, real-time playback
 * through the engine's AudioWorklet processor, and offline renders in
 * workers. It is given what the device offers and never probes it; the
 * modules the browser loads by URL, the worklet processor, the feeder worker
 * that feeds it and the render worker, are its `./threads/*` entry points.
 */

export {
  AudioContextState,
  type AudioContextPort,
  type CreateAudioContext,
  browserAudioContext,
} from './context/audio-context-port.js';

export {
  ContextLifecycle,
  type ContextLifecycleOptions,
  type LifecycleEvent,
  LifecycleEventKind,
  type LifecycleListener,
  LifecycleState,
} from './context/context-lifecycle.js';

export { type DeviceReport } from './context/device-report.js';

export {
  type DspModuleAvailability,
  DspModuleAvailabilityKind,
  compileDspModule,
} from './dsp/dsp-module.js';

export { type PlaybackThreads } from './playback/graph-loader.js';

export { type FeederWorkerEvents, type FeederWorkerPort } from './playback/feeder-link.js';

export { type ChannelEnds } from './playback/loaded-processor.js';

export { type PlaybackDsp, PlaybackDspKind } from './playback/playback-dsp.js';

export {
  type PlaybackListener,
  type PlaybackRequest,
  PlaybackSession,
  type PlaybackSessionOptions,
} from './playback/playback-session.js';

export { PLAYBACK_SUPERSEDED } from './playback/superseded.js';

export {
  type DspStatus,
  type MeterLevels,
  PlaybackPhase,
  type PlaybackStatus,
} from './playback/playback-status.js';

export { type SourceDescription, SourceKind } from './protocol/source-descriptions.js';

export {
  type RenderRequest,
  type RenderRunOptions,
  type WorkerRenderSummary,
} from './render/render-request.js';

export { type RenderWorkerPort } from './render/worker-render.js';

export { type RenderHost, type RenderHostOptions, createRenderHost } from './render/render-host.js';
