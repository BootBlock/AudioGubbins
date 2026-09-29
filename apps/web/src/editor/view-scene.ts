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

import type { SampleCount } from '@audiogubbins/domain';
import {
  layoutView,
  snapTargetsOf,
  visibleChannels,
  type EditorPalette,
  type EditorType,
  type EditorViewState,
  type KnownAudio,
  type ToolPreview,
  type ViewScene,
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
import type { AssetContent } from '../state/session-content.js';

/** The fewest CSS pixels between two labelled ticks of the ruler. */
const LABEL_SPACING = 88;

/** The most picture frames offered as snap targets at once, however far out a view is. */
const MOST_FRAMES = 2_000;

/** What a frame of a view is drawn from, beside its size. */
export interface SceneSources {
  readonly state: EditorViewState;
  readonly asset: EditorAsset;
  readonly content: AssetContent;
  readonly audio: KnownAudio;
  readonly selection: SelectionSet;
  readonly playhead: SampleCount | undefined;
  readonly preview: ToolPreview | undefined;
  readonly snap: SnapTarget | undefined;
  /** The picture's binding where it is bound to this asset. */
  readonly picture: ReferenceMediaClockBinding | undefined;
  /** The picture's thumbnails in the strip laid out at `area`. */
  readonly thumbnails: (area: Rectangle) => readonly PlacedImage[];
  readonly palette: EditorPalette;
  readonly type: EditorType;
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
  return {
    layout,
    state,
    pixelRatio,
    content: {
      length: asset.length,
      channelNames: namesOf(asset),
      markers: sources.content.markers,
      regions: sources.content.regions,
    },
    audio: sources.audio,
    selection: sources.selection,
    playhead: sources.playhead,
    preview: sources.preview,
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
  /** Whether a selection edge is being dragged, so the edges are not targets. */
  readonly selectionEdges?: boolean;
}

/** The targets a pointer in the view is offered, the zero crossing found near it among them. */
export function snapTargetsFor(
  sources: Pick<SceneSources, 'state' | 'asset' | 'content' | 'selection' | 'playhead' | 'picture'>,
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
    markers: sources.content.markers.filter((marker) => marker.id !== exclusions.marker),
    regions: sources.content.regions,
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
