/**
 * The public contract of an AudioGubbins editor view.
 *
 * One view of an asset as values (ADR-0040): its presentation state
 * (REQ-EDIT-061), the lanes it lays its channels out in for each display mode
 * (REQ-EDIT-062), what a pointer is over, what each tool does with a press and
 * a drag (REQ-EDIT-065), the snap targets it offers (REQ-EDIT-013), and the
 * composition of a whole render frame from its state (REQ-AUDIO-152). It
 * imports no interface framework and reads no browser global; the application
 * mounts it on a canvas and carries its intents out through commands.
 */

export {
  AMPLITUDES,
  DEFAULT_OVERLAYS,
  DisplayMode,
  type EditorViewState,
  FollowMode,
  type Overlays,
  type SpectralSettings,
  ToolId,
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
  move,
  press,
  release,
} from './pointer-tools.js';

export { type SnapSources, snapInView, snapTargetsOf } from './snap-candidates.js';

export { type EditorPalette, type EditorType } from './editor-palette.js';

export { type KnownAudio } from './waveform-drawing.js';

export { FrameComposer, type ViewContent, type ViewScene } from './frame-composer.js';
