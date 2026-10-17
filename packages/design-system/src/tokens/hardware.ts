/**
 * The materials of the hardware controls: the knob, the fader, the switches,
 * the panel lamps, the power switch and the record lamp (design language,
 * section 10).
 *
 * Metal is metal in both themes, so the materials are fixed lightnesses at the
 * surface hue with a trace of chroma, separated for high contrast like every
 * palette but not moved by brightness, which is a setting of the interface's
 * surfaces and not of the light falling on a knob. What is lit by the accent or
 * by the recording red follows those colours, so a theme, brightness or
 * contrast change reaches it as it reaches them.
 */

import { RECORDING_HUE, SURFACE_HUE, type ChromePalette } from './chrome.js';
import { mix, oklch, withAlpha, type Oklch } from './colour.js';
import { finish } from './finish.js';
import type { ContrastLevel } from './preferences.js';

/** The hardware's single colours. */
export type HardwareMaterials = {
  /** Brushed metal where the light falls on it. */
  readonly metalHighlight: Oklch;

  readonly metalMid: Oklch;

  /** Brushed metal turned from the light. */
  readonly metalShade: Oklch;

  /** A chamfer's dark face. */
  readonly chamferDark: Oklch;

  /** A chamfer's lit face. */
  readonly chamferLight: Oklch;

  /** The hole a lamp or a switch is set in. */
  readonly cutout: Oklch;

  /** An LED that is off. */
  readonly ledOff: Oklch;

  /** The gloss on a lamp's lens or a cap. */
  readonly gloss: Oklch;

  /** The power switch's cap while it is on: the accent seen through dark plastic. */
  readonly powerLitCap: Oklch;
};

/**
 * The hardware's gradients, each as its stops from the centre outward, so an
 * SVG gradient or a canvas can draw them stop by stop.
 */
export type HardwareRamps = {
  /** An unlit cap, from its top to its foot. */
  readonly capUnlit: readonly Oklch[];

  /** The record lamp lit from behind: centre, 22 %, 62 %, 88 %, rim. */
  readonly recordLit: readonly Oklch[];

  /** The record lamp unlit: centre, edge, rim. */
  readonly recordUnlit: readonly Oklch[];
};

/** Every hardware colour. */
export interface HardwarePalette {
  readonly materials: HardwareMaterials;
  readonly ramps: HardwareRamps;
}

/** How a hardware palette is built. */
export interface HardwareOptions {
  readonly dark: boolean;
  readonly brightness: number;
  readonly contrast: ContrastLevel;
}

/** The trace of chroma metal keeps, so it reads as metal rather than as grey paint. */
const METAL_CHROMA = 0.006;

/**
 * The record lamp's stops, as lightness, chroma and a turn of hue from the
 * recording red: light scattered under the lit plastic warms its centre.
 */
const RECORD_LIT = [
  { lightness: 0.93, chroma: 0.07, turn: 20 },
  { lightness: 0.76, chroma: 0.19, turn: 7 },
  { lightness: 0.58, chroma: 0.22, turn: 2 },
  { lightness: 0.5, chroma: 0.2, turn: 1 },
  { lightness: 0.64, chroma: 0.2, turn: 5 },
] as const;

const RECORD_UNLIT = [
  { lightness: 0.44, chroma: 0.13, turn: 2 },
  { lightness: 0.3, chroma: 0.1, turn: 0 },
  { lightness: 0.38, chroma: 0.1, turn: 0 },
] as const;

/** How much of the accent the power switch's lit cap keeps, the rest being dark plastic. */
const POWER_CAP_ACCENT_SHARE = 0.5;

/** Builds the hardware palette. */
export function buildHardware(options: HardwareOptions, chrome: ChromePalette): HardwarePalette {
  const hue = options.dark ? SURFACE_HUE.dark : SURFACE_HUE.light;
  const fixed = { brightness: 0, contrast: options.contrast };
  const metal = (lightness: number): Oklch => finish(oklch(lightness, METAL_CHROMA, hue), fixed);
  const lamp = (stop: { lightness: number; chroma: number; turn: number }): Oklch =>
    finish(oklch(stop.lightness, stop.chroma, RECORDING_HUE + stop.turn), options);

  return {
    materials: {
      metalHighlight: metal(0.95),
      metalMid: metal(0.7),
      metalShade: metal(0.38),
      chamferDark: metal(0.3),
      chamferLight: metal(0.86),
      // A hole in a light panel shows less shadow than one in a dark panel.
      cutout: oklch(0, 0, 0, options.dark ? 0.55 : 0.3),
      ledOff: metal(0.3),
      gloss: withAlpha(oklch(1, 0, 0), 0.55),
      powerLitCap: mix(chrome.accent, oklch(0.22, METAL_CHROMA, hue), POWER_CAP_ACCENT_SHARE),
    },
    ramps: {
      capUnlit: [metal(0.3), metal(0.13)],
      recordLit: RECORD_LIT.map(lamp),
      recordUnlit: RECORD_UNLIT.map(lamp),
    },
  };
}
