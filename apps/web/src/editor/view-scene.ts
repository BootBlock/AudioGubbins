/**
 * Everything one frame of a view is composed from, gathered from where each
 * part is held: the view's state, the asset's content and selection, the
 * playhead, what is known of the audio, the drag in progress and the picture's
 * thumbnails (REQ-AUDIO-152). A value built afresh for each frame, so the
 * renderer holds nothing a lost device could take with it.
 *
 * The snap targets a pointer is offered are gathered here too, from the same
 * values, so what a person sees and what their pointer lands on cannot differ.
 */

import { ZERO_SAMPLES, type SampleCount } from '@audiogubbins/domain';
import {
  drawingPreview,
  layoutView,
  snapTargetsOf,
  visibleChannels,
  type EditorPalette,
  type EditorType,
  type EditorViewState,
  type KnownAudio,
  type KeyboardDrawing,
  type KnownSpectrogram,
  type ToolPreview,
  type ViewLayout,
  type ViewScene,
  type DrawingMarks,
} from '@audiogubbins/editor-view';
import type { PlacedImage, Rectangle } from '@audiogubbins/renderer';
import {
  gridPositions,
  rulerTicks,
  visibleRange,
  type BoundaryRange,
  type SelectionSet,
  type SnapTarget,
} from '@audiogubbins/timeline';
import {
  frameBoundariesWithin,
  type ReferenceMediaClockBinding,
} from '@audiogubbins/video-reference';

import { channelNames } from '../assets/channel-names.js';
import type { EditorAsset } from '../assets/editor-asset.js';
import { drawingContextOf } from './drawing-context.js';
import { spectralEditOutlines } from './spectral-edit-outlines.js';

/** The fewest CSS pixels between two labelled ticks of the ruler. */
const LABEL_SPACING = 88;

/** The most picture frames offered as snap targets at once, however far out a view is. */
const MOST_FRAMES = 2_000;

/** What a frame of a view is drawn from, beside its size. */
export interface SceneSources {
  readonly state: EditorViewState;
  readonly asset: EditorAsset;
  readonly audio: KnownAudio;
  readonly spectrogram: KnownSpectrogram;
  /** How often the spectrogram's tiles have changed, which a frame waiting on some shows. */
  readonly spectrogramVersion: number;
  readonly selection: SelectionSet;
  readonly playhead: SampleCount | undefined;
  readonly preview: ToolPreview | undefined;
  /** A spectral shape being drawn from the keyboard, if one is. */
  readonly drawing: KeyboardDrawing | undefined;
  /** The fixed strength, which a shape drawn from the keyboard is drawn at. */
  readonly strength: number;
  readonly snap: SnapTarget | undefined;
  /** The picture's binding where it is bound to this asset. */
  readonly picture: ReferenceMediaClockBinding | undefined;
  /** The picture's thumbnails in the strip laid out at `area`. */
  readonly thumbnails: (area: Rectangle) => readonly PlacedImage[];
  readonly palette: EditorPalette;
  readonly type: EditorType;
}

/** What the last frame drew that was not yet known, so may change as it comes. */
export interface FrameWaiting {
  /** Columns whose peaks were not yet known. */
  readonly peaks: boolean;
  /** Spectrogram tiles pending or stale. */
  readonly spectrogram: boolean;
}

/**
 * The values of `sources` a frame is drawn from, in a fixed order, each to be
 * compared by identity: a store gives the same value for what has not changed,
 * so a view whose own values are all the same as its last frame's has nothing
 * new to draw, whatever else in the stores changed. The peaks and the tiles
 * made since count only while the last frame was `waiting` on some, since a
 * frame whose columns and tiles were all known shows none of them.
 */
export function frameInputsOf(sources: SceneSources, waiting: FrameWaiting): readonly unknown[] {
  const { audio } = sources;
  return [
    sources.state,
    sources.asset,
    sources.selection,
    sources.playhead,
    sources.picture,
    sources.palette,
    sources.type,
    sources.preview,
    sources.drawing,
    sources.strength,
    sources.snap,
    audio.pyramid,
    waiting.peaks ? audio.pyramid?.version : undefined,
    audio.buckets,
    audio.samples,
    sources.spectrogram,
    waiting.spectrogram ? sources.spectrogramVersion : undefined,
  ];
}

/** Whether two lists of a frame's inputs hold the same values. */
export function sameInputs(one: readonly unknown[], other: readonly unknown[]): boolean {
  return one.length === other.length && one.every((input, index) => input === other[index]);
}

