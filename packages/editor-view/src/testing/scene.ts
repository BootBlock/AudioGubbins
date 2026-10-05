/**
 * A view scene for the tests: a palette of distinct colours, a type, and a
 * scene of a given state and content, so a test names only what it varies.
 */

import {
  sampleCount,
  unsafeBrandId,
  type PlacedMarker,
  type PlacedRegion,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { Colour } from '@audiogubbins/renderer';
import { EMPTY_SELECTION, type RulerTicks } from '@audiogubbins/timeline';

import type { EditorPalette, EditorType } from '../editor-palette.js';
import type { ViewScene } from '../frame-composer.js';
import { layoutView } from '../lane-layout.js';
import { newViewState, type EditorViewState } from '../view-state.js';

export const at = (value: number): SampleCount => expectSuccess(sampleCount(value));

/** A colour whose red channel names what it is, so a test can find a batch by colour. */
const named = (red: number): Colour => [red / 100, 0, 0, 1];

export const PALETTE: EditorPalette = {
  background: named(1),
  laneSeparator: named(2),
  centreLine: named(3),
  peak: named(4),
  rms: named(5),
  clipped: named(6),
  pending: named(7),
  grid: named(8),
  rulerBackground: named(9),
  rulerTick: named(10),
  text: named(11),
  quietText: named(12),
  selectionFill: named(13),
  inactiveSelectionFill: named(14),
  selectionBorder: named(15),
  playhead: named(16),
  marker: named(17),
  selectedMarker: named(18),
  region: named(19),
  loop: named(20),
  snap: named(21),
  spectrogramBackground: named(22),
  rulerText: named(23),
  selectedRegion: named(24),
};

const TYPE: EditorType = { label: '12px sans-serif', small: '11px sans-serif' };

const NO_TICKS: RulerTicks = { major: [], minor: [] };

export function marker(id: string, position: number): PlacedMarker {
  return { id: unsafeBrandId<'MarkerId'>(id), displayName: id, position: at(position) };
}

export function region(id: string, start: number, length: number): PlacedRegion {
  return {
    id: unsafeBrandId<'RegionId'>(id),
    displayName: id,
    start: at(start),
    length: at(length),
    tags: [],
  };
}

/** A scene of `channels` channels of `length` frames, in 1000 by 400 CSS pixels at one pixel a CSS pixel. */
export function scene(
  options: {
    readonly length?: number;
    readonly channels?: number;
    readonly state?: (state: EditorViewState) => EditorViewState;
  } & Partial<Omit<ViewScene, 'layout' | 'state'>>,
): ViewScene {
  const length = at(options.length ?? 100_000);
  const channels = options.channels ?? 2;
  const state = (options.state ?? ((each) => each))(newViewState(length, 1000));
  return {
    layout: layoutView(state, 1000, 400, channels, false),
    state,
    pixelRatio: options.pixelRatio ?? 1,
    content: options.content ?? {
      length,
      channelNames: Array.from({ length: channels }, (_, index) => `Channel ${String(index + 1)}`),
      markers: [],
      regions: [],
    },
    audio: options.audio ?? { pyramid: undefined, buckets: undefined, samples: undefined, length },
    selection: options.selection ?? EMPTY_SELECTION,
    playhead: options.playhead,
    preview: options.preview,
    snap: options.snap,
    ruler: options.ruler ?? NO_TICKS,
    grid: options.grid,
    picture: options.picture ?? [],
    palette: PALETTE,
    type: TYPE,
  };
}
