/**
 * The public contract of the AudioGubbins domain.
 *
 * Everything another package may use is re-exported here. REQ-REPO-186 requires
 * cross-package access through a documented public entry point, and the
 * architecture rules reject an import that reaches past this file into `src/`.
 * Anything absent from this list is an internal detail that may change without
 * being a contract change.
 *
 * This package depends on nothing: no framework, no browser API, no other
 * AudioGubbins package. REQ-ARCH-151 requires core editing logic and project
 * state to be testable without rendering a component, and the surest way to
 * guarantee that is to give the domain nothing it could render with.
 */

export {
  type DomainFailure,
  type DomainFailureResult,
  type DomainResult,
  type DomainSuccess,
  FailureKind,
  combine,
  fail,
  failure,
  flatMapResult,
  isFailure,
  isRetryable,
  isSuccess,
  mapResult,
  succeed,
} from './result.js';

export {
  type CancellationSignal,
  type CancellationSource,
  Cancelled,
  cancellationReason,
  createCancellationSource,
  throwIfCancelled,
} from './cancellation.js';

export {
  type AssetId,
  type Branded,
  type BusId,
  type ClipId,
  type EditOperationId,
  type EffectChainId,
  type EntityId,
  type MarkerId,
  type ParameterId,
  type ProcessorGroupId,
  type ProcessorId,
  type ProjectId,
  type RegionId,
  type TrackId,
  isWellFormedId,
  unsafeBrandId,
} from './identity/branded-id.js';

export {
  type IdGenerator,
  createDeterministicIdGenerator,
  createIdGenerator,
} from './identity/id-generator.js';

export {
  type SampleCount,
  type SampleRate,
  ZERO_SAMPLES,
  addSamples,
  containsSample,
  convertSampleRate,
  derivedSampleCount,
  sampleCount,
  sampleRate,
  samplesToSeconds,
  secondsToSamples,
  subtractSamples,
} from './time/sample-time.js';

export {
  type AmbisonicConvention,
  AmbisonicNormalisation,
  AmbisonicOrdering,
  type ChannelLayout,
  ChannelRole,
  MAXIMUM_CHANNEL_COUNT,
  StandardLayouts,
  channelCount,
  channelIndexOf,
  channelLabelOf,
  channelLayout,
  discreteLayout,
  labelledLayout,
  layoutsMatch,
} from './audio/channel-layout.js';

export {
  type AmbisonicComponent,
  FIRST_ORDER_AMBIX,
  ambisonicChannelCount,
  ambisonicComponentOf,
  ambisonicLayout,
} from './audio/ambisonic-layout.js';

export {
  type Asset,
  AssetOrigin,
  type AssetRange,
  assetRangeEnd,
  assetRangeFitsAsset,
} from './project/asset.js';

export {
  type AnchoredLoop,
  type Clip,
  type LoopDefinition,
  type Marker,
  type PlacedMarker,
  type PlacedRegion,
  type Region,
  RegionBoundary,
  clipAssetId,
  clipEnd,
  clipsOverlap,
  regionEnd,
} from './project/timeline.js';

export {
  type ChannelEdit,
  type ChannelEditOperation,
  type EditOperation,
  type EditRange,
  type EditTarget,
  type LevelEdit,
  type RackEdit,
  type RangeEdit,
  type RegionOperation,
  MAXIMUM_EDIT_GAIN,
  isLevelEdit,
} from './editing/operations.js';
export { FadeDirection, FadeShape } from './editing/fades.js';

export {
  type EditPlan,
  type FadeCurve,
  type GainCurve,
  type PlanSegment,
  type PlanSource,
  type PlanStage,
  type PlanStream,
  type StreamProcessing,
  convertedFrameCount,
  planReadsAsset,
  segmentsLayout,
  segmentsLength,
  streamLength,
} from './editing/plan.js';

export { type EditShape, shapeAfter, shapesOf } from './editing/edit-shape.js';

export { Affinity, type AnchorResolver, type Span, anchorResolver } from './editing/anchors.js';

export { type ChannelMatrix, conversionMatrix } from './editing/channel-matrices.js';

