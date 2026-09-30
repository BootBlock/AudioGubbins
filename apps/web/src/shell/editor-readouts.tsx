/**
 * What an editor view shows, in words beside the canvas: where the playhead
 * is, how far the view is zoomed and what stretch of the asset it shows, and
 * the asset's markers, each a button that selects it. The canvas is drawn for
 * the eye; these are what a screen reader, a keyboard and a test read
 * (REQ-UX-005), and they read the same stores the canvas is drawn from.
 *
 * The surface is described by the readings, and what a key pressed in it
 * changed of them is said once the keys stop (`use-readings-said.ts`).
 */

import type { ReactNode, RefObject } from 'react';

import { Button, ButtonTone } from '@audiogubbins/design-system';
import type { Marker } from '@audiogubbins/domain';
import type { EditorViewState } from '@audiogubbins/editor-view';
import { formatPosition, visibleRange, type SelectionSet, type Zoom } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import { useDisplayFrame } from './use-display-frame.js';
import { useReadingsSaid } from './use-readings-said.js';

const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** A zoom in words: samples to a pixel, or pixels to a sample. */
function zoomText(zoom: Zoom): string {
  return zoom.kind === 'samples-per-pixel'
    ? `${WHOLE.format(zoom.samples)} ${zoom.samples === 1 ? 'sample' : 'samples'} a pixel`
    : `${WHOLE.format(zoom.pixels)} pixels a sample`;
}

/**
 * Where the playhead is, the zoom and the stretch shown, under `id`, which
 * the surface is described by; what a key pressed in `surface` changed of
 * them is said.
 */
export function EditorReadouts({
  id,
  surface,
  asset,
  state,
  parts,
}: {
  readonly id: string;
  readonly surface: RefObject<HTMLElement | null>;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
  readonly parts: EditorPanelParts;
}): ReactNode {
  const playhead = useDisplayFrame(
    () => parts.stores.playhead(asset),
    parts.stores.playing(asset.id),
  );
  const write = (position: number): string =>
    formatPosition(position, asset.sampleRate, state.timeFormat);
  const shown = visibleRange(state.viewport, asset.length);
  const readings = {
    playhead: write(playhead),
    zoom: zoomText(state.viewport.zoom),
    showing: `${write(shown.start)} to ${write(shown.end)}`,
  };
  useReadingsSaid(surface, readings, parts.announce);
  return (
    <dl id={id} className="ag-readings ag-editor-readings">
      <div className="ag-reading">
        <dt>Playhead</dt>
        <dd role="timer" aria-label="Playhead">
          {readings.playhead}
        </dd>
      </div>
      <div className="ag-reading">
        <dt>Zoom</dt>
        <dd>{readings.zoom}</dd>
      </div>
      <div className="ag-reading">
        <dt>Showing</dt>
        <dd>{readings.showing}</dd>
      </div>
    </dl>
  );
}

/** The asset's markers, in position order, each selecting itself when pressed. */
export function MarkerList({
  panel,
  asset,
  state,
  markers,
  selection,
  parts,
}: {
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
  readonly markers: readonly Marker[];
  readonly selection: SelectionSet;
  readonly parts: EditorPanelParts;
}): ReactNode {
  if (markers.length === 0) return null;
  const selected = new Set<string>(
    selection.objects?.kind === 'markers' ? selection.objects.ids : [],
  );
  return (
    <ul className="ag-editor-markers" aria-label="Markers">
      {markers.map((marker) => (
        <li key={marker.id}>
          <Button
            compact
            tone={ButtonTone.Quiet}
            aria-pressed={selected.has(marker.id)}
            onClick={() => {
              parts.run('editor.select-marker', { view: panel, marker: marker.id });
            }}
          >
            {`${marker.displayName} at ${formatPosition(marker.position, asset.sampleRate, state.timeFormat)}`}
          </Button>
        </li>
      ))}
    </ul>
  );
}
