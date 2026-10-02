/**
 * The public contract of the AudioGubbins audio engine.
 *
 * The audio core that runs on any thread (ADR-0030): the frame block and the
 * stream contract, the canonical DSP port and its two implementations, the
 * node types and the executor that runs a plan, the offline renderer, the
 * media clock and the transport, performance profiles, processing-mode
 * selection, the priority scheduler, resource-aware chunking and the render
 * strategy that composes the last three. Each is its own module with one rule
 * to keep, and none is a manager of the others.
 *
 * The package depends on the domain and the graph alone, and is compiled
 * without the browser's type definitions, so the same code runs in an
 * AudioWorklet, a worker and a Node test. The browser host that runs it is
 * `packages/audio-runtime`.
 */

export {
  type CancellationSignal,
  type CancellationSource,
  Cancelled,
  cancellationReason,
  createCancellationSource,
  throwIfCancelled,
} from './cancellation.js';

export {
  type AudioFrameBlock,
  allocateBlock,
  blockView,
  frameBlock,
  silence,
} from './pcm/frame-block.js';

export {
  type PcmSource,
  assertReadableInto,
  framesAvailable,
  offsetSource,
} from './pcm/pcm-source.js';

export { memorySource } from './pcm/memory-source.js';
export {
  type ChannelProgramme,
  type SignalRecipe,
  type SignalSegment,
  signalRecipe,
  toneRecipe,
} from './pcm/signal-recipe.js';
export { type SignalSettings, signalSource } from './pcm/signal-source.js';
export {
  type PcmDescription,
  PcmDescriptionKind,
  describedBuffers,
  describedSource,
  pcmDescription,
} from './pcm/pcm-description.js';
export { resampledSource } from './pcm/resampled-source.js';
export { type MediaEntry, MediaReadFailure, editedSource } from './pcm/edited-source.js';
export { type MediaFile, isMediaFile } from './pcm/media-file.js';

export {
  type CanonicalDsp,
  type CanonicalOscillator,
  type CanonicalResampler,
  CoefficientStrategy,
  DspImplementation,
  type OscillatorSettings,
  type ResamplerCoefficients,
  type ResamplerSettings,
  ResamplingQuality,
} from './dsp/canonical-dsp.js';

// The fallback ADR-0031 names, for a host whose WebAssembly is refused.
export { REFERENCE_DSP } from './dsp/reference/reference-dsp.js';
export { wasmDsp } from './dsp/wasm/wasm-dsp.js';

export {
  type InputFeed,
  type KernelContext,
  type MeterReading,
  type MeterTarget,
  type NodeImplementation,
  type NodeImplementations,
  type NodeKernel,
  type SinkTarget,
} from './nodes/node-implementation.js';

export { Accelerator } from './nodes/accelerator.js';

export {
  type AvailableAccelerators,
  type NodePath,
  PathReason,
  selectNodePaths,
} from './nodes/accelerated-paths.js';

export { BuiltInNodeType } from './nodes/built-in-node-type.js';
export { BUILT_IN_NODES } from './nodes/built-in-nodes.js';

export { type GraphExecutor, createExecutor } from './execution/graph-executor.js';

export {
  MAXIMUM_RENDER_QUALITY,
  type RenderConversion,
  type RenderJob,
  type RenderOptions,
  type RenderProgress,
  type RenderQualityProfile,
  type RenderRange,
  type RenderSink,
  type RenderSummary,
} from './render/render-job.js';
export { renderOffline } from './render/offline-renderer.js';

export {
  type ClockAnchor,
  type MediaClock,
  audibleFrame,
  contextFrameFor,
  timelineFrameAt,
} from './transport/media-clock.js';

export {
  TRANSPORT_AT_START,
  type TransportEvent,
  TransportMode,
  type TransportState,
  nextTransportState,
  transportPosition,
} from './transport/transport.js';

export {
  LATENCY_CATEGORIES,
  type LatencyCategory,
  type LatencyHint,
  isLatencyHint,
  PRESET_SETTINGS,
  PerformanceProfile,
  type PerformanceSettings,
  type PresetProfile,
  settingsFor,
  validatePerformanceSettings,
} from './profiles/performance-profile.js';

export {
  ProcessingMode,
  type ProcessingModeChoice,
  type ProcessingModeRequest,
  ProcessingPurpose,
  availableProcessingModes,
  selectProcessingMode,
} from './profiles/processing-mode.js';

export {
  STABILITY_WINDOW_SECONDS,
  type StabilityAssessment,
  UnderrunHistory,
  assessStability,
} from './profiles/stability.js';

export {
  JobPriority,
  type PriorityScheduler,
  type PrioritySchedulerOptions,
  type ScheduledJob,
  type SchedulerCounts,
  SchedulingPolicy,
  createPriorityScheduler,
} from './scheduling/priority-scheduler.js';

export {
  type ChunkPlan,
  type ChunkPlanRequest,
  type LimitingResource,
  type ResourceWarning,
  type WorkloadEstimate,
  type WorkloadShape,
  conversionTableBudget,
  estimateWorkload,
  planChunks,
} from './scheduling/workload.js';

export {
  type RenderAssessment,
  type RenderStrategy,
  type RenderStrategyRequest,
  assessRender,
} from './scheduling/render-strategy.js';
