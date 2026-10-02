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
  type AssetId,
  type Branded,
  type BusId,
  type ClipId,
  type EditOperationId,
  type EffectChainId,
  type EntityId,
  type MarkerId,
  type ParameterId,
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
  type RangeEdit,
  type RegionOperation,
  FadeDirection,
  FadeShape,
  MAXIMUM_EDIT_GAIN,
  TIME_CHANGING_KINDS,
  isLevelEdit,
} from './editing/operations.js';

export {
  type ClipboardPayload,
  type EditPlan,
  type FadeCurve,
  type GainCurve,
  type PlanSegment,
  type PlanSource,
  type PlanStage,
  type PlanStream,
  convertedFrameCount,
  fadeShapeAt,
  gainAt,
  planReadsAsset,
  streamLength,
} from './editing/plan.js';

export { type EditShape, shapeAfter, shapesOf, sourceShape } from './editing/edit-shape.js';

export {
  Affinity,
  type AnchorResolver,
  type Span,
  anchorResolver,
  carryPosition,
  carrySpan,
} from './editing/anchors.js';

export {
  type ChannelMatrix,
  conversionMatrix,
  identityMatrix,
} from './editing/channel-matrices.js';

export { assetPlan } from './editing/plan-building.js';
export { type BlockPlace, applyStages } from './editing/stage-arithmetic.js';
export { slicePlan } from './editing/plan-slicing.js';
export { type MediaShape, validatePlan } from './editing/plan-validation.js';
export { editPlanFrom } from './editing/plan-decoding.js';
export { validateChain, validateOperation } from './editing/operation-validation.js';
export {
  lastConversion,
  namesChannels,
  validateMarker,
  validateRegion,
} from './editing/placement-validation.js';
export {
  markersInRegion,
  placeMarkers,
  placeRegion,
  placeRegions,
  regionPlan,
  regionSpan,
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
  type EffectChain,
  type ProcessorDescriptor,
  type ProcessorInstance,
  chainLatency,
  instantiateProcessor,
  processorsInSignalOrder,
  validateProcessorInstance,
} from './processing/effect-chain.js';

export { type ProcessorLatency } from './processing/processor-latency.js';

export {
  type Project,
  type AssetUsers,
  type ProjectSettings,
  assetUsers,
  clipsOnTrack,
  createProject,
  isAssetInUse,
  projectLength,
  tracksInOrder,
} from './project/project.js';

export { crc32 } from './integrity/crc32.js';
