/**
 * A source whose peaks a view asks for: who it is, its shape, and how to
 * describe its audio to the worker.
 */

import type { PcmDescription } from '@audiogubbins/audio-engine';

/** A source whose peaks a view asks for. */
export interface PeakSubject {
  /** What the source is, stable across sessions: the cache is kept under it. */
  readonly identity: string;
  /** Which version of it, so a cache of an earlier one is never used. */
  readonly revision: string;
  readonly channels: number;
  readonly frames: number;
  readonly sampleRate: number;
  /**
   * Its audio, described when a job starts. Arrays of audio in memory are
   * transferred to the worker, so each call gives arrays the caller can lose.
   */
  readonly describe: () => PcmDescription;
}
