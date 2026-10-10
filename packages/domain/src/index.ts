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
  Malformed,
  type MessageFields,
  boundedItemsOf,
  bytesAt,
  countAt,
  countOf,
  countsAt,
  fieldsAt,
  fieldsOf,
  flagAt,
  flagOf,
  floatsAt,
  frameRangeAt,
  identifierAt,
  identifierOf,
  isTagged,
  itemsAt,
  itemsOf,
  nonEmptyObjectsAt,
  numberAt,
  numberOf,
  numbersAt,
  objectsAt,
  oneOf,
  oneOfValues,
  optionalBytesAt,
  optionalCountAt,
  optionalTextAt,
  qualityModeAt,
  rateAt,
  rateOf,
  readMessage,
  readValue,
  sampleArraysAt,
  sampleArraysOf,
  sampleCountAt,
  sampleCountOf,
  textAt,
  textOf,
  textsAt,
} from './messages/message-fields.js';
export {
  type FailureSummary,
  domainFailuresAt,
  failureSummaryAt,
  failureSummaryOf,
  optionalFailureSummaryAt,
} from './messages/failure-fields.js';

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
  type TakeId,
  type TakeStackId,
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
  type EngineVersions,
  type EditTarget,
  type LevelEdit,
  type PunchEdit,
  type RackEdit,
  type RangeEdit,
  type RegionOperation,
  MAXIMUM_EDIT_GAIN,
  editChain,
  takesChannelScope,
  withEditChain,
} from './editing/operations.js';
export { FadeDirection, FadeShape } from './editing/fades.js';

export {
  type BrushRadius,
  type FrequencyBand,
  type SpectralBounds,
  type SpectralFeather,
  type SpectralMask,
  type SpectralPoint,
  type SpectralShape,
  type StrokePoint,
  HIGHEST_MASK_FREQUENCY,
  MaskEffect,
  NO_FEATHER,
  maskOutline,
  maskSupport,
  masksEqual,
} from './spectral/spectral-mask.js';
export { MaskWeights } from './spectral/mask-weight.js';
export { binFrequency, nearestBin } from './spectral/bin-frequency.js';
export { clippedMask } from './spectral/mask-clipping.js';
export {
  MAXIMUM_MASK_POINTS,
  MAXIMUM_MASK_SHAPES,
  maskProblem,
} from './spectral/mask-validation.js';
export { spectralMaskOf } from './spectral/mask-decoding.js';
export {
  type PlannedSpectralEdit,
  type PlannedSpectralOperation,
  type SpectralEdit,
  type SpectralEditOperation,
  type SpectralOperationKind,
  type SpectralPlacement,
  DEFAULT_SPECTRAL_RESOLUTION,
  HEAL_BORDER_FRAMES,
  LARGEST_SPECTRAL_RESOLUTION,
  SMALLEST_SPECTRAL_RESOLUTION,
  isSpectralReduction,
  isSpectralResolution,
  spectralEditProblem,
  spectralPlacement,
} from './spectral/spectral-edit.js';

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
  planIsSilence,
  planReadsAsset,
  segmentsLayout,
  segmentsLength,
  silencePlan,
  sourceStreams,
  streamLength,
} from './editing/plan.js';

export { type EditShape, shapeAfter, shapesOf } from './editing/edit-shape.js';

export { Affinity, type AnchorResolver, type Span, anchorResolver } from './editing/anchors.js';

export { type ChannelMatrix, conversionMatrix } from './editing/channel-matrices.js';

export { type PlanContext } from './editing/plan-context.js';
export {
  assetPlan,
  bypassedAssetPlan,
  unrackedAssetPlan,
  withRack,
} from './editing/plan-building.js';
export { type BlockPlace, applyStages, placeOf, sumInto } from './editing/stage-arithmetic.js';
export { sliceSegment } from './editing/segment-list.js';
export { slicePlan } from './editing/plan-slicing.js';
export { type RemovalEdit, removalEdits } from './editing/removal-operations.js';
export { type MediaShape, MAXIMUM_STRETCH_RATIO, validatePlan } from './editing/plan-validation.js';
export { editPlanOf, layoutOf } from './editing/plan-decoding.js';
export { effectChainOf } from './processing/chain-decoding.js';
export {
  type EditingEntities,
  type ProjectChains,
  validateChain,
  validateOperation,
} from './editing/operation-validation.js';
export { punchTakeFrames, punchTakeProblem } from './editing/punch-validation.js';
export { validateTakeStack, validateTakeStackInProject } from './editing/take-stack-validation.js';
export { validateMarker, validateRegion } from './editing/placement-validation.js';
export { restateRegion, splitRegion, splitWholeAsset } from './editing/region-split.js';
export {
  markersInRegion,
  placeMarkers,
  placeRegion,
  placeRegions,
  bypassedRegionPlan,
  regionPlan,
  unrackedRegionPlan,
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
  type ListedFile,
  type ModelIdentity,
  type ProcessorState,
  type ProcessorStateVersion,
  type TextSha256,
  MAXIMUM_STATE_VALUES,
  checkStateVersion,
  isModelIdentity,
  modelHashOf,
} from './processing/processor-version.js';

export {
  MAXIMUM_QUALITY,
  NAMED_QUALITY_LEVELS,
  type NamedQualityLevel,
  QualityLevel,
  type QualityMode,
  type QualitySettingKey,
  type QualitySettings,
  ResamplingGrade,
  qualityModeFrom,
  qualityModeOf,
  namedQualityMode,
} from './processing/quality-mode.js';

export {
  MAXIMUM_CHAIN_SLOTS,
  MAXIMUM_GROUP_BRANCHES,
  MAXIMUM_GROUP_DEPTH,
  type ProcessorCatalogue,
  chainOutputLayout,
  checkProcessors,
  validateChainShape,
} from './processing/chain-validation.js';

export {
  type FoundSlot,
  type SlotPlace,
  copyChain,
  copySlot,
  findSlot,
  slotsAt,
  withSlotAt,
  withSlotMoved,
  withSlotReplaced,
  withoutSlot,
} from './processing/chain-edits.js';

export {
  type ChainListening,
  type PartWayStart,
  appliedProcessors,
  chainListening,
  unheardLive,
} from './processing/chain-listening.js';

export { controlPosition, parameterAtPosition } from './processing/parameter-control.js';

export { treatmentChain, treatmentValues } from './processing/treatment-chain.js';

export {
  LONGEST_SAVED_NAME,
  type LibraryContent,
  type LibraryEntry,
  type LibraryEntryId,
  type LibraryEntryKind,
  withPreset,
} from './processing/processing-library.js';

export { type ProcessorLatency } from './processing/processor-latency.js';
export {
  type DetectorFinding,
  type DetectorIdentity,
  type DetectorValues,
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
  type RangeRack,
  type TargetChains,
  assetChains,
  assetUsers,
  chainIdsOf,
  chainUseCount,
  chainUsers,
  clipsOnTrack,
  createProject,
  isAssetInUse,
  projectChains,
  projectLength,
  regionChains,
  tracksInOrder,
} from './project/project.js';

export {
  type PunchCrossfade,
  type PunchRange,
  type Take,
  type TakeStack,
  TakeState,
  chosenTake,
  defaultPunchCrossfade,
  takeOf,
} from './project/take-stack.js';
export { type StackUse, punchStackOf, stackUsers } from './project/take-users.js';

export { crc32 } from './integrity/crc32.js';
