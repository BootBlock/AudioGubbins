/**
 * What the Picture panel reads of the picture at the playhead: the timecode
 * over the picture's corner, the frame there and where the picture starts,
 * and whether the playhead is outside it. Each follows the playhead every
 * display frame while the asset plays, and holds still while it is parked.
 */

import type { ReactNode } from 'react';

import { PropertyGrid } from '@audiogubbins/design-system';
import type { SampleCount } from '@audiogubbins/domain';
import { formatPosition, TimeFormatKind } from '@audiogubbins/timeline';
import { pictureFrameAt, pictureTimeAt, pictureTimecodeAt } from '@audiogubbins/video-reference';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { EditorPanelParts } from '../editor/panel-parts.js';
import type { PictureState } from '../picture/reference-picture.js';
import { useDisplayFrame } from './use-display-frame.js';

const FRAMES = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** The playhead of `asset`, read each display frame while it plays. */
function usePlayhead(parts: EditorPanelParts, asset: EditorAsset): SampleCount {
  return useDisplayFrame(() => parts.stores.playhead(asset), parts.stores.playing(asset.id));
}

/** The timecode at the playhead, over the picture's corner. */
export function Timecode({
  parts,
  asset,
  state,
}: {
  readonly parts: EditorPanelParts;
  readonly asset: EditorAsset;
  readonly state: PictureState;
}): ReactNode {
  const playhead = usePlayhead(parts, asset);
  const { binding } = state;
  if (binding === undefined) return null;
  return (
    <dl className="ag-picture-timecode">
      <dt>Timecode</dt>
      <dd role="timer">{pictureTimecodeAt(binding, playhead)}</dd>
    </dl>
  );
}

/** The frame at the playhead and where the picture starts, and whether the playhead is outside it. */
export function Readouts({
  parts,
  asset,
  state,
}: {
  readonly parts: EditorPanelParts;
  readonly asset: EditorAsset;
  readonly state: PictureState;
}): ReactNode {
  const playhead = usePlayhead(parts, asset);
  const { binding, media } = state;
  if (binding === undefined) return null;
  const time = pictureTimeAt(binding, playhead);
  const outside =
    time < 0
      ? 'The playhead is before the picture starts.'
      : media.kind === 'ready' && time >= media.duration
        ? 'The playhead is past the end of the picture.'
        : undefined;
  return (
    <>
      {outside !== undefined && <p className="ag-panel-note">{outside}</p>}
      <PropertyGrid
        rows={[
          { id: 'frame', label: 'Frame', value: FRAMES.format(pictureFrameAt(binding, playhead)) },
          {
            id: 'start',
            label: 'Picture starts at',
            value: formatPosition(binding.offset, asset.sampleRate, {
              kind: TimeFormatKind.Clock,
            }),
          },
        ]}
      />
    </>
  );
}