/** Each asset's channel names, worked out once. */
const NAMES = new WeakMap<EditorAsset, readonly string[]>();

function namesOf(asset: EditorAsset): readonly string[] {
  const known = NAMES.get(asset);
  if (known !== undefined) return known;
  const names = channelNames(asset.layout);
  NAMES.set(asset, names);
  return names;
}

/**
 * What a view laid out as `layout` shows of the shape being drawn from the
 * keyboard: its points and cursor, and the selection its shape would leave;
 * nothing where none is drawn, or none can be.
 */
function keyboardDrawn(
  sources: SceneSources,
  layout: ViewLayout,
): { readonly preview: ToolPreview | undefined; readonly marks: DrawingMarks } | undefined {
  const { drawing } = sources;
  if (drawing === undefined) return undefined;
  const context = drawingContextOf(drawing, {
    ...sources,
    layout,
    playhead: sources.playhead ?? ZERO_SAMPLES,
  });
  if (typeof context === 'string') return undefined;
  const { marks, drawn, selection } = drawingPreview(drawing, context);
  return {
    marks,
    preview:
      drawn === undefined || selection === undefined
        ? undefined
        : { kind: 'spectral-shape', drawn, selection },
  };
}

/** The scene of a view `width` by `height` CSS pixels at `pixelRatio`. */
export function sceneOf(
  sources: SceneSources,
  width: number,
  height: number,
  pixelRatio: number,
): ViewScene {
  const { state, asset } = sources;
  const ruler = rulerTicks(
    state.viewport,
    asset.length,
    asset.sampleRate,
    state.timeFormat,
    LABEL_SPACING,
  );
  const layout = layoutView(
    state,
    width,
    height,
    asset.layout.roles.length,
    sources.picture !== undefined,
  );
  const drawn = keyboardDrawn(sources, layout);
  return {
    layout,
    state,
    pixelRatio,
    content: {
      length: asset.length,
      channelNames: namesOf(asset),
      markers: asset.markers,
      regions: asset.regions,
      spectralEdits: asset.owner.kind === 'project' ? spectralEditOutlines(asset.owner) : [],
    },
    audio: sources.audio,
    spectrogram: sources.spectrogram,
    selection: sources.selection,
    playhead: sources.playhead,
    // A pointer's drag is drawn over a keyboard drawing it interrupts.
    preview: sources.preview ?? drawn?.preview,
    drawing: drawn?.marks,
    snap: sources.snap,
    ruler,
    grid: state.overlays.grid ? gridPositions(ruler) : undefined,
    picture: layout.picture === undefined ? [] : sources.thumbnails(layout.picture),
    palette: sources.palette,
    type: sources.type,
  };
}

/** What a pointer's position may snap to in a view, and what is left out while it is dragged. */
export interface SnapExclusions {
  /** The marker being dragged, which is not a target for itself. */
  readonly marker?: string;
  /** The region whose end is being dragged, whose own boundaries are not targets for it. */
  readonly region?: string;
  /** Whether a selection edge is being dragged, so the edges are not targets. */
  readonly selectionEdges?: boolean;
}

/** The targets a pointer in the view is offered, the zero crossing found near it among them. */
export function snapTargetsFor(
  sources: Pick<SceneSources, 'state' | 'asset' | 'selection' | 'playhead' | 'picture'>,
  zeroCrossing: SampleCount | undefined,
  exclusions: SnapExclusions,
): readonly SnapTarget[] {
  const { state, asset } = sources;
  const shown: BoundaryRange = visibleRange(state.viewport, asset.length);
  const ruler = rulerTicks(
    state.viewport,
    asset.length,
    asset.sampleRate,
    state.timeFormat,
    LABEL_SPACING,
  );
  return snapTargetsOf({
    markers: asset.markers.filter((marker) => marker.id !== exclusions.marker),
    regions: asset.regions.filter((region) => region.id !== exclusions.region),
    playhead: sources.playhead,
    selection: exclusions.selectionEdges === true ? undefined : sources.selection.time,
    grid: gridPositions(ruler),
    frames:
      sources.picture === undefined
        ? []
        : frameBoundariesWithin(sources.picture, shown.start, shown.end, MOST_FRAMES),
    zeroCrossing,
  });
}

/** The channels a view draws, which a zero crossing is searched for on. */
export function shownChannels(state: EditorViewState, asset: EditorAsset): readonly number[] {
  return visibleChannels(state, asset.layout.roles.length);
}
