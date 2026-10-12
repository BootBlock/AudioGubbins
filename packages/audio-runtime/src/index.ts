/**
 * The public contract of the AudioGubbins audio runtime.
 *
 * The browser host of the audio engine (ADR-0030): the audio context and its
 * lifecycle, the compilation of the canonical DSP module, real-time playback
 * through the engine's AudioWorklet processor, and offline renders in workers,
 * and capture from an input the application opened, through the capture
 * processor (ADR-0070). It is given what the device offers and never probes it;
 * the modules the browser loads by URL, the worklet processor, the capture
 * processor, the feeder worker that feeds the first, the render worker and the
 * preview worker that makes cached preview renders, are its `./threads/*` entry
 * points. The reader of a take's capture channel, which the storage worker
 * uses, is offered here and, on its own, as the `./capture-channel` entry
 * point, which a worker's scope can compile without the page's modules.
 */

export {
  AudioContextState,
  type AudioContextPort,
  type CreateAudioContext,
  type MediaStreamSourcePort,
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

export { type CompiledDspModule } from './dsp/dsp-delivery.js';

export { compileDspModule } from './dsp/dsp-module.js';

export { type PlaybackThreads } from './playback/playback-threads.js';

export { type FeederWorkerEvents, type FeederWorkerPort } from './playback/feeder-link.js';

export { type ChannelEnds } from './playback/channel-ends.js';

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

export { type GpuUse, GpuUseKind } from './playback/gpu-use.js';

export { type SourceDescription } from './protocol/source-descriptions.js';

export {
  type RenderRequest,
  type RenderRunOptions,
  type WorkerRenderSummary,
} from './render/render-request.js';

export { type RenderWorkerPort } from './render/worker-render.js';

export { type RenderHost, type RenderHostOptions, createRenderHost } from './render/render-host.js';

export {
  type PreviewConnection,
  PreviewHost,
  type PreviewHostOptions,
  type PreviewRenders,
  type PreviewWorkerPort,
} from './preview/preview-host.js';

export {
  type CaptureListener,
  CaptureSession,
  type CaptureSessionEvent,
  type CaptureSessionOptions,
  type CaptureSource,
  type MonitoringLatency,
} from './capture-session/capture-session.js';

export {
  FromCaptureKind,
  type FromCapture,
  type InputMeterReport,
  ToCaptureKind,
} from './protocol/capture-messages.js';

export {
  type CaptureEvent,
  CaptureReader,
  type CaptureReaderOptions,
} from './capture/capture-reader.js';
