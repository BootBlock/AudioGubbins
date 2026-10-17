/**
 * The semantic colour tokens, and how each is derived.
 *
 * REQ-UX-155 requires AudioGubbins to own a semantic token system rather than
 * scattering literal colours through components. A component asks for
 * `surface.raised`, never for a particular grey, so a theme change reaches
 * every component without any of them being edited.
 *
 * REQ-UX-070 requires the waveform, spectrogram, selection, meter, marker and
 * analysis palettes to be independent of the chrome theme. They are: a user who
 * brightens the interface does not get a washed-out waveform, because the
 * waveform palette is built for legibility against its own background rather
 * than derived from the surface behind the panel. Each theme has its own
 * display (design language, section 8): dark in the dark theme, and a light
 * one, paper white, in the light theme.
 *
 * Every token is built from the user's preferences. Nothing is a stored
 * literal, which is what makes the brightness control a rebuild of the palette
 * rather than a filter over it.
 */

import { CATEGORY_NAMES, categoryColour } from './category.js';
import { buildChrome, type ChromePalette } from './chrome.js';
import {
  ContrastRequirement,
  contrastSolver,
  hardestFor,
  oklch,
  shiftLightness,
  withAlpha,
  type ContrastShortfall,
  type Oklch,
} from './colour.js';
import { textRequirements } from './contrast-requirements.js';
import { buildElevation, type ElevationPalette } from './elevation.js';
import { finish } from './finish.js';
import { buildHardware, type HardwarePalette } from './hardware.js';
import { ACCENT_HUES, type AccentName, type ContrastLevel } from './preferences.js';

/** Colours the waveform display uses, independent of the chrome theme. */
export type WaveformPalette = {
  /** Behind the waveform. */
  readonly background: Oklch;

  /** The peak envelope. */
  readonly peak: Oklch;

  /** The root-mean-square body inside the peaks. */
  readonly rms: Oklch;

  /** The zero line. */
  readonly centreLine: Oklch;

  /** Samples at or beyond full scale, which the user must be able to find. */
  readonly clipped: Oklch;

  /** The playhead. */
  readonly playhead: Oklch;

  /** Where the peaks are not yet known: a step from the background. */
  readonly pending: Oklch;

  /** Text written on the display: a marker's or a region's name. */
  readonly label: Oklch;

  /** Supporting text written on the display: a channel's name, a frequency. */
  readonly labelSecondary: Oklch;

  /** Level guides and minor ticks: the analysis grid at a translucency. */
  readonly grid: Oklch;
};

/** Colours a selection uses, in any editor. */
export type SelectionPalette = {
  /** The translucent wash over the selected range. */
  readonly fill: Oklch;

  /** The edge of the selection. */
  readonly border: Oklch;

  /** A draggable edge handle. */
  readonly handle: Oklch;
};

/** Colours a level meter uses. */
export type MeterPalette = {
  readonly background: Oklch;

  /** Ordinary level. */
  readonly low: Oklch;

  /** Approaching full scale. */
  readonly mid: Oklch;

  /** At the top of the usable range. */
  readonly high: Oklch;

  /** Over full scale. */
  readonly clip: Oklch;
};

/** Colours an analysis display draws over its data. */
export type AnalysisPalette = {
  /** Grid lines. */
  readonly grid: Oklch;

  /** A response or transfer curve. */
  readonly curve: Oklch;

  /** The area under a curve, at its strongest; a component fades it towards the centre line. */
  readonly area: Oklch;

  /** A threshold line. */
  readonly threshold: Oklch;

  /** The dot marking the signal now. */
  readonly signal: Oklch;
};

/** Colours a marker takes. */
export type MarkerPalette = {
  /** A marker the user has not coloured. */
  readonly default: Oklch;
};

/**
 * The spectrogram intensity ramp, from silence to full scale.
 *
 * A list of stops rather than named colours, because a spectrogram maps a
 * continuous magnitude. The ramp moves monotonically in perceptual lightness
 * away from silence, rising on the dark display and falling on the light one,
 * so that the loudest energy is always the strongest contrast against silence.
 * A ramp that doubles back, as several popular ones do, makes two different
 * magnitudes look identical.
 */
export type SpectrogramRamp = readonly [Oklch, ...Oklch[]];

/** Colours available for a marker or a track, chosen by the user. */
export type CategoryPalette = Readonly<Record<string, Oklch>>;

/** Every palette, built for one set of preferences. */
export interface Palette {
  readonly chrome: ChromePalette;
  readonly elevation: ElevationPalette;
  readonly waveform: WaveformPalette;
  readonly selection: SelectionPalette;
  readonly meter: MeterPalette;
  readonly spectrogram: SpectrogramRamp;

  /** Marker and track colours, keyed by the name stored in the project. */
  readonly category: CategoryPalette;

  readonly marker: MarkerPalette;
  readonly analysis: AnalysisPalette;
  readonly hardware: HardwarePalette;

