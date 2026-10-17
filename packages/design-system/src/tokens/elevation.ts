/**
 * The glass each level of the interface is drawn in (design language, section
 * 6): a surface of the chrome at a translucency, so the backdrop shows blurred
 * through it, and an edge of the primary text at a lower one.
 *
 * Derived from the chrome rather than stated, so a brightness, contrast or
 * theme change reaches the glass as it reaches the surface under it.
 */

import { withAlpha, type Oklch } from './colour.js';
import type { ChromePalette } from './chrome.js';

/** The fills and edges of the surface levels. */
export type ElevationPalette = {
  /** A panel's glass, and the transport bar's. */
  readonly panelFill: Oklch;

  readonly panelEdge: Oklch;

  /** The status bar's strip. */
  readonly stripFill: Oklch;

  /** A card or processor inside a panel. */
  readonly cardFill: Oklch;

  /** A menu, select list, popover, palette, dialogue or notice. */
  readonly overlayFill: Oklch;

  readonly overlayEdge: Oklch;

  /** A plain tooltip. */
  readonly tooltipFill: Oklch;

  /** A floating panel. */
  readonly floatingFill: Oklch;
};

/**
 * How opaque each level's glass is. The overlay is a little more opaque in the
 * light theme, where a pale backdrop through it would wash out the text on it.
 */
const OPACITY = {
  panel: 0.62,
  panelEdge: 0.09,
  strip: 0.4,
  card: 0.45,
  overlay: { dark: 0.66, light: 0.7 },
  overlayEdge: 0.12,
  tooltip: 0.92,
  floating: 0.78,
} as const;

/** Builds the glass of every level from the chrome it is cut from. */
export function buildElevation(chrome: ChromePalette, dark: boolean): ElevationPalette {
  return {
    panelFill: withAlpha(chrome.surfaceBase, OPACITY.panel),
    panelEdge: withAlpha(chrome.textPrimary, OPACITY.panelEdge),
    stripFill: withAlpha(chrome.surfaceBase, OPACITY.strip),
    cardFill: withAlpha(chrome.surfaceRaised, OPACITY.card),
    overlayFill: withAlpha(
      chrome.surfaceOverlay,
      dark ? OPACITY.overlay.dark : OPACITY.overlay.light,
    ),
    overlayEdge: withAlpha(chrome.textPrimary, OPACITY.overlayEdge),
    tooltipFill: withAlpha(chrome.surfaceOverlay, OPACITY.tooltip),
    floatingFill: withAlpha(chrome.surfaceOverlay, OPACITY.floating),
  };
}
