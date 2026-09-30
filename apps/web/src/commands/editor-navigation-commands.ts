/**
 * Moving about an asset in an editor view: zooming and scrolling
 * (REQ-EDIT-012). Each changes only the view it acts on, never another view
 * of the asset and never the selection (REQ-EDIT-061, REQ-EDIT-064), and each
 * is a command, so a key, a menu entry, the wheel, a pinch and the zoom tool
 * take the one route (REQ-EDIT-065).
 *
 * Every step is the timeline's exact integer arithmetic (ADR-0041): a zoom
 * keeps the boundary under its anchor where it was, and a scroll and its
 * reverse cancel, so nothing drifts however far a person travels.
 */

import {
  CommandCategory,
  unchanged,
  type Command,
  type CommandInvocation,
} from '@audiogubbins/commands';
import type { EditorViewState } from '@audiogubbins/editor-view';
import {
  SelectionFacet,
  framing,
  pixelOf,
  placedAt,
  scrolledBy,
  viewportFitting,
  zoomScaled,
  zoomedAround,
  zoomedIn,
  zoomedOut,
  targetRange,
  zoomsEqual,
  type BoundaryRange,
  type MadeFacet,
  type TargetRequest,
  type ViewportState,
  type Zoom,
} from '@audiogubbins/timeline';

import {
  boundaryArgument,
  editorTarget,
  needsEditor,
  numberArgument,
  playheadOf,
  selectedTarget,
  type EditorTarget,
} from './editor-target.js';
import { shellCommand, type ShellCommandOptions } from './shell-command.js';
import type { ShellContext } from './shell-context.js';

/** The CSS pixels left either side of a range a view is zoomed to frame. */
const FRAMING_MARGIN = 16;

/** A view change, or why it cannot be made. */
type ViewChange = (
  target: EditorTarget,
  invocation: CommandInvocation,
  context: ShellContext,
) => ViewportState | string;

/**
 * A command that changes a view's viewport. Unchanged when the viewport would
 * not move, as at either end of the timeline, so a key held there is silent.
 */
function viewportCommand(
  id: string,
  label: string,
  change: ViewChange,
  extra: ShellCommandOptions = {},
): Command<ShellContext> {
  return shellCommand(
    id,
    label,
    CommandCategory.View,
    (context, invocation) => {
      const target = editorTarget(context, invocation);
      if (typeof target === 'string') return target;
      const viewport = change(target, invocation, context);
      if (typeof viewport === 'string') return viewport;
      const current = target.state.viewport;
      if (
        viewport.start === current.start &&
        viewport.offset === current.offset &&
        zoomsEqual(viewport.zoom, current.zoom)
      ) {
        return unchanged('editor.view-unchanged', 'The view is already there.');
      }
      context.editorViews.change(target.panel, (state): EditorViewState => ({
        ...state,
        viewport,
      }));
      return undefined;
    },
    { availability: needsEditor, ...extra },
  );
}

/**
 * A view at a zoom made from its own by `zoom`, anchored where the person is
 * looking. A zoom that names a pixel, as the zoom tool, the wheel and a pinch
 * do, keeps the boundary under that pixel where it was. Otherwise the playhead
 * is kept on the pixel it is on where the view shows it, so zooming in and in
 * again stays on it down to its single samples, and the middle of the view is
 * kept where it does not. Each anchor is a whole pixel (ADR-0041): one between
 * two would be rounded at a zoom of pixels per sample and not at the zoom it
 * came from, and a zoom and its reverse would not return the same left edge.
 */
function zoomTo(zoom: (current: Zoom) => Zoom): ViewChange {
  return (target, invocation, context) => {
    const { viewport } = target.state;
    const { length } = target.asset;
    const next = zoom(viewport.zoom);
    const named = numberArgument(invocation, 'anchor');
    if (named !== undefined) return zoomedAround(viewport, next, Math.round(named), length);
    const playhead = playheadOf(context, target.asset);
    const x = pixelOf(viewport, playhead);
    return x >= 0 && x <= viewport.width
      ? placedAt({ ...viewport, zoom: next, offset: 0 }, playhead, Math.round(x), length)
      : zoomedAround(viewport, next, Math.round(viewport.width / 2), length);
  };
}

