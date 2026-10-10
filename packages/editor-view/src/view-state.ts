/**
 * One editor view's presentation state (REQ-EDIT-061).
 *
 * Each view of an asset keeps its own zoom, scroll, display mode, tool, channel
 * visibility, amplitude, overlays, snapping, time format, frequency axis,
 * spectrogram and the settings its spectral tools draw with, so two views of
 * one asset can show it differently while the asset, its content and its
 * selection stay shared. It is a value: every change makes a new one, which the
 * application's view store holds and persists, and nothing about it lives in
 * the renderer.
 */

import { NO_FEATHER, type SampleCount, type SpectralFeather } from '@audiogubbins/domain';
import {
  DEFAULT_SPECTROGRAM_CONFIG,
  LEVEL_FLOOR_DECIBELS,
  LEVEL_STEP_DECIBELS,
  levelDecibels,
  type SpectrogramConfig,
} from '@audiogubbins/spectral-analysis';
import {
  DEFAULT_SNAP_SETTINGS,
  SpectralCombination,
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
 * The explicit tools a view offers (REQ-EDIT-065). The spectral marquee, the
 * spectral lasso and the spectral brush draw on a spectrogram lane and make a
 * spectral selection (ADR-0082).
 */
export const ToolId = {
  Select: 'select',
  TimeSelect: 'time-select',
  Hand: 'hand',
  Zoom: 'zoom',
  Razor: 'razor',
  Marker: 'marker',
  Region: 'region',
  SpectralMarquee: 'spectral-marquee',
  SpectralLasso: 'spectral-lasso',
  SpectralBrush: 'spectral-brush',
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
  /** The outline of where each spectral edit of the asset applies. */
  readonly spectralEdits: boolean;
}

/** A spectrogram lane's frequency axis, which spectral editing draws into. */
export interface SpectralSettings {
  readonly frequencyScale: 'linear' | 'logarithmic';
  readonly lowest: number;
  readonly highest: number;
}

/** The ramps a spectrogram may be drawn in, each the palette's (ADR-0082). */
export const SpectrogramColours = {
  /** The theme's spectrogram ramp, whose hue turns as it brightens. */
  Theme: 'theme',
  /** The same ramp's lightness alone. */
  Greyscale: 'greyscale',
} as const;

export type SpectrogramColours = (typeof SpectrogramColours)[keyof typeof SpectrogramColours];

/**
 * The levels a spectrogram's colours span, in dBFS: a level at or below the
 * floor is drawn in the ramp's first colour, one at or above the ceiling in
 * its last. Both lie on the tiles' half-decibel steps, within the levels a
 * tile holds, the ceiling at least {@link NARROWEST_DISPLAY_RANGE} above the
 * floor.
 */
export interface DisplayRange {
  readonly floor: number;
  readonly ceiling: number;
}

/** The fewest decibels a display range spans. */
const NARROWEST_DISPLAY_RANGE = 6;

/** The loudest level a tile tells apart: its highest byte. */
const LOUDEST_LEVEL = levelDecibels(255);

/** Whether `range` is one a spectrogram can be drawn with. */
export function isDisplayRange(range: DisplayRange): boolean {
  const onStep = (level: number): boolean =>
    Number.isInteger((level - LEVEL_FLOOR_DECIBELS) / LEVEL_STEP_DECIBELS);
  return (
    onStep(range.floor) &&
    onStep(range.ceiling) &&
    range.floor >= LEVEL_FLOOR_DECIBELS &&
    range.ceiling <= LOUDEST_LEVEL &&
    range.ceiling - range.floor >= NARROWEST_DISPLAY_RANGE
  );
}

/**
 * How a view's spectrogram is analysed and drawn (ADR-0080, ADR-0082): the
 * analysis's settings, which choose the tiles, and the display range and
 * ramp, which map a tile's bytes to colours and never change a tile.
 */
export interface SpectrogramDisplay {
  readonly analysis: SpectrogramConfig;
  readonly range: DisplayRange;
  readonly colours: SpectrogramColours;
}

/** The spectrogram a new view draws. */
export const DEFAULT_SPECTROGRAM_DISPLAY: SpectrogramDisplay = {
  analysis: DEFAULT_SPECTROGRAM_CONFIG,
  range: { floor: -120, ceiling: 0 },
  colours: SpectrogramColours.Theme,
};

/**
 * How a view's spectral tools draw (ADR-0082), which the person sets in the
 * Spectral panel. They are the view's, as its tool is: a brush's radius is
 * measured on the view's own axes, so it belongs with the view it is drawn
 * in, and the panel shows the settings of the editor in use.
 */
export interface SpectralToolSettings {
  /** The brush's radius in CSS pixels. */
  readonly brushRadius: number;
  /** How much of the brush's radius is at full strength, from 0 to just below 1. */
  readonly hardness: number;
  /** How far past their edges the marquee's and the lasso's shapes fade out. */
  readonly feather: SpectralFeather;
  /**
   * How a shape drawn with no modifier held joins the spectral selection: the
   * combination mode, which a finger or a pen, holding no key, adds and takes
   * away with. Shift and Alt still say how where they are held.
   */
  readonly combination: SpectralCombination;
}

/** How the spectral tools draw before the person changes anything. */
const DEFAULT_SPECTRAL_TOOL_SETTINGS: SpectralToolSettings = {
  brushRadius: 12,
  hardness: 0.5,
  feather: NO_FEATHER,
  combination: SpectralCombination.Replace,
};

/**
 * The brush's controls: its radius in whole CSS pixels, and its hardness in
 * twentieths, below 1 since a hardness of 1 would leave no soft edge for the
 * mask's weight to fall across (ADR-0081).
 */
export const SPECTRAL_TOOL_RANGES = {
  brushRadius: { minimum: 2, maximum: 96, step: 1 },
  hardness: { minimum: 0, maximum: 0.95, step: 0.05 },
} as const;

/** `value` as a brush radius the control offers: the nearest whole pixel within the range. */
export function brushRadiusOf(value: number): number {
  const { minimum, maximum } = SPECTRAL_TOOL_RANGES.brushRadius;
  if (!Number.isFinite(value)) return DEFAULT_SPECTRAL_TOOL_SETTINGS.brushRadius;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/** How many steps the hardness has from nothing to full. */
const HARDNESS_STEPS = 20;

/**
 * `value` as a hardness the control offers: the nearest step within the
 * range. Dividing a whole number of steps by their count rounds once, so a
 * step has one value everywhere and a stroke drawn with it is one mask.
 */
export function hardnessOf(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPECTRAL_TOOL_SETTINGS.hardness;
  const stepped = Math.round(value * HARDNESS_STEPS);
  return Math.min(HARDNESS_STEPS - 1, Math.max(0, stepped)) / HARDNESS_STEPS;
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
  readonly spectrogram: SpectrogramDisplay;
  readonly spectralTools: SpectralToolSettings;
}

/** The overlays a new view draws. */
export const DEFAULT_OVERLAYS: Overlays = {
  grid: true,
  rms: true,
  clipping: true,
  markers: true,
  regions: true,
  filmstrip: true,
  spectralEdits: true,
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
    spectrogram: DEFAULT_SPECTROGRAM_DISPLAY,
    spectralTools: DEFAULT_SPECTRAL_TOOL_SETTINGS,
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