  /**
   * Every token that could not reach its contrast requirement.
   *
   * Empty for every palette AudioGubbins ships, which the theme tests assert
   * across the whole brightness range. Carried so that a palette which falls
   * short says which token and by how much, rather than handing out an
   * unreadable colour as if it were a readable one.
   */
  readonly contrastShortfalls: readonly ContrastShortfall[];
}

/** How a palette is built. */
export interface PaletteOptions {
  readonly dark: boolean;
  readonly accent: AccentName;

  /** Perceptual lightness offset from -1 to 1, where 0 is as designed. */
  readonly brightness: number;

  readonly contrast: ContrastLevel;
}

/**
 * The two displays, as designed at the shipped brightness.
 *
 * The display's own surfaces, the wash where peaks are not yet known and the
 * zero line, are steps from its background rather than lightnesses of their
 * own, so a brightness that carries the background to an end of the range
 * cannot carry them onto it: the paper-white background reaches white well
 * before the top of the control.
 */
const DISPLAYS = {
  dark: {
    background: oklch(0.13, 0.01, 255),
    pendingStep: 0.12,
    centreLineStep: 0.27,
    peak: { lightness: 0.72, chroma: 0.13 },
    rms: { lightness: 0.86, chroma: 0.09 },
    playhead: oklch(0.95, 0.02, 90),
    labelSeed: oklch(0.96, 0.006, 255),
    secondarySeed: oklch(0.8, 0.01, 255),
    selection: {
      fill: { lightness: 0.7, chroma: 0.12, alpha: 0.28 },
      border: { lightness: 0.8, chroma: 0.14 },
      handle: { lightness: 0.9, chroma: 0.1 },
    },
    meterBackground: oklch(0.16, 0.008, 255),
    analysisGrid: oklch(0.45, 0.01, 255),
    spectrogram: [
      oklch(0.1, 0.02, 280),
      oklch(0.28, 0.12, 290),
      oklch(0.45, 0.17, 320),
      oklch(0.6, 0.2, 20),
      oklch(0.75, 0.18, 60),
      oklch(0.88, 0.14, 95),
      oklch(0.98, 0.04, 105),
    ],
  },
  light: {
    background: oklch(0.98, 0.004, 255),
    pendingStep: -0.07,
    centreLineStep: -0.2,
    peak: { lightness: 0.66, chroma: 0.15 },
    // Darker than the peak here, as it is lighter than the peak on the dark
    // display: the body inside the envelope is the stronger mark in both.
    rms: { lightness: 0.48, chroma: 0.17 },
    playhead: oklch(0.3, 0.03, 255),
    labelSeed: oklch(0.25, 0.006, 255),
    secondarySeed: oklch(0.45, 0.01, 255),
    selection: {
      fill: { lightness: 0.62, chroma: 0.14, alpha: 0.16 },
      border: { lightness: 0.52, chroma: 0.17 },
      handle: { lightness: 0.5, chroma: 0.15 },
    },
    meterBackground: oklch(0.88, 0.008, 255),
    analysisGrid: oklch(0.8, 0.01, 255),
    // Paper white to dark ember (owner's decision, 2026-10-16).
    spectrogram: [
      oklch(0.985, 0.004, 255),
      oklch(0.9, 0.04, 280),
      oklch(0.76, 0.11, 295),
      oklch(0.62, 0.18, 325),
      oklch(0.55, 0.2, 15),
      oklch(0.44, 0.16, 35),
      oklch(0.28, 0.08, 30),
    ],
  },
} as const;

/** How translucent the grid lines drawn on the waveform display are. */
const WAVEFORM_GRID_ALPHA = 0.45;

/** How strong the area under an analysis curve is at its edge. */
const ANALYSIS_AREA_ALPHA = 0.32;

/** How translucent a threshold line is. */
const ANALYSIS_THRESHOLD_ALPHA = 0.45;

/**
 * Builds the waveform palette for the display of the theme.
 *
 * The text written on the display is solved, as the chrome's text is, against
 * the surface of the display it is hardest to read on: the background, the
 * wash where peaks are not yet known, or the floor of the spectrogram,
 * `floor`. The peak envelope is solved to the 3 to 1 of a drawn mark against
 * the background, which the paper-white display needs at its darker
 * brightnesses and the dark display already meets.
 */
