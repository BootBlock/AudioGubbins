/**
 * What a spectral edit changes in each frame (ADR-0081): the difference
 * between what its operation makes of a frame's spectrum and the spectrum,
 * weighted bin by bin.
 *
 * - `attenuate`: `w · (g − 1) · X`, `w` the mask's weight, `g` the gain.
 * - `isolate`: `(1 − w) · (g − 1) · X`, in every frame centred within the
 *   mask's support, so what the mask holds is left and the rest of its span
 *   reduced.
 * - `heal`: `w · (Y − X)`, `Y` the spectrum with its magnitude replaced by
 *   the heal's (`heal-borders.ts`) and its phase kept; a bin of no magnitude
 *   takes the heal's as a real value.
 * - `process`: `w · (W − X)`, `W` the spectrum of the chain's output.
 *
 * A frame's weights are the mask's at its centre and each bin's centre
 * frequency, `k · rate / N`, from the domain's one statement of them
 * (`MaskWeights`). A frame they leave at nothing, and one centred outside the
 * mask's support, changes nothing, and is not transformed at all.
 */

import {
  MaskWeights,
  maskSupport,
  type PlannedSpectralEdit,
  type SpectralBounds,
} from '@audiogubbins/domain';

import type { HealBorders, Spectrum } from './heal-borders.js';
import type { FrameGeometry } from './spectral-frames.js';

/** A spectrum written by a frame's change. */
export interface SpectrumOut {
  readonly real: Float64Array;
  readonly imaginary: Float64Array;
}

/** The change a spectral edit makes to each of a stream's frames. */
export class SpectralChange {
  readonly edit: PlannedSpectralEdit;
  readonly geometry: FrameGeometry;
  /** The first and last frames a weight may reach. */
  readonly first: number;
  readonly last: number;
  readonly #weights: MaskWeights;
  readonly #support: SpectralBounds;
  readonly #frequencies: Float64Array;
  readonly #row: Float64Array;
  readonly #scope: ReadonlySet<number> | undefined;

  constructor(edit: PlannedSpectralEdit, geometry: FrameGeometry, sampleRate: number) {
    this.edit = edit;
    this.geometry = geometry;
    this.#weights = new MaskWeights(edit.mask);
    this.#support = maskSupport(edit.mask);
    const { size, bins } = geometry;
    this.#frequencies = Float64Array.from({ length: bins }, (_, bin) => (bin * sampleRate) / size);
    this.#row = new Float64Array(bins);
    this.#scope = edit.channels === undefined ? undefined : new Set(edit.channels);
    this.first = Math.max(geometry.firstFrame, Math.ceil(this.#support.start / geometry.hop));
    this.last = Math.min(geometry.lastFrame, Math.floor(this.#support.end / geometry.hop));
  }

  /** Whether the edit acts on `channel`. */
  acts(channel: number): boolean {
    return this.#scope === undefined || this.#scope.has(channel);
  }

  /**
   * The weights of frame `k`, or `undefined` where it changes nothing: the
   * mask's, or for an isolation what the mask leaves of the frame. The row is
   * the change's own, overwritten by the next frame asked for.
   */
  weights(k: number): Float64Array | undefined {
    if (k < this.first || k > this.last) return undefined;
    const row = this.#row;
    this.#weights.row(this.geometry.centre(k), this.#frequencies, row);
    if (this.edit.operation.kind === 'isolate') {
      for (let bin = 0; bin < row.length; bin += 1) row[bin] = 1 - (row[bin] ?? 0);
    }
    for (const weight of row) if (weight > 0) return row;
    return undefined;
  }

  /**
   * Writes to `out` the change of channel `channel` of frame `k`, whose
   * weights are `weights` and whose spectrum is `x`: the chain's output's
   * spectrum `wet` for a `process` edit, the heal's borders `borders` for a
   * `heal`.
   */
  change(
    k: number,
    channel: number,
    weights: Float64Array,
    x: Spectrum,
    out: SpectrumOut,
    wet: Spectrum | undefined,
    borders: HealBorders | undefined,
  ): void {
    const { operation } = this.edit;
    const bins = weights.length;
    switch (operation.kind) {
      case 'attenuate':
      case 'isolate': {
        const less = operation.gain - 1;
        for (let bin = 0; bin < bins; bin += 1) {
          const factor = (weights[bin] ?? 0) * less;
          out.real[bin] = factor * (x.real[bin] ?? 0);
          out.imaginary[bin] = factor * (x.imaginary[bin] ?? 0);
        }
        return;
      }
      case 'process':
        for (let bin = 0; bin < bins; bin += 1) {
          const weight = weights[bin] ?? 0;
          out.real[bin] = weight * ((wet?.real[bin] ?? 0) - (x.real[bin] ?? 0));
          out.imaginary[bin] = weight * ((wet?.imaginary[bin] ?? 0) - (x.imaginary[bin] ?? 0));
        }
        return;
      case 'heal':
        for (let bin = 0; bin < bins; bin += 1) {
          const weight = weights[bin] ?? 0;
          const target = weight > 0 ? borders?.target(k, channel, bin) : undefined;
          if (target === undefined) {
            out.real[bin] = 0;
            out.imaginary[bin] = 0;
            continue;
          }
          const re = x.real[bin] ?? 0;
          const im = x.imaginary[bin] ?? 0;
          const magnitude = Math.sqrt(re * re + im * im);
          const healedRe = magnitude > 0 ? re * (target / magnitude) : target;
          const healedIm = magnitude > 0 ? im * (target / magnitude) : 0;
          out.real[bin] = weight * (healedRe - re);
          out.imaginary[bin] = weight * (healedIm - im);
        }
        return;
    }
  }
}
