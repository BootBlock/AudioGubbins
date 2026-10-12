/**
 * What a spectral shape drawn from the keyboard is read with in a view: the
 * view's tool and its spectral settings, the lane of the drawing's channel as
 * the view lays it out, the selection it joins, the playhead the cursor
 * stands at and the fixed strength (ADR-0082).
 *
 * The one account of it, which the frame a view draws and the commands that
 * place and finish a shape both read, so the shape a person sees being drawn
 * is the shape that joins the selection.
 */

import { channelCount, type SampleCount } from '@audiogubbins/domain';
import {
  drawingLaneOf,
  isSpectralTool,
  visibleChannels,
  type DrawingContext,
  type EditorViewState,
  type KeyboardDrawing,
  type ViewLayout,
} from '@audiogubbins/editor-view';
import type { SelectionSet } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';

/** What a keyboard drawing in a view is read from. */
export interface DrawingSources {
  readonly state: EditorViewState;
  readonly asset: EditorAsset;
  readonly layout: ViewLayout;
  readonly selection: SelectionSet;
  readonly playhead: SampleCount;
  /** The fixed strength, which a key draws at, having no pressure. */
  readonly strength: number;
}

/** What `drawing` is read with in the view `sources` give, or why it cannot be drawn there. */
export function drawingContextOf(
  drawing: KeyboardDrawing,
  { state, asset, layout, selection, playhead, strength }: DrawingSources,
): DrawingContext | string {
  const { tool } = state;
  if (!isSpectralTool(tool)) {
    return 'Choose the spectral marquee, lasso or brush to draw with first.';
  }
  const lane = drawingLaneOf(layout, drawing.channel);
  if (lane === undefined) {
    return 'The cursor’s channel shows no spectrogram here. Show the spectrogram to draw on it.';
  }
  if (!(lane.area.height > 0 && lane.area.width > 0)) {
    return 'The view is not laid out yet, so there is nowhere to draw.';
  }
  const channels = channelCount(asset.layout);
  return {
    tool,
    spectral: {
      lane,
      axis: state.spectral,
      viewport: state.viewport,
      length: asset.length,
      channelCount: channels,
      selection,
      settings: state.spectralTools,
    },
    visibleChannels: visibleChannels(state, channels),
    position: playhead,
    strength,
  };
}
