/**
 * Where each part of a view is drawn: the ruler, the strip of markers and
 * regions, the picture strip, and a lane for each channel shown, in the display
 * mode's arrangement (REQ-EDIT-062). Every channel is a lane of its own,
 * however many the layout has, labelled by its role or its label, so no view
 * assumes stereo (the packet's "no implicit stereo assumptions").
 *
 * A layout is computed from the view's size and state, never kept, so a view
 * that is resized or whose channels are shown or hidden lays itself out again
 * from the same inputs.
 */

import type { Rectangle } from '@audiogubbins/renderer';

import { DisplayMode, visibleChannels, type EditorViewState } from './view-state.js';

/** What a lane draws. */
export const LaneKind = {
  Waveform: 'waveform',
  Spectrogram: 'spectrogram',
  /** A spectrogram with the waveform drawn over it. */
  Overlay: 'overlay',
} as const;

export type LaneKind = (typeof LaneKind)[keyof typeof LaneKind];

/** One channel's lane. */
export interface Lane {
  readonly channel: number;
  readonly kind: LaneKind;
  readonly area: Rectangle;
}

/** Where each part of a view is drawn, in CSS pixels. */
export interface ViewLayout {
  readonly width: number;
  readonly height: number;
  readonly ruler: Rectangle;
  /** The strip markers and regions are drawn and grabbed in. */
  readonly strip: Rectangle;
  /** The picture's thumbnails, where picture is bound and the overlay is on. */
  readonly picture: Rectangle | undefined;
  readonly lanes: readonly Lane[];
}

const RULER_HEIGHT = 24;
const STRIP_HEIGHT = 18;
const PICTURE_HEIGHT = 48;

/** The space between two lanes, which is drawn as a separator. */
const LANE_GAP = 1;

function lanesFor(
  state: EditorViewState,
  channels: readonly number[],
): readonly Pick<Lane, 'channel' | 'kind'>[] {
  return channels.flatMap((channel): Pick<Lane, 'channel' | 'kind'>[] => {
    switch (state.displayMode) {
      case DisplayMode.Waveform:
        return [{ channel, kind: LaneKind.Waveform }];
      case DisplayMode.Spectrogram:
        return [{ channel, kind: LaneKind.Spectrogram }];
      case DisplayMode.Stacked:
        return [
          { channel, kind: LaneKind.Waveform },
          { channel, kind: LaneKind.Spectrogram },
        ];
      case DisplayMode.Overlay:
        return [{ channel, kind: LaneKind.Overlay }];
    }
  });
}

/** Lays a view of `width` by `height` out for `channelCount` channels. */
export function layoutView(
  state: EditorViewState,
  width: number,
  height: number,
  channelCount: number,
  pictureBound: boolean,
): ViewLayout {
  const ruler = { x: 0, y: 0, width, height: RULER_HEIGHT };
  const strip = { x: 0, y: RULER_HEIGHT, width, height: STRIP_HEIGHT };
  const showsPicture = pictureBound && state.overlays.filmstrip;
  const picture = showsPicture
    ? { x: 0, y: RULER_HEIGHT + STRIP_HEIGHT, width, height: PICTURE_HEIGHT }
    : undefined;
  const top = RULER_HEIGHT + STRIP_HEIGHT + (picture?.height ?? 0);
  const kinds = lanesFor(state, visibleChannels(state, channelCount));
  const available = Math.max(0, height - top - LANE_GAP * Math.max(0, kinds.length - 1));
  const each = kinds.length === 0 ? 0 : available / kinds.length;
  const lanes = kinds.map((lane, index) => ({
    ...lane,
    area: { x: 0, y: top + index * (each + LANE_GAP), width, height: each },
  }));
  return { width, height, ruler, strip, picture, lanes };
}

/** The lane at height `y`, if any. */
export function laneAt(layout: ViewLayout, y: number): Lane | undefined {
  return layout.lanes.find((lane) => y >= lane.area.y && y < lane.area.y + lane.area.height);
}
