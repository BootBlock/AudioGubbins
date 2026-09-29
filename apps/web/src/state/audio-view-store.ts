/**
 * What the audio engine is doing, as the Transport panel and the audio
 * commands read it.
 *
 * REQ-ARCH-153 gives audio state its own partition, apart from the interface's
 * and the preferences', so this holds only the engine's view: the playback
 * session's last status, the performance profile chosen, whether a Play is on
 * its way, and the latest offline render. It owns no audio: the session and
 * the render host are the audio part's, which report here.
 *
 * The profile lasts for the session. The preferences store is the theme's
 * preferences, versioned by the theme's schema, and a profile written into it
 * would change a stored format another package owns; it is kept here until a
 * stored audio settings format exists to hold it.
 */

import {
  PerformanceProfile,
  type DspImplementation,
  type PresetProfile,
} from '@audiogubbins/audio-engine';
import type { PlaybackStatus } from '@audiogubbins/audio-runtime';

import { observable, type Observable } from './observable.js';
import type { Reasons } from './reasons.js';

/** Where the latest offline render has reached. */
export const RenderStage = {
  /** No render has been asked for. */
  Idle: 'idle',
  Running: 'running',
  Finished: 'finished',
  Failed: 'failed',
} as const;

/** Where the latest offline render has reached. */
export type RenderStage = (typeof RenderStage)[keyof typeof RenderStage];

/** What a finished render produced. */
export interface RenderResult {
  /** Frames written to the output, at {@link RenderResult.sampleRate}. */
  readonly frames: number;
  readonly sampleRate: number;
  /** From the request to the last chunk written, queueing and the worker's start included. */
  readonly milliseconds: number;
  readonly dsp: DspImplementation;
  /** Why the reference path ran, when it did. */
  readonly fallbackReason: string | undefined;
  /** FNV-1a-64 of the output's samples in frame order, channels interleaved. */
  readonly fingerprint: bigint;
}

/** The latest offline render. */
export type RenderView =
  | { readonly stage: typeof RenderStage.Idle }
  | {
      readonly stage: typeof RenderStage.Running;
      readonly framesRendered: number;
      readonly framesTotal: number;
    }
  | { readonly stage: typeof RenderStage.Finished; readonly result: RenderResult }
  | { readonly stage: typeof RenderStage.Failed; readonly reasons: Reasons };

/** What the audio engine is doing. */
export interface AudioView {
  readonly profile: PresetProfile;

  /**
   * Playback as the session last reported it, or `undefined` while there is
   * no session: before the first Play, and after a change of profile, which
   * needs a context of its own.
   */
  readonly playback: PlaybackStatus | undefined;

  /** Whether a Play is on its way: the engine being prepared, the graph loaded, the context started. */
  readonly starting: boolean;

  /** Why the last Play did not start, where the session's status does not say. */
  readonly problems: readonly string[];

  readonly render: RenderView;
}

/** The engine's view, and how the audio part reports to it. */
export interface AudioViewStore extends Observable<AudioView> {
  readonly chooseProfile: (profile: PresetProfile) => void;
  readonly showPlayback: (status: PlaybackStatus | undefined) => void;
  /** A Play has been asked for, which clears what the last one reported. */
  readonly playbackStarting: () => void;
  /** The Play asked for has started, or has not for `problems`. */
  readonly playbackSettled: (problems: readonly string[]) => void;
  readonly renderProgressed: (framesRendered: number, framesTotal: number) => void;
  readonly renderFinished: (result: RenderResult) => void;
  readonly renderFailed: (reasons: Reasons) => void;
}

const NOTHING_RENDERED: RenderView = { stage: RenderStage.Idle };

/** Creates the engine's view, with nothing played and nothing rendered. */
export function createAudioViewStore(): AudioViewStore {
  const state = observable<AudioView>({
    profile: PerformanceProfile.Balanced,
    playback: undefined,
    starting: false,
    problems: [],
    render: NOTHING_RENDERED,
  });

  return {
    get: state.get,
    subscribe: state.subscribe,

    chooseProfile: (profile) => {
      state.update((view) => (view.profile === profile ? view : { ...view, profile }));
    },

    showPlayback: (playback) => {
      state.update((view) => ({ ...view, playback }));
    },

    playbackStarting: () => {
      state.update((view) => ({ ...view, starting: true, problems: [] }));
    },

    playbackSettled: (problems) => {
      state.update((view) => ({ ...view, starting: false, problems }));
    },

    renderProgressed: (framesRendered, framesTotal) => {
      state.update((view) => ({
        ...view,
        render: { stage: RenderStage.Running, framesRendered, framesTotal },
      }));
    },

    renderFinished: (result) => {
      state.update((view) => ({ ...view, render: { stage: RenderStage.Finished, result } }));
    },

    renderFailed: (reasons) => {
      state.update((view) => ({ ...view, render: { stage: RenderStage.Failed, reasons } }));
    },
  };
}