function buildWaveform(
  options: PaletteOptions,
  floor: Oklch,
  analysisGrid: Oklch,
  solver: ReturnType<typeof contrastSolver>,
): WaveformPalette {
  const display = options.dark ? DISPLAYS.dark : DISPLAYS.light;
  const accentHue = ACCENT_HUES[options.accent];
  const background = finish(display.background, options);
  const pending = shiftLightness(background, display.pendingStep);
  const surfaces = [background, pending, floor];
  const requirement = textRequirements(options.contrast);

  return {
    background,
    peak: solver.solve(
      'waveform.peak',
      finish(oklch(display.peak.lightness, display.peak.chroma, accentHue), options),
      background,
      ContrastRequirement.LargeText,
    ),
    rms: finish(oklch(display.rms.lightness, display.rms.chroma, accentHue), options),
    centreLine: shiftLightness(background, display.centreLineStep),

    // Clipping is red whatever the accent. A user scanning for it should not
    // have to remember which colour they chose, and the accent could itself be
    // red, which would make clipping invisible.
    clipped: finish(oklch(0.68, 0.22, 25), options),
    playhead: finish(display.playhead, options),
    pending,
    label: solver.solve(
      'waveform.label',
      display.labelSeed,
      hardestFor(display.labelSeed, surfaces),
      requirement.primary,
    ),
    labelSecondary: solver.solve(
      'waveform.labelSecondary',
      display.secondarySeed,
      hardestFor(display.secondarySeed, surfaces),
      requirement.secondary,
    ),
    grid: withAlpha(analysisGrid, WAVEFORM_GRID_ALPHA),
  };
}

/**
 * Builds the selection palette for the display of the theme.
 *
 * The handle is what a pointer grabs, so it is solved to the 3 to 1 of a drawn
 * mark against the display's background.
 */
function buildSelection(
  options: PaletteOptions,
  background: Oklch,
  solver: ReturnType<typeof contrastSolver>,
): SelectionPalette {
  const { fill, border, handle } = (options.dark ? DISPLAYS.dark : DISPLAYS.light).selection;
  const accentHue = ACCENT_HUES[options.accent];

  return {
    // Translucent, so the waveform under the selection stays readable. A solid
    // selection would hide the material the user is about to act on. Finished
    // like every other token, or it would stay the same wash whatever
    // brightness and contrast the user chose.
    fill: finish(oklch(fill.lightness, fill.chroma, accentHue, fill.alpha), options),
    border: finish(oklch(border.lightness, border.chroma, accentHue), options),
    handle: solver.solve(
      'selection.handle',
      finish(oklch(handle.lightness, handle.chroma, accentHue), options),
      background,
      ContrastRequirement.LargeText,
    ),
  };
}

/**
 * Builds the meter palette.
 *
 * Green, amber and red, which every meter a sound engineer has used follows,
 * the same in both themes. Inventing a scheme here would cost recognition for
 * no gain.
 */
function buildMeter(options: PaletteOptions): MeterPalette {
  return {
    background: finish((options.dark ? DISPLAYS.dark : DISPLAYS.light).meterBackground, options),
    low: finish(oklch(0.72, 0.16, 150), options),
    mid: finish(oklch(0.8, 0.16, 95), options),
    high: finish(oklch(0.75, 0.18, 60), options),
    clip: finish(oklch(0.65, 0.23, 25), options),
  };
}

/**
 * Builds the spectrogram ramp.
 *
 * Lightness moves monotonically from the quietest stop to the loudest, so a
 * stronger pixel always means a louder one. Hue rotates as well, which gives
 * the eye a second cue without the ramp ever reversing in lightness.
 */
function buildSpectrogram(options: PaletteOptions): SpectrogramRamp {
  const [silence, ...louder] = (options.dark ? DISPLAYS.dark : DISPLAYS.light).spectrogram;
  return [finish(silence, options), ...louder.map((stop) => finish(stop, options))];
}

/** Builds the marker and track colours, keyed by the name a project stores. */
function buildCategory(options: PaletteOptions): CategoryPalette {
  return Object.fromEntries(CATEGORY_NAMES.map((name) => [name, categoryColour(name, options)]));
}

/** Builds the colours an analysis display draws with. */
function buildAnalysis(
  options: PaletteOptions,
  chrome: ChromePalette,
  meter: MeterPalette,
): AnalysisPalette {
  return {
    grid: finish((options.dark ? DISPLAYS.dark : DISPLAYS.light).analysisGrid, options),
    curve: chrome.accent,
    area: withAlpha(chrome.accent, ANALYSIS_AREA_ALPHA),
    threshold: withAlpha(meter.mid, ANALYSIS_THRESHOLD_ALPHA),
    signal: meter.mid,
  };
}

/** Builds every palette for one set of preferences. */
export function buildPalette(options: PaletteOptions): Palette {
  const solver = contrastSolver();
  const chrome = buildChrome(options, solver);
  const spectrogram = buildSpectrogram(options);
  const meter = buildMeter(options);
  const analysis = buildAnalysis(options, chrome, meter);
  const waveform = buildWaveform(options, spectrogram[0], analysis.grid, solver);
  return {
    chrome,
    elevation: buildElevation(chrome, options.dark),
    waveform,
    selection: buildSelection(options, waveform.background, solver),
    meter,
    spectrogram,
    category: buildCategory(options),
    marker: { default: categoryColour('amber', options) },
    analysis,
    hardware: buildHardware(options, chrome),
    contrastShortfalls: solver.shortfalls(),
  };
}
