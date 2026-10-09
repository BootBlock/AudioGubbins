/**
 * What playing with one profile is made of, as the playback control drives
 * it: the audio context's life and a session over it, made from the person's
 * gesture by the page's real collaborators and by a test's fakes alike.
 */

import type { DomainResult } from '@audiogubbins/domain';
import type { PlaybackSession } from '@audiogubbins/audio-runtime';

import type { ChosenProfile } from '../state/audio-settings-store.js';

/** The part of a playback session the control drives. */
export type PlaybackSessionPort = Pick<
  PlaybackSession,
  | 'status'
  | 'subscribe'
  | 'load'
  | 'play'
  | 'pause'
  | 'park'
  | 'stop'
  | 'seek'
  | 'position'
  | 'audiblePosition'
  | 'meters'
  | 'changeParameters'
  | 'dispose'
>;

/** What playing with one profile is made of: a context's life, and a session over it. */
export interface PlaybackParts {
  /**
   * Starts the context. Called from the person's gesture, before anything is
   * awaited, so a browser that starts audio only inside one starts it; the
   * session's own Play says why where it did not.
   */
  readonly startContext: () => void;
  /**
   * The rate the context runs at, which a programme's request is made at
   * (REQ-ARCH-085), or why the browser would not make the context.
   */
  readonly contextRate: () => DomainResult<number>;
  /** The session, once the DSP module it runs has been loaded and compiled. */
  readonly session: Promise<PlaybackSessionPort>;
  /** Closes the context, for good. */
  readonly close: () => Promise<void>;
}

/** Makes the parts for a profile, the context at `rate`, or the device's where it is `undefined`. */
export type OpenPlayback = (profile: ChosenProfile, rate: number | undefined) => PlaybackParts;
