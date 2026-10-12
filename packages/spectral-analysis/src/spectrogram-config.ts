/**
 * A spectrogram's settings (ADR-0080): the window's length, the window, and
 * the overlap of windows at the finest level.
 *
 * The window's length is a power of two from 256 to 32 768 samples, 2048 by
 * default; the window is the periodic Hann or the four-term Blackman–Harris,
 * Blackman–Harris by default, whose side lobes lie 92 dB down; and the
 * overlap is 1, 2, 4 or 8 columns per window at the finest level, 4 by
 * default. They are the view's, persisted with it, so they are checked here
 * wherever they arrive from.
 */

import { StftWindow } from '@audiogubbins/audio-engine';
import {
  FailureKind,
  Malformed,
  fail,
  failure,
  fieldsOf,
  succeed,
  type DomainResult,
  type MessageFields,
} from '@audiogubbins/domain';

/** Columns a window spans at the finest level. */
export type SpectrogramOverlap = 1 | 2 | 4 | 8;

/** A spectrogram's settings. */
export interface SpectrogramConfig {
  /** Samples a window holds: a power of two from 256 to 32 768. */
  readonly windowLength: number;
  readonly window: StftWindow;
  readonly overlap: SpectrogramOverlap;
}

const SHORTEST_WINDOW = 256;
const LONGEST_WINDOW = 32_768;

const OVERLAPS: ReadonlySet<number> = new Set<SpectrogramOverlap>([1, 2, 4, 8]);
const WINDOWS: ReadonlySet<string> = new Set(Object.values(StftWindow));

/** The settings a spectrogram is drawn with until the person changes them. */
export const DEFAULT_SPECTROGRAM_CONFIG: SpectrogramConfig = {
  windowLength: 2048,
  window: StftWindow.BlackmanHarris,
  overlap: 4,
};

function isOverlap(value: number): value is SpectrogramOverlap {
  return OVERLAPS.has(value);
}

function isWindow(value: string): value is StftWindow {
  return WINDOWS.has(value);
}

/** Whether `length` is a power of two a window may hold. */
function isWindowLength(length: number): boolean {
  return (
    Number.isInteger(length) &&
    length >= SHORTEST_WINDOW &&
    length <= LONGEST_WINDOW &&
    (length & (length - 1)) === 0
  );
}

function refused(reason: string): DomainResult<never> {
  return fail(failure('spectral.config-invalid', FailureKind.Rejected, reason));
}

/** The settings, or why a spectrogram cannot be drawn with them. */
export function spectrogramConfig(settings: {
  readonly windowLength: number;
  readonly window: string;
  readonly overlap: number;
}): DomainResult<SpectrogramConfig> {
  const { windowLength, window, overlap } = settings;
  if (!isWindowLength(windowLength)) {
    return refused('A spectrogram’s window is a power of two from 256 to 32 768 samples.');
  }
  if (!isWindow(window)) {
    return refused('A spectrogram’s window is the Hann or the Blackman–Harris window.');
  }
  if (!isOverlap(overlap)) {
    return refused('A spectrogram’s windows overlap by 1, 2, 4 or 8 columns.');
  }
  return succeed({ windowLength, window, overlap });
}

/** The samples between the starts of two windows at the finest level. */
export function hopOf(config: SpectrogramConfig): number {
  return config.windowLength / config.overlap;
}

/** The bins of a window, from 0 Hz to half the rate: a tile's rows. */
export function binsOf(config: SpectrogramConfig): number {
  return config.windowLength / 2 + 1;
}

/** The settings as one piece of text, the same for equal settings. */
export function configText(config: SpectrogramConfig): string {
  return `${config.window}/${String(config.windowLength)}/${String(config.overlap)}`;
}

/** Settings that crossed a thread, read field by field and checked. */
export function configAt(fields: MessageFields, field: string): SpectrogramConfig {
  const settings = fieldsOf(fields[field], field);
  // Named apart from their fields, whose names hold a browser global's: a test
  // of such a name's type reads as a probe of the browser.
  const { windowLength: samples, window: kind, overlap } = settings;
  const config =
    typeof samples === 'number' && typeof kind === 'string' && typeof overlap === 'number'
      ? spectrogramConfig({ windowLength: samples, window: kind, overlap })
      : undefined;
  if (config?.ok !== true) throw new Malformed(field, 'a spectrogram’s settings');
  return config.value;
}
