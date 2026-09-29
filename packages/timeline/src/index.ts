/**
 * The public contract of the AudioGubbins timeline.
 *
 * The time axis as values (ADR-0040): zoom and the viewport with their exact
 * conversions between CSS pixels and sample boundaries (ADR-0041), picture
 * frame rates and timecode, the formats a position is written in, the ruler and
 * its grid, the selection set and the precedence that turns it into a command's
 * target (ADR-0042), and snapping. It depends on the domain alone, knows no
 * thread or browser, and runs in any scope.
 */

export {
  MAXIMUM_PIXELS_PER_SAMPLE,
  MAXIMUM_SAMPLES_PER_PIXEL,
  ONE_SAMPLE_PER_PIXEL,
  type PixelsPerSample,
  type SamplesPerPixel,
  type Zoom,
  pixelsPerSample,
  samplesInPixel,
  samplesPerPixel,
  zoomFitting,
  zoomScaled,
  zoomShowing,
  zoomedIn,
  zoomedOut,
  zoomsEqual,
} from './zoom.js';

export {
  type BoundaryRange,
  type ViewportState,
  boundaryAt,
  centredOn,
  clampedView,
  framing,
  nearestBoundary,
  pixelOf,
  placedAt,
  resized,
  roundHalfAway,
  sampleAt,
  samplesWithin,
  scrolledBy,
  viewportAtStart,
  viewportFitting,
  visibleRange,
  zoomedAround,
} from './viewport.js';

export {
  type FrameRate,
  StandardFrameRates,
  frameAt,
  frameRate,
  frameRatesEqual,
  frameStart,
  framesPerSecond,
  nominalFramesPerSecond,
} from './frame-rate.js';

export { type TimecodeLabel, timecodeOf, timecodeText } from './timecode.js';

export { type TimeFormat, TimeFormatKind, TimePrecision, formatPosition } from './time-format.js';

export { type RulerTick, type RulerTicks, gridPositions, rulerTicks } from './ruler.js';

export {
  EMPTY_SELECTION,
  type FrequencyBand,
  type MadeFacet,
  type ObjectSelection,
  type SelectableContent,
  SelectionFacet,
  type SelectionSet,
  type SpectralArea,
  type SpectralPoint,
  type SpectralShape,
  activeFacet,
  reconciled,
  selectionsEqual,
  withChannels,
  withObjects,
  withSpectralArea,
  withTimeRange,
  withoutFacet,
} from './selection-set.js';

export {
  type SelectionTarget,
  type TargetAsset,
  type TargetRequest,
  type TargetWriting,
  describeTarget,
  resolveTarget,
  targetOutside,
  targetRange,
} from './selection-target.js';

export {
  DEFAULT_SNAP_SETTINGS,
  SNAP_PRECEDENCE,
  SnapKind,
  type SnapResult,
  type SnapSettings,
  type SnapTarget,
  snapped,
  targetsWithin,
} from './snapping.js';
