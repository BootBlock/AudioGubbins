/**
 * How each editor view's presentation is written to storage and read back
 * (schema `editorViews`), so a view reopens at the zoom, scroll, display mode,
 * tool, channels, overlays, snapping, time format, frequency axis and
 * spectrogram it was left at (REQ-EDIT-061, ADR-0082).
 *
 * Read field by field, as every stored format here is: a stored view that has
 * lost or gained a field costs that field and not the view, and a value
 * another version or a hand edit put there is checked by the rule it must
 * meet before it is used. The width is not kept, since it is the panel's, and
 * measured again when the view is drawn.
 */

import { ZERO_SAMPLES, sampleCount } from '@audiogubbins/domain';
import {
  DisplayMode,
  FollowMode,
  SpectrogramColours,
  ToolId,
  AMPLITUDES,
  DEFAULT_OVERLAYS,
  isDisplayRange,
  newViewState,
  type EditorViewState,
  type DisplayRange,
  type Overlays,
  type SpectralSettings,
  type SpectrogramDisplay,
} from '@audiogubbins/editor-view';
import { spectrogramConfig, type SpectrogramConfig } from '@audiogubbins/spectral-analysis';
import {
  DEFAULT_SNAP_SETTINGS,
  SnapKind,
  TimeFormatKind,
  frameRate,
  pixelsPerSample,
  samplesPerPixel,
  type SnapSettings,
  type TimeFormat,
  type Zoom,
} from '@audiogubbins/timeline';

import { isMemberOf, isRecord } from './stored-value.js';

/** A view as it is stored: its asset and its presentation, without a width. */
export interface StoredView {
  readonly asset: string;
  readonly state: EditorViewState;
}

type Fields = Readonly<Record<string, unknown>>;

/** The defaults a field that cannot be read falls back to, the width left to measurement. */
const DEFAULTS = newViewState(ZERO_SAMPLES, 0);

function zoomOf(value: unknown): Zoom {
  if (!isRecord(value)) return DEFAULTS.viewport.zoom;
  if (value['kind'] === 'samples-per-pixel' && typeof value['samples'] === 'number') {
    return samplesPerPixel(value['samples']);
  }
  if (value['kind'] === 'pixels-per-sample' && typeof value['pixels'] === 'number') {
    return pixelsPerSample(value['pixels']);
  }
  return DEFAULTS.viewport.zoom;
}

function viewportOf(value: unknown): EditorViewState['viewport'] {
  if (!isRecord(value)) return DEFAULTS.viewport;
  const zoom = zoomOf(value['zoom']);
  const start = typeof value['start'] === 'number' ? sampleCount(value['start']) : undefined;
  const offset = value['offset'];
  const pixels = zoom.kind === 'pixels-per-sample' ? zoom.pixels : 1;
  return {
    start: start?.ok === true ? start.value : DEFAULTS.viewport.start,
    offset:
      typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 && offset < pixels
        ? offset
        : 0,
    zoom,
    width: 0,
  };
}

function flag(fields: Fields, name: keyof Overlays): boolean {
  const value = fields[name];
  return typeof value === 'boolean' ? value : DEFAULT_OVERLAYS[name];
}

function overlaysOf(value: unknown): Overlays {
  if (!isRecord(value)) return DEFAULT_OVERLAYS;
  return {
    grid: flag(value, 'grid'),
    rms: flag(value, 'rms'),
    clipping: flag(value, 'clipping'),
    markers: flag(value, 'markers'),
    regions: flag(value, 'regions'),
    filmstrip: flag(value, 'filmstrip'),
    spectralEdits: flag(value, 'spectralEdits'),
  };
}

function snappingOf(value: unknown): SnapSettings {
  if (!isRecord(value)) return DEFAULT_SNAP_SETTINGS;
  const kinds = value['kinds'];
  const tolerance = value['tolerance'];
  return {
    enabled:
      typeof value['enabled'] === 'boolean' ? value['enabled'] : DEFAULT_SNAP_SETTINGS.enabled,
    kinds: Array.isArray(kinds)
      ? new Set(kinds.filter((kind) => isMemberOf(SnapKind, kind)))
      : DEFAULT_SNAP_SETTINGS.kinds,
    tolerance:
      typeof tolerance === 'number' && tolerance >= 1 && tolerance <= 64
        ? tolerance
        : DEFAULT_SNAP_SETTINGS.tolerance,
  };
}

