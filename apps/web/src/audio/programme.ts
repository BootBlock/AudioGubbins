/**
 * What the transport plays: an asset, or the test signal. One transport plays
 * one programme at a time; a programme says what it is, the rate its audio is
 * at, how to ask the session for it and what is said once it is heard.
 *
 * An asset plays at its native rate (REQ-ARCH-085): the audio context is made
 * at that rate, and the browser converts the context's output for the device,
 * so nothing in AudioGubbins resamples the asset to play it. The test signal
 * is made at whatever rate the context runs at.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { PlaybackRequest } from '@audiogubbins/audio-runtime';

/** What the transport plays. */
export interface Programme {
  /** An asset's identity, or the test signal's. */
  readonly key: string;
  /** The rate its audio is at, which the context is made at; `undefined` to take the device's. */
  readonly rate: number | undefined;
  /** The request that plays it, in a context of `contextRate`. */
  readonly request: (contextRate: number) => DomainResult<PlaybackRequest>;
  /** What is said once it is heard. */
  readonly playing: string;
}
