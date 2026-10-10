/**
 * A spectrogram lane's frequency axis: where in a lane a frequency is drawn,
 * and which frequency a height in the lane shows (ADR-0082).
 *
 * The two are one mapping and its exact inverse, so a shape drawn with a tool,
 * the selection drawn over the spectrogram and the spectrogram's own rows
 * agree at every zoom, size and scale. The lowest frequency is at the lane's
 * bottom edge and the highest at its top, spaced evenly in hertz on a linear
 * scale and in octaves on a logarithmic one. Each is a pure function of the
 * lane and the view's spectral settings, so the same pointer over the same
 * view names the same frequency every time, however often the view or its
 * renderer is made again.
 */

import type { Lane } from './lane-layout.js';
import type { SpectralSettings } from './view-state.js';

/** How far up the axis `frequency` lies, from 0 at the lowest to 1 at the highest, unbounded. */
function shareOf(frequency: number, settings: SpectralSettings): number {
  return settings.frequencyScale === 'linear'
    ? (frequency - settings.lowest) / (settings.highest - settings.lowest)
    : Math.log(frequency / settings.lowest) / Math.log(settings.highest / settings.lowest);
}

/** The frequency `share` of the way up the axis, unbounded: the inverse of `shareOf`. */
function frequencyOfShare(share: number, settings: SpectralSettings): number {
  return settings.frequencyScale === 'linear'
    ? settings.lowest + share * (settings.highest - settings.lowest)
    : settings.lowest * Math.exp(share * Math.log(settings.highest / settings.lowest));
}

function clamped(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The height in `lane` at which `frequency` is drawn, in CSS pixels: a
 * frequency outside the axis is drawn at the edge it lies beyond.
 */
export function frequencyY(lane: Lane, frequency: number, settings: SpectralSettings): number {
  const share = clamped(shareOf(frequency, settings), 0, 1);
  return lane.area.y + lane.area.height * (1 - share);
}

/**
 * The frequency the axis shows at height `y` in `lane`, as though the axis
 * ran on past the lane's edges: what a brush's reach above and below its
 * centre is measured by, where its circle crosses an edge.
 */
export function frequencyOnAxis(lane: Lane, y: number, settings: SpectralSettings): number {
  return frequencyOfShare(1 - (y - lane.area.y) / lane.area.height, settings);
}

/**
 * The frequency at height `y` in `lane`: the inverse of `frequencyY`, a
 * height above or below the lane taken to the edge it lies beyond, so a drag
 * that leaves the lane names the highest or the lowest frequency shown.
 */
export function frequencyAt(lane: Lane, y: number, settings: SpectralSettings): number {
  return clamped(frequencyOnAxis(lane, y, settings), settings.lowest, settings.highest);
}
