/**
 * What playing with one profile is made of, as the playback control drives
 * it: a hold on the page's audio context and a session over it, made from the
 * person's gesture by the page's real collaborators and by a test's fakes
 * alike.
 */

import type { DomainResult, QualityMode } from '@audiogubbins/domain';
import type { PlaybackSession } from '@audiogubbins/audio-runtime';

import type { ChosenProfile } from '../state/audio-settings-store.js';
import type { Programme } from './programme.js';

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
  | 'continueWith'
  | 'readFrame'
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
  /**
   * Lets go of the context, which closes once an open input does not hold it
   * too (`context-host.ts`).
   */
  readonly close: () => Promise<void>;
}

/** One profile's parts at one rate, and what was made with them. */
export interface Opened {
  readonly profile: ChosenProfile;
  readonly rate: number | undefined;
  readonly parts: PlaybackParts;
  session: PlaybackSessionPort | undefined;
  stopListening: (() => void) | undefined;
  /**
   * The programme given to the session, which it keeps through a lost
   * context, and which a change of profile goes on playing.
   */
  loaded: Programme | undefined;
  /** The preview quality `loaded` was loaded at. */
  quality: QualityMode | undefined;
  /**
   * Whether the session holds an older sound of `loaded` than `loaded` is,
   * one a change it could not take running left behind, which the next Play
   * loads.
   */
  stale: boolean;
}

/** Makes the parts for a profile, the context at `rate`, or the device's where it is `undefined`. */
export type OpenPlayback = (profile: ChosenProfile, rate: number | undefined) => PlaybackParts;
