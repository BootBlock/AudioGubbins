/**
 * Where an Editor panel's view is along its asset: the set's slider over the
 * places the view's leading edge can be, each change a command.
 */

import type { ReactNode } from 'react';

import { ValueSlider } from '@audiogubbins/design-system';
import type { EditorViewState } from '@audiogubbins/editor-view';
import { formatPosition, visibleRange } from '@audiogubbins/timeline';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';

/** The scroll position, as a slider over where the view's left edge can be. */
export function ScrollPosition({
  panel,
  asset,
  state,
  parts,
}: {
  readonly panel: string;
  readonly asset: EditorAsset;
  readonly state: EditorViewState;
  readonly parts: EditorPanelParts;
}): ReactNode {
  const shown = visibleRange(state.viewport, asset.length);
  const furthest = Math.max(0, asset.length - (shown.end - shown.start));
  const whole = furthest === 0;
  return (
    <div className="ag-editor-scroll">
      <ValueSlider
        label="Position in the asset"
        value={shown.start}
        minimum={0}
        // A travel of no length has no place for the thumb, so the slider is
        // given one sample of it and refuses every change while it shows all.
        maximum={whole ? 1 : furthest}
        step={1}
        describeValue={(position) => formatPosition(position, asset.sampleRate, state.timeFormat)}
        {...(whole ? { unavailableReason: 'The whole asset is in view.' } : {})}
        onValueChange={(position) => {
          parts.run('editor.scroll-to', { view: panel, position });
        }}
      />
    </div>
  );
}
