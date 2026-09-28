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
 * than derived from the surface behind the panel.
 *
 * Every token is built from the user's preferences. Nothing is a stored
 * literal, which is what makes the brightness control a rebuild of the palette
 * rather than a filter over it.
 */

import {
  contrastSolver,
  oklch,
  scaleChroma,
  shiftLightness,
  type ContrastShortfall,
  type Oklch,
} from './colour.js';
import { ACCENT_HUES, ContrastLevel, type AccentName } from './preferences.js';
import { buildChrome, type ChromePalette } from './chrome.js';

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

/**
 * The spectrogram intensity ramp, from silence to full scale.
 *
 * A list of stops rather than named colours, because a spectrogram maps a
 * continuous magnitude. The ramp rises monotonically in perceptual lightness,
 * so that a brighter pixel always means a louder one. A ramp that dips, as
 * several popular ones do, makes two different magnitudes look identical.
 */
export type SpectrogramRamp = readonly [Oklch, ...Oklch[]];

/** Colours available for a marker or a track, chosen by the user. */
export type CategoryPalette = Readonly<Record<string, Oklch>>;

/** Every palette, built for one set of preferences. */
export interface Palette {
  readonly chrome: ChromePalette;
  readonly waveform: WaveformPalette;
  readonly selection: SelectionPalette;
  readonly meter: MeterPalette;
  readonly spectrogram: SpectrogramRamp;

  /** Marker and track colours, keyed by the name stored in the project. */
  readonly category: CategoryPalette;

  /** Grid lines and overlays drawn on an analysis display. */
  readonly analysisGrid: Oklch;

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
 * How far the brightness control moves lightness.
 *
 * A full-scale brightness of 1 moves every token by 0.18 in OKLCH lightness,
 * which is a clearly visible change while leaving room above the lightest
 * surface and below the darkest. A larger range would let a user flatten the
 * palette against either end, where every surface becomes the same colour.
 */
const BRIGHTNESS_SCALE = 0.18;

/** How high-contrast mode separates surfaces from text. */
const HIGH_CONTRAST = {
  /** Extra perceptual lightness between the darkest and lightest tokens. */
  separation: 0.08,

  /** Colour is reduced, because a strong tint makes text on it harder to read. */
  chromaFactor: 0.6,
} as const;

/** Applies the brightness offset, in the direction that makes a theme lighter. */
function brighten(colour: Oklch, options: PaletteOptions): Oklch {
  return shiftLightness(colour, options.brightness * BRIGHTNESS_SCALE);
}

/**
 * Pushes a token away from the mid point, for high-contrast mode.
 *
 * Dark tokens get darker and light tokens get lighter, so the gap between a
 * surface and the text on it widens rather than both moving together.
 */
function separate(colour: Oklch, options: PaletteOptions): Oklch {
  if (options.contrast !== ContrastLevel.High) return colour;

  const direction = colour.lightness >= 0.5 ? 1 : -1;
  return scaleChroma(
    shiftLightness(colour, direction * HIGH_CONTRAST.separation),
    HIGH_CONTRAST.chromaFactor,
  );
}

/** Applies brightness and contrast to a designed token. */
function finish(colour: Oklch, options: PaletteOptions): Oklch {
  return separate(brighten(colour, options), options);
}

/**
 * Builds the waveform palette.
 *
 * Built against its own dark background in both themes. A waveform on a white
 * background is harder to read at a glance, and the editing surface is where a
 * user spends the session, so it keeps its own contrast rather than inheriting
 * the chrome's.
 */
function buildWaveform(options: PaletteOptions): WaveformPalette {
  const accentHue = ACCENT_HUES[options.accent];

  return {
    background: finish(oklch(options.dark ? 0.13 : 0.18, 0.01, 255), options),
    peak: finish(oklch(0.72, 0.13, accentHue), options),
    rms: finish(oklch(0.86, 0.09, accentHue), options),
    centreLine: finish(oklch(0.4, 0.01, 255), options),

    // Clipping is red whatever the accent. A user scanning for it should not
    // have to remember which colour they chose, and the accent could itself be
    // red, which would make clipping invisible.
    clipped: finish(oklch(0.68, 0.22, 25), options),
    playhead: finish(oklch(0.95, 0.02, 90), options),
  };
}

/** Builds the selection palette. */
function buildSelection(options: PaletteOptions): SelectionPalette {
  const accentHue = ACCENT_HUES[options.accent];

  return {
    // Translucent, so the waveform under the selection stays readable. A solid
    // selection would hide the material the user is about to act on. Finished
    // like every other token, or it would stay the same wash whatever
    // brightness and contrast the user chose.
    fill: finish(oklch(0.7, 0.12, accentHue, 0.28), options),
    border: finish(oklch(0.8, 0.14, accentHue), options),
    handle: finish(oklch(0.9, 0.1, accentHue), options),
  };
}

/**
 * Builds the meter palette.
 *
 * Green, amber and red, which every meter a sound engineer has used follows.
 * Inventing a scheme here would cost recognition for no gain.
 */
function buildMeter(options: PaletteOptions): MeterPalette {
  return {
    background: finish(oklch(0.16, 0.008, 255), options),
    low: finish(oklch(0.72, 0.16, 150), options),
    mid: finish(oklch(0.8, 0.16, 95), options),
    high: finish(oklch(0.75, 0.18, 60), options),
    clip: finish(oklch(0.65, 0.23, 25), options),
  };
}

/**
 * Builds the spectrogram ramp.
 *
 * Lightness rises monotonically from the quietest stop to the loudest, so a
 * brighter pixel always means a louder one. Hue rotates as well, which gives
 * the eye a second cue without the ramp ever reversing in lightness.
 */
function buildSpectrogram(options: PaletteOptions): SpectrogramRamp {
  return [
    finish(oklch(0.1, 0.02, 280), options),
    finish(oklch(0.28, 0.12, 290), options),
    finish(oklch(0.45, 0.17, 320), options),
    finish(oklch(0.6, 0.2, 20), options),
    finish(oklch(0.75, 0.18, 60), options),
    finish(oklch(0.88, 0.14, 95), options),
    finish(oklch(0.98, 0.04, 105), options),
  ];
}

/**
 * Builds the marker and track colours.
 *
 * Keyed by name, because a project stores the name. REQ-UX-070 keeps the colour
 * itself out of the project: a marker recorded as `coral` stays legible when
 * the user switches to a light theme, while one recorded as a hexadecimal value
 * does not.
 */
function buildCategory(options: PaletteOptions): CategoryPalette {
  const lightness = options.dark ? 0.72 : 0.55;
  const hues = {
    coral: 25,
    amber: 70,
    lime: 120,
    teal: 180,
    sky: 230,
    indigo: 275,
    violet: 305,
    rose: 350,
  };

  return Object.fromEntries(
    Object.entries(hues).map(([name, hue]) => [name, finish(oklch(lightness, 0.14, hue), options)]),
  );
}

/** Builds every palette for one set of preferences. */
export function buildPalette(options: PaletteOptions): Palette {
  const solver = contrastSolver();
  return {
    chrome: buildChrome(options, solver),
    waveform: buildWaveform(options),
    selection: buildSelection(options),
    meter: buildMeter(options),
    spectrogram: buildSpectrogram(options),
    category: buildCategory(options),
    analysisGrid: finish(oklch(0.45, 0.01, 255), options),
    contrastShortfalls: solver.shortfalls(),
  };
}
