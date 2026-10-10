/**
 * The public contract of an AudioGubbins editor view.
 *
 * One view of an asset as values (ADR-0040): its presentation state
 * (REQ-EDIT-061), the lanes it lays its channels out in for each display mode
 * (REQ-EDIT-062), what a pointer is over, what each tool does with a press and
 * a drag (REQ-EDIT-065), the snap targets it offers (REQ-EDIT-013), and the
 * composition of a whole render frame from its state (REQ-AUDIO-152), its
 * spectrogram lanes drawn from the tiles of spectral analysis (ADR-0082). It
 * imports no interface framework and reads no browser global; the application
 * mounts it on a canvas and carries its intents out through commands.
 */

export {
  AMPLITUDES,
  DEFAULT_OVERLAYS,
  DEFAULT_SPECTROGRAM_DISPLAY,
  DisplayMode,
  type DisplayRange,
  type EditorViewState,
  FollowMode,
  type Overlays,
  SPECTRAL_TOOL_RANGES,
  type SpectralSettings,
  type SpectralToolSettings,
  SpectrogramColours,
  type SpectrogramDisplay,
  ToolId,
  brushRadiusOf,
  hardnessOf,
  isDisplayRange,
  newViewState,
  visibleChannels,
  withAmplitudeStep,
  withChannelShown,
} from './view-state.js';

export { type Lane, LaneKind, type ViewLayout, laneAt, layoutView } from './lane-layout.js';

export { type HitScene, type HitTarget, hitTest } from './hit-testing.js';

export {
  IDLE,
  type Interaction,
  type ToolContext,
  type ToolInput,
  type ToolIntent,
  type ToolPreview,
  type ToolStep,
} from './tool-values.js';

export { move, press, release } from './pointer-tools.js';

// The spectral marquee, lasso and brush, and the one account of what their
// intent makes of a selection, which the selection command and the drag's
// preview share (ADR-0082), whether a tool is one that draws one, and
// whether its drag traces a path, every move of which the pointer takes.
export {
  type DrawnShape,
  type SpectralToolContext,
  isSpectralTool,
  tracesPath,
  withDrawnShape,
} from './spectral-tools.js';

// The spectral tools drawn from the keyboard: a cursor in a spectrogram lane
// and the points it places, making what a pointer through them makes
// (ADR-0082).
export {
  CursorStep,
  type DrawingContext,
  type DrawingMarks,
  type KeyboardDrawing,
  cursorFrequency,
  cursorStepped,
  drawingLaneOf,
  drawingPreview,
  drawingShape,
  newDrawing,
  pointPlaced,
} from './keyboard-drawing.js';

// A spectral selection widened and narrowed from the keyboard (ADR-0082).
export {
  SPECTRAL_TIME_STEP_PIXELS,
  SpectralStep,
  maskSteppedInFrequency,
  maskSteppedInTime,
} from './spectral-steps.js';

export { type SpectralEditOutline } from './mask-drawing.js';

export { type SnapSources, snapInView, snapTargetsOf } from './snap-candidates.js';

export { type EditorPalette, type EditorType, SPECTROGRAM_RAMP_COLOURS } from './editor-palette.js';

export { type KnownAudio } from './waveform-drawing.js';

// The spectrogram layer: what a view knows of its sound's tiles, and the one
// account of which tiles it shows, which the application asks the host for and
// the lanes draw (ADR-0080, ADR-0082).
export { type KnownSpectrogram, shownSpectrogram } from './spectrogram-drawing.js';

export { FrameComposer, type ViewContent, type ViewScene } from './frame-composer.js';
