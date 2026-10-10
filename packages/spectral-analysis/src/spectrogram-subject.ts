/**
 * A sound whose spectrogram a view asks for: who it is, which revision of its
 * edited sound, its shape, and how to describe its audio to the worker.
 */

import type { PcmDescription } from '@audiogubbins/audio-engine';
import type { QualityMode } from '@audiogubbins/domain';

/** A sound whose spectrogram a view asks for. */
export interface SpectrogramSubject {
  /** What the source is, stable across sessions: tiles are kept under it. */
  readonly identity: string;
  /**
   * Which edited sound of it: every edit, a spectral edit's included, and
   * every change of quality changes it, so a tile of another is drawn stale.
   */
  readonly revision: string;
  readonly channels: number;
  readonly frames: number;
  /**
   * Its audio, described when its job opens: the asset's edit plan, which the
   * worker reads through the engine's plan readers, a racked sound through
   * the preview worker's renders. Arrays of audio in memory are transferred
   * to the worker, so each call gives arrays the caller can lose.
   */
  readonly describe: () => PcmDescription;
  /** The quality an edited sound's chains run at: the final render's. */
  readonly quality: QualityMode;
}