export { type PlanContext, assetPlan, withRack } from './editing/plan-building.js';
export { type BlockPlace, applyStages, placeOf } from './editing/stage-arithmetic.js';
export { sliceSegment } from './editing/segment-list.js';
export { slicePlan } from './editing/plan-slicing.js';
export { type MediaShape, MAXIMUM_STRETCH_RATIO, validatePlan } from './editing/plan-validation.js';
export { editPlanFrom } from './editing/plan-decoding.js';
export {
  type ProjectChains,
  validateChain,
  validateOperation,
} from './editing/operation-validation.js';
export { validateMarker, validateRegion } from './editing/placement-validation.js';
export { restateRegion, splitRegion, splitWholeAsset } from './editing/region-split.js';
export {
  markersInRegion,
  placeMarkers,
  placeRegion,
  placeRegions,
  regionPlan,
} from './editing/placement.js';

export {
  type Bus,
  MAIN_OUTPUT,
  type RoutingTarget,
  type Track,
  isTrackAudible,
  routeToBus,
  routingPathToOutput,
} from './project/routing.js';

export {
  type ChoiceOption,
  type ChoiceParameterDescriptor,
  type NumericParameterDescriptor,
  type ParameterDescriptor,
  ParameterTaper,
  type ParameterValue,
  type ToggleParameterDescriptor,
  defaultParameterValue,
  validateParameterValue,
} from './processing/parameter.js';

export {
  type ChainBranch,
  type ChainSettings,
  type ChainSlot,
  type EffectChain,
  type ParallelGroup,
  type ProcessorInstance,
  SummingLaw,
  appliedSlots,
  chainLatency,
  instantiateProcessor,
  processorsOf,
  summingFactor,
  validateProcessorInstance,
} from './processing/effect-chain.js';

export {
  DeterminismClass,
  type ParameterValues,
  ProcessorCategory,
  type ProcessorDescriptor,
  type StateRequirement,
  type ProcessorSettings,
  parameterOf,
} from './processing/processor-descriptor.js';

export {
  type ModelIdentity,
  type ProcessorState,
  type ProcessorStateVersion,
  MAXIMUM_STATE_VALUES,
  checkStateVersion,
  isModelIdentity,
} from './processing/processor-version.js';

export {
  InferencePath,
  MAXIMUM_QUALITY,
  NAMED_QUALITY_LEVELS,
  type NamedQualityLevel,
  QualityLevel,
  type QualityMode,
  type QualitySettingKey,
  type QualitySettings,
  ResamplingGrade,
  qualityModeFrom,
  finalRenderSettings,
  namedQualityMode,
} from './processing/quality-mode.js';

export {
  MAXIMUM_CHAIN_SLOTS,
  MAXIMUM_GROUP_BRANCHES,
  MAXIMUM_GROUP_DEPTH,
  type ProcessorCatalogue,
  chainOutputLayout,
  validateChainShape,
} from './processing/chain-validation.js';

export {
  type FoundSlot,
  type SlotPlace,
  copyChain,
  copySlot,
  findSlot,
  withSlotAt,
  withSlotMoved,
  withSlotReplaced,
  withoutSlot,
} from './processing/chain-edits.js';

export { effectChainFrom } from './processing/chain-decoding.js';

export {
  EMPTY_LIBRARY,
  LONGEST_SAVED_NAME,
  type ProcessingLibrary,
  type SavedChain,
  type SavedPreset,
  savedName,
  withSaved,
  withoutSaved,
} from './processing/processing-library.js';

export { type ProcessorLatency } from './processing/processor-latency.js';
export {
  type DetectorFinding,
  type DetectorIdentity,
  FindingKind,
  type FindingMeasure,
  MeasureUnit,
  type Recommendation,
  type Treatment,
  type TreatmentStep,
} from './processing/audio-detection.js';

export {
  type Project,
  type AssetUsers,
  type ChainUsers,
  type ProjectSettings,
  assetUsers,
  chainUseCount,
  chainUsers,
  clipsOnTrack,
  createProject,
  isAssetInUse,
  projectLength,
  tracksInOrder,
} from './project/project.js';

export { crc32 } from './integrity/crc32.js';
