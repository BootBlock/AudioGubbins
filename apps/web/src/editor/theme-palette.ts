/**
 * The colours and type an editor view draws with, taken from the theme
 * (REQ-UX-155, ADR-0012): the waveform, selection and analysis palettes, the
 * spectrogram's ramps, the text written on the display, and the chrome's ruler,
 * as the sRGB channels the renderer takes. A view has no colour of its own, so
 * a change of theme, brightness or contrast reaches the next frame it draws.
 *
 * The roles follow the design language's presentation of audio (section 8):
 * the ruler and the strip are drawn on the display itself, in its own label
 * colours, so the light theme's paper-white display has a light ruler too. A
 * colour the theme cannot give draws with the theme's accent, and says so in
 * the log, rather than with a colour written here.
 */

import {
  ContrastLevel,
  ContrastRequirement,
  contrastRatio,
  oklchToSrgb,
  srgbToOklch,
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
import type { Logger } from '@audiogubbins/diagnostics';
import type { Colour } from '@audiogubbins/renderer';

function colour(value: Oklch, alpha?: number): Colour {
  const { red, green, blue, alpha: own } = oklchToSrgb(value);
  return [red, green, blue, alpha ?? own];
}

/** How translucent a region's span and its boundaries are drawn (design language, section 8). */
const REGION_SPAN_ALPHA = 0.3;
const SELECTED_REGION_SPAN_ALPHA = 0.55;
const REGION_BOUNDARY_ALPHA = 0.55;

/** The step a span's strength is lowered by until its name reads on it. */
const SPAN_ALPHA_STEP = 0.01;

/** `over` laid on `under` at `alpha`, as the renderer blends: channel by channel in sRGB. */
function blended(under: Oklch, over: Oklch, alpha: number): Oklch {
  const bottom = oklchToSrgb(under);
  const top = oklchToSrgb(over);
  const mix = (from: number, to: number): number => from + (to - from) * alpha;
  return srgbToOklch({
    red: mix(bottom.red, top.red),
    green: mix(bottom.green, top.green),
    blue: mix(bottom.blue, top.blue),
    alpha: 1,
  });
}

/**
 * The strongest a region's span may be drawn, up to `ceiling`, with its name
 * still reading on it at the theme's contrast (ADR-0012): the span is a tint of
 * a category colour over the display, and at high contrast, or with a light
 * category on a light display, the language's strength would sink the name.
 */
function spanAlpha(theme: Theme, region: Oklch, ceiling: number): number {
  const { background, label } = theme.palette.waveform;
  const required =
    theme.contrast === ContrastLevel.High
      ? ContrastRequirement.Enhanced
      : ContrastRequirement.BodyText;
  let alpha = ceiling;
  while (alpha > 0 && contrastRatio(label, blended(background, region, alpha)) < required) {
    alpha -= SPAN_ALPHA_STEP;
  }
  return Math.max(0, alpha);
}

/**
 * A category colour by name, or, where the theme has none of that name, the
 * accent, with a record of the token that could not be resolved.
 */
function category(theme: Theme, name: string, logger: Logger): Oklch {
  const found = theme.palette.category[name];
  if (found !== undefined) return found;
  logger.warning('The editor drew a colour the theme does not have with its accent instead.', {
    missing: `--ag-category-${name}`,
    reason: 'Drawn with --ag-chrome-accent, the theme default.',
  });
  return theme.palette.chrome.accent;
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

/** The editor's colours in `theme`, any it cannot resolve recorded in `logger`. */
export function editorPaletteOf(theme: Theme, logger: Logger): EditorPalette {
  const { waveform, selection, chrome, spectrogram, marker } = theme.palette;
  const fill = oklchToSrgb(selection.fill);
  const region = category(theme, 'teal', logger);
  return {
    background: colour(waveform.background),
    laneSeparator: colour(chrome.borderSubtle),
    centreLine: colour(waveform.centreLine),
    peak: colour(waveform.peak),
    rms: colour(waveform.rms),
    clipped: colour(waveform.clipped),
    pending: colour(waveform.pending),
    grid: colour(waveform.grid),
    // The ruler is part of the display, so its ticks and labels are the
    // display's own, solved against its background in either theme.
    rulerBackground: colour(waveform.background),
    rulerTick: colour(waveform.labelSecondary),
    rulerMinorTick: colour(waveform.grid),
    rulerText: colour(waveform.labelSecondary),
    // Written on the display, so taken from its palette rather than the chrome's.
    text: colour(waveform.label),
    quietText: colour(waveform.labelSecondary),
    selectionFill: colour(selection.fill),
    // A kept selection that is not the one a command acts on is drawn fainter,
    // so the active scope is the one that stands out (REQ-EDIT-063).
    inactiveSelectionFill: colour(selection.fill, fill.alpha / 2),
    selectionBorder: colour(selection.border),
    playhead: colour(waveform.playhead),
    marker: colour(marker.default),
    selectedMarker: colour(selection.handle),
    region: colour(region, spanAlpha(theme, region, REGION_SPAN_ALPHA)),
    selectedRegion: colour(region, spanAlpha(theme, region, SELECTED_REGION_SPAN_ALPHA)),
    regionEdge: colour(region),
    regionBoundary: colour(region, REGION_BOUNDARY_ALPHA),
    loop: colour(category(theme, 'violet', logger)),
    snap: colour(selection.handle),
    spectrogramBackground: colour(spectrogram[0]),
    spectrogramRamps: spectrogramRamps(spectrogram),
    // Not the selection's colour, so where an edit applies is never taken
    // for what is selected (REQ-EDIT-064).
    spectralEdit: colour(category(theme, 'lime', logger)),
  };
}

/** The editor's type in `theme`. */
export function editorTypeOf(theme: Theme): EditorType {
  // The interface's own face, so the editor's labels read as the rest of the
  // page does.
  const { text } = theme.metrics;
  const { family, weight } = theme.typeface;
  return {
    label: `${String(text.label)}px ${family.ui}`,
    small: `${String(text.caption)}px ${family.ui}`,
    ruler: `${String(weight.medium)} ${String(text.ruler)}px ${family.numeric}`,
  };
}