function timeFormatOf(value: unknown): TimeFormat {
  if (!isRecord(value) || !isMemberOf(TimeFormatKind, value['kind'])) return DEFAULTS.timeFormat;
  const kind = value['kind'];
  if (kind !== TimeFormatKind.Timecode) return { kind };
  const frames = value['frames'];
  if (!isRecord(frames)) return DEFAULTS.timeFormat;
  const { numerator, denominator, dropFrame } = frames;
  const read =
    typeof numerator === 'number' &&
    typeof denominator === 'number' &&
    typeof dropFrame === 'boolean'
      ? frameRate(numerator, denominator, dropFrame)
      : undefined;
  return read?.ok === true ? { kind, frames: read.value } : DEFAULTS.timeFormat;
}

function spectralOf(value: unknown): SpectralSettings {
  if (!isRecord(value)) return DEFAULTS.spectral;
  const { frequencyScale, lowest, highest } = value;
  // A linear axis may start at nothing, as the band that shows every
  // frequency does; an axis of octaves cannot.
  const usable =
    (frequencyScale === 'linear' || frequencyScale === 'logarithmic') &&
    typeof lowest === 'number' &&
    typeof highest === 'number' &&
    (frequencyScale === 'linear' ? lowest >= 0 : lowest > 0) &&
    highest > lowest &&
    highest <= 384_000;
  return usable ? { frequencyScale, lowest, highest } : DEFAULTS.spectral;
}

/** A spectrogram's analysis settings, checked as the spectral-analysis package checks them. */
function analysisOf(value: unknown): SpectrogramConfig {
  const fallback = DEFAULTS.spectrogram.analysis;
  if (!isRecord(value)) return fallback;
  // Named apart from their fields, whose names hold a browser global's.
  const { windowLength: samples, window: kind, overlap } = value;
  if (typeof samples !== 'number' || typeof kind !== 'string' || typeof overlap !== 'number') {
    return fallback;
  }
  const config = spectrogramConfig({ windowLength: samples, window: kind, overlap });
  return config.ok ? config.value : fallback;
}

function rangeOf(value: unknown): DisplayRange {
  if (!isRecord(value)) return DEFAULTS.spectrogram.range;
  const { floor, ceiling } = value;
  const range =
    typeof floor === 'number' && typeof ceiling === 'number' ? { floor, ceiling } : undefined;
  return range !== undefined && isDisplayRange(range) ? range : DEFAULTS.spectrogram.range;
}

/** A spectrogram's settings, each part taken only where it is one a spectrogram is drawn with. */
function spectrogramOf(value: unknown): SpectrogramDisplay {
  if (!isRecord(value)) return DEFAULTS.spectrogram;
  const { colours } = value;
  return {
    analysis: analysisOf(value['analysis']),
    range: rangeOf(value['range']),
    colours: isMemberOf(SpectrogramColours, colours) ? colours : DEFAULTS.spectrogram.colours,
  };
}

function hiddenOf(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return [];
  const indices = value.filter(
    (index): index is number => Number.isInteger(index) && index >= 0 && index < 256,
  );
  return [...new Set(indices)].sort((a, b) => a - b);
}

/** A stored view, each field taken only where it is usable, or `undefined` without an asset. */
export function readStoredView(value: unknown): StoredView | undefined {
  if (!isRecord(value) || typeof value['asset'] !== 'string' || value['asset'] === '') {
    return undefined;
  }
  const amplitude = value['amplitude'];
  return {
    asset: value['asset'],
    state: {
      viewport: viewportOf(value['viewport']),
      displayMode: isMemberOf(DisplayMode, value['displayMode'])
        ? value['displayMode']
        : DEFAULTS.displayMode,
      tool: isMemberOf(ToolId, value['tool']) ? value['tool'] : DEFAULTS.tool,
      hiddenChannels: hiddenOf(value['hiddenChannels']),
      amplitude:
        typeof amplitude === 'number' && AMPLITUDES.includes(amplitude)
          ? amplitude
          : DEFAULTS.amplitude,
      overlays: overlaysOf(value['overlays']),
      snapping: snappingOf(value['snapping']),
      timeFormat: timeFormatOf(value['timeFormat']),
      follow: isMemberOf(FollowMode, value['follow']) ? value['follow'] : DEFAULTS.follow,
      spectral: spectralOf(value['spectral']),
      spectrogram: spectrogramOf(value['spectrogram']),
    },
  };
}

/** A view as it is written: every field but the width. */
export function storedViewOf(view: StoredView): Fields {
  const { viewport, snapping, ...rest } = view.state;
  return {
    asset: view.asset,
    ...rest,
    viewport: { start: viewport.start, offset: viewport.offset, zoom: viewport.zoom },
    snapping: {
      enabled: snapping.enabled,
      kinds: [...snapping.kinds].sort(),
      tolerance: snapping.tolerance,
    },
  };
}
