/**
 * The active selection scope of an editor view (REQ-EDIT-063): what a command
 * that processes would act on now, in words, and a warning where that lies
 * outside what the view shows (REQ-EDIT-064), so a selection kept from earlier
 * is never acted on unseen.
 *
 * It is resolved by the timeline's one precedence, as a command resolves it,
 * so the words are the command's target and not a second reading of the
 * selection. A polite live region: a screen reader hears each change of scope
 * once it has settled, and a sighted reader sees it beside the waveform.
 */

import type { ReactNode } from 'react';

import { channelCount } from '@audiogubbins/domain';
import type { EditorViewState } from '@audiogubbins/editor-view';
import {
  SelectionFacet,
  describeTarget,
  formatPosition,
  resolveTarget,
  targetOutside,
  visibleRange,
  type MadeFacet,
  type SelectionSet,
  type TargetRequest,
} from '@audiogubbins/timeline';

import { channelNames } from '../assets/channel-names.js';
import type { EditorAsset } from '../assets/editor-asset.js';

/** A command that processes: it takes any facet, and the whole asset with nothing selected (REQ-EDIT-012). */
const PROCESSING: TargetRequest = {
  accepts: new Set<MadeFacet>([
    SelectionFacet.Time,
    SelectionFacet.Spectral,
    SelectionFacet.Objects,
  ]),
  whenNothing: 'whole-asset',
};

const HERTZ = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** The scope, in words, and whether it is outside the view. */
export function scopeOf(
  selection: SelectionSet,
  asset: EditorAsset,
  state: EditorViewState,
): { readonly text: string; readonly outside: boolean } {
  const count = channelCount(asset.layout);
  const target = resolveTarget(selection, PROCESSING, {
    length: asset.length,
    channelCount: count,
  });
  if (!target.ok) return { text: target.failures[0].summary, outside: false };
  const names = channelNames(asset.layout);
  const text = describeTarget(target.value, {
    position: (position) => formatPosition(position, asset.sampleRate, state.timeFormat),
    channel: (index) => names[index] ?? String(index + 1),
    channelCount: count,
    frequency: (hertz) => `${HERTZ.format(hertz)} Hz`,
  });
  return {
    text,
    outside: targetOutside(target.value, visibleRange(state.viewport, asset.length)),
  };
}

/** The active selection scope of a view. */
export function SelectionScope({
  selection,
  asset,
  state,
}: {
  readonly selection: SelectionSet;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
}): ReactNode {
  const scope = scopeOf(selection, asset, state);
  return (
    <p className="ag-editor-scope" role="status">
      <span className="ag-editor-scope-label">Scope: </span>
      <span className="ag-editor-scope-text">{scope.text}</span>
      {scope.outside && (
        <span className="ag-editor-scope-warning" data-ag-status="reduced">
          {' '}
          The selection is outside this view.
        </span>
      )}
    </p>
  );
}