/** A range in time or a spectral area has an extent to frame; objects are framed by theirs. */
const EXTENT_SELECTED: TargetRequest = {
  accepts: new Set<MadeFacet>([SelectionFacet.Time, SelectionFacet.Spectral]),
  whenNothing: 'refuse',
};

/** The range the active selection in the target's asset covers, or why there is none. */
function selectedRange(target: EditorTarget, context: ShellContext): BoundaryRange | string {
  const selected = selectedTarget(context, target.asset, EXTENT_SELECTED);
  if (typeof selected === 'string') return selected;
  return targetRange(selected) ?? 'The active selection has no extent in time to zoom to.';
}

/** A view scrolled by a share of its width, back or forward. */
function scrollShare(share: number): ViewChange {
  return ({ state, asset }) =>
    scrolledBy(state.viewport, state.viewport.width * share, asset.length);
}

function zoomCommands(): readonly Command<ShellContext>[] {
  return [
    viewportCommand('editor.zoom-in', 'Zoom in', zoomTo(zoomedIn), {
      keywords: ['zoom', 'in', 'closer', 'magnify', 'samples'],
      description: 'Zooms in on the playhead, down to single samples.',
    }),
    viewportCommand('editor.zoom-out', 'Zoom out', zoomTo(zoomedOut), {
      keywords: ['zoom', 'out', 'further', 'overview'],
    }),
    viewportCommand(
      'editor.zoom-by',
      'Zoom by a factor',
      (target, invocation, context) => {
        const factor = numberArgument(invocation, 'factor');
        if (factor === undefined || factor <= 0) return 'A zoom needs a factor above zero.';
        // A factor above one shows more of the asset: more samples a pixel.
        return zoomTo((zoom) => zoomScaled(zoom, factor))(target, invocation, context);
      },
      { discoverable: false },
    ),
  ];
}

function framingCommands(): readonly Command<ShellContext>[] {
  return [
    viewportCommand(
      'editor.zoom-to-fit',
      'Zoom to fit',
      ({ state, asset }) => viewportFitting(asset.length, state.viewport.width),
      { keywords: ['zoom', 'fit', 'whole', 'all', 'overview'] },
    ),
    viewportCommand(
      'editor.zoom-to-selection',
      'Zoom to the selection',
      (target, _invocation, context) => {
        const range = selectedRange(target, context);
        return typeof range === 'string'
          ? range
          : framing(target.state.viewport, range, FRAMING_MARGIN, target.asset.length);
      },
      { keywords: ['zoom', 'selection', 'range', 'frame'] },
    ),
    viewportCommand(
      'editor.zoom-to-range',
      'Zoom to a range',
      ({ state, asset }, invocation) => {
        const start = boundaryArgument(invocation, 'start', asset);
        const end = boundaryArgument(invocation, 'end', asset);
        if (start === undefined || end === undefined || end <= start) {
          return 'A range to zoom to needs a start before its end, within the asset.';
        }
        return framing(state.viewport, { start, end }, 0, asset.length);
      },
      { discoverable: false },
    ),
  ];
}

function scrollCommands(): readonly Command<ShellContext>[] {
  return [
    viewportCommand(
      'editor.scroll',
      'Scroll by a distance',
      ({ state, asset }, invocation) => {
        const pixels = numberArgument(invocation, 'pixels');
        return pixels === undefined
          ? 'A scroll needs a distance in pixels.'
          : scrolledBy(state.viewport, pixels, asset.length);
      },
      { discoverable: false },
    ),
    viewportCommand('editor.scroll-back', 'Scroll back', scrollShare(-1), {
      keywords: ['scroll', 'back', 'left', 'page', 'earlier'],
    }),
    viewportCommand('editor.scroll-forward', 'Scroll forward', scrollShare(1), {
      keywords: ['scroll', 'forward', 'right', 'page', 'later'],
    }),
    viewportCommand(
      'editor.scroll-to',
      'Scroll to a position',
      ({ state, asset }, invocation) => {
        const at = boundaryArgument(invocation, 'position', asset);
        return at === undefined
          ? 'A scroll needs a position within the asset.'
          : placedAt(state.viewport, at, 0, asset.length);
      },
      { discoverable: false },
    ),
  ];
}

/** The commands that zoom and scroll a view. */
export function editorNavigationCommands(): readonly Command<ShellContext>[] {
  return [...zoomCommands(), ...framingCommands(), ...scrollCommands()];
}
