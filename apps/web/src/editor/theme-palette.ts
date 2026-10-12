/**
 * The colours and type an editor view draws with, taken from the theme
 * (REQ-UX-155, ADR-0012): the waveform, selection and analysis palettes, the
 * spectrogram's ramps, the text written on the display, and the chrome's ruler,
 * as the sRGB channels the renderer takes. A view has no colour of its own, so
 * a change of theme, brightness or contrast reaches the next frame it draws.
 */

import {
  oklchToSrgb,
  type Oklch,
  type SpectrogramRamp,
  type Theme,
} from '@audiogubbins/design-system';
import {
  SPECTROGRAM_RAMP_COLOURS,
  SpectrogramColours,
  type EditorPalette,
  type EditorType,
} from '@audiogubbins/editor-view';
import type { Colour } from '@audiogubbins/renderer';

/** The shell's own font stack, so the editor's labels read as the rest of the page does. */
const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function colour(value: Oklch, alpha?: number): Colour {
  const { red, green, blue, alpha: own } = oklchToSrgb(value);
  return [red, green, blue, alpha ?? own];
}

/** A category colour by name, or the accent where the theme has none of that name. */
function category(theme: Theme, name: string): Oklch {
  return theme.palette.category[name] ?? theme.palette.chrome.accent;
}

/** The hue `share` of the way from `from` to `to`, the shorter way round. */
function hueBetween(from: number, to: number, share: number): number {
  const turn = ((((to - from) % 360) + 540) % 360) - 180;
  return from + turn * share;
}

/**
 * The colour `share` of the way along `stops`, evenly spaced, each step
 * between two stops taken in OKLCH: lightness and chroma straight across, so
 * a ramp whose stops rise in lightness rises between them too.
 */
function alongRamp(stops: SpectrogramRamp, share: number): Oklch {
  const place = share * (stops.length - 1);
  const below = Math.min(stops.length - 2, Math.floor(place));
  const from = stops[Math.max(0, below)] ?? stops[0];
  const to = stops[Math.max(0, below) + 1] ?? from;
  const step = place - Math.max(0, below);
  return {
    lightness: from.lightness + (to.lightness - from.lightness) * step,
    chroma: from.chroma + (to.chroma - from.chroma) * step,
    hue: hueBetween(from.hue, to.hue, step),
  };
}

/**
 * The spectrogram's ramps from the theme's stops (ADR-0082): its colours, and
 * its lightness alone, each as many colours as a ramp maps, quietest first.
 */
function spectrogramRamps(stops: SpectrogramRamp): EditorPalette['spectrogramRamps'] {
  const shares = Array.from(
    { length: SPECTROGRAM_RAMP_COLOURS },
    (_, index) => index / (SPECTROGRAM_RAMP_COLOURS - 1),
  );
  const coloured = shares.map((share) => alongRamp(stops, share));
  return {
    [SpectrogramColours.Theme]: coloured.map((each) => colour(each)),
    [SpectrogramColours.Greyscale]: coloured.map((each) =>
      colour({ lightness: each.lightness, chroma: 0, hue: each.hue }),
    ),
  };
}

/** The editor's colours in `theme`. */
export function editorPaletteOf(theme: Theme): EditorPalette {
  const { waveform, selection, chrome, analysisGrid, spectrogram } = theme.palette;
  const fill = oklchToSrgb(selection.fill);
  return {
    background: colour(waveform.background),
    laneSeparator: colour(chrome.borderSubtle),
    centreLine: colour(waveform.centreLine),
    peak: colour(waveform.peak),
    rms: colour(waveform.rms),
    clipped: colour(waveform.clipped),
    pending: colour(waveform.pending),
    grid: colour(analysisGrid, 0.5),
    rulerBackground: colour(chrome.surfaceRaised),
    rulerTick: colour(chrome.borderStrong),
    rulerText: colour(chrome.textPrimary),
    // Written on the waveform display, which is dark in both themes, so taken
    // from its palette rather than from the chrome's.
    text: colour(waveform.label),
    quietText: colour(waveform.labelSecondary),
    selectionFill: colour(selection.fill),
    // A kept selection that is not the one a command acts on is drawn fainter,
    // so the active scope is the one that stands out (REQ-EDIT-063).
    inactiveSelectionFill: colour(selection.fill, fill.alpha / 2),
    selectionBorder: colour(selection.border),
    playhead: colour(waveform.playhead),
    marker: colour(category(theme, 'amber')),
    selectedMarker: colour(selection.handle),
    region: colour(category(theme, 'teal'), 0.22),
    selectedRegion: colour(category(theme, 'teal'), 0.55),
    loop: colour(category(theme, 'violet')),
    snap: colour(selection.handle),
    spectrogramBackground: colour(spectrogram[0]),
    spectrogramRamps: spectrogramRamps(spectrogram),
    // Not the selection's colour, so where an edit applies is never taken
    // for what is selected (REQ-EDIT-064).
    spectralEdit: colour(category(theme, 'lime')),
  };
}

/** The editor's type in `theme`. */
export function editorTypeOf(theme: Theme): EditorType {
  const { text } = theme.metrics;
  return {
    label: `${String(text.small)}px ${FONT_FAMILY}`,
    small: `${String(text.tiny)}px ${FONT_FAMILY}`,
  };
}
