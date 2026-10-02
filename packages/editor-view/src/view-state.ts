/**
 * One editor view's presentation state (REQ-EDIT-061).
 *
 * Each view of an asset keeps its own zoom, scroll, display mode, tool, channel
 * visibility, amplitude, overlays, snapping, time format and spectral settings,
 * so two views of one asset can show it differently while the asset, its
 * content and its selection stay shared. It is a value: every change makes a
 * new one, which the application's view store holds and persists, and nothing
 * about it lives in the renderer.
 */

import type { SampleCount } from '@audiogubbins/domain';
import {
  DEFAULT_SNAP_SETTINGS,
  TimeFormatKind,
  viewportFitting,
  type SnapSettings,
  type TimeFormat,
  type ViewportState,
} from '@audiogubbins/timeline';

/** How the lanes of a view present the audio (REQ-EDIT-062). */
export const DisplayMode = {
  Waveform: 'waveform',
  Spectrogram: 'spectrogram',
  /** A waveform lane above a spectrogram lane for each channel. */
  Stacked: 'stacked',
  /** The waveform drawn over the spectrogram in one lane for each channel. */
  Overlay: 'overlay',
} as const;

export type DisplayMode = (typeof DisplayMode)[keyof typeof DisplayMode];

/**
 * The explicit tools a view offers (REQ-EDIT-065). The spectral marquee, lasso
 * and brush arrive with spectral editing (Phase 08), and the region tool with
 * regions (Phase 05, REQ-EDIT-014); the selection set already carries their
 * targets.
 */
export const ToolId = {
  Select: 'select',
  TimeSelect: 'time-select',
  Hand: 'hand',
  Zoom: 'zoom',
  Razor: 'razor',
  Marker: 'marker',
  Region: 'region',
} as const;

export type ToolId = (typeof ToolId)[keyof typeof ToolId];

/** What a view draws over the audio. */
export interface Overlays {
  readonly grid: boolean;
  readonly rms: boolean;
  readonly clipping: boolean;
  readonly markers: boolean;
  readonly regions: boolean;
  /** A strip of picture thumbnails, where reference picture is bound. */
  readonly filmstrip: boolean;
}

/** How a spectrogram lane is laid out, which spectral editing draws into. */
export interface SpectralSettings {
  readonly frequencyScale: 'linear' | 'logarithmic';
  readonly lowest: number;
  readonly highest: number;
}

/** Whether and how a view keeps the playhead in sight while it plays. */
export const FollowMode = {
  Off: 'off',
  /** Turn a page when the playhead reaches the right edge. */
  Page: 'page',
  /** Keep the playhead in the middle. */
  Centre: 'centre',
} as const;

export type FollowMode = (typeof FollowMode)[keyof typeof FollowMode];

/** One view's presentation state. */
export interface EditorViewState {
  readonly viewport: ViewportState;
  readonly displayMode: DisplayMode;
  readonly tool: ToolId;
  /** Channels not drawn, by index, ascending; every channel is drawn where empty. */
  readonly hiddenChannels: readonly number[];
  /** How much the waveform's height is magnified: 1 shows full scale at the lane's edges. */
  readonly amplitude: number;
  readonly overlays: Overlays;
  readonly snapping: SnapSettings;
  readonly timeFormat: TimeFormat;
  readonly follow: FollowMode;
  readonly spectral: SpectralSettings;
}

/** The overlays a new view draws. */
export const DEFAULT_OVERLAYS: Overlays = {
  grid: true,
  rms: true,
  clipping: true,
  markers: true,
  regions: true,
  filmstrip: true,
};

/** The amplitudes a view steps between. */
export const AMPLITUDES: readonly number[] = [1, 2, 4, 8, 16, 32, 64];

/** A new view of an asset of `length` frames, the whole of it in `width` CSS pixels. */
export function newViewState(length: SampleCount, width: number): EditorViewState {
  return {
    viewport: viewportFitting(length, width),
    displayMode: DisplayMode.Waveform,
    tool: ToolId.Select,
    hiddenChannels: [],
    amplitude: 1,
    overlays: DEFAULT_OVERLAYS,
    snapping: DEFAULT_SNAP_SETTINGS,
    timeFormat: { kind: TimeFormatKind.Clock },
    follow: FollowMode.Page,
    spectral: { frequencyScale: 'logarithmic', lowest: 20, highest: 20_000 },
  };
}

/** The channels a view draws, of a layout of `channelCount`. */
export function visibleChannels(state: EditorViewState, channelCount: number): readonly number[] {
  const hidden = new Set(state.hiddenChannels);
  return Array.from({ length: channelCount }, (_, index) => index).filter(
    (index) => !hidden.has(index),
  );
}

/**
 * `state` with channel `channel` shown or hidden. The last channel shown cannot
 * be hidden: a view that draws no channel draws nothing to act on.
 */
export function withChannelShown(
  state: EditorViewState,
  channel: number,
  shown: boolean,
  channelCount: number,
): EditorViewState {
  const hidden = new Set(state.hiddenChannels);
  if (shown) hidden.delete(channel);
  else hidden.add(channel);
  const next = [...hidden]
    .filter((index) => index >= 0 && index < channelCount)
    .sort((a, b) => a - b);
  return next.length >= channelCount ? state : { ...state, hiddenChannels: next };
}

/** `state` magnified one step further, or one step less, within the steps. */
export function withAmplitudeStep(state: EditorViewState, steps: number): EditorViewState {
  const index = AMPLITUDES.indexOf(state.amplitude);
  const next =
    AMPLITUDES[Math.min(AMPLITUDES.length - 1, Math.max(0, (index < 0 ? 0 : index) + steps))];
  return next === undefined || next === state.amplitude ? state : { ...state, amplitude: next };
}
