/**
 * Playing the test signal: the order of things between the person's Play and
 * the playback session, and nothing the session decides itself.
 *
 * Nothing is made before the first Play. A browser starts an audio context
 * only from a click or a key press, and AudioGubbins starts no audio of its
 * own accord, so the context is made and started inside the command the press
 * ran, before anything is awaited; the session, which needs the DSP module
 * compiled, follows it. A context keeps the profile's latency hint for its
 * life, so a change of profile closes it and makes another, going on from
 * where playback was if it was playing.
 */

import { succeed, type DomainResult, type SampleCount } from '@audiogubbins/domain';
import { TransportMode, type PcmSource } from '@audiogubbins/audio-engine';
import { PlaybackPhase, type PlaybackSession } from '@audiogubbins/audio-runtime';

import type { ChosenProfile } from '../state/audio-settings-store.js';
import type { AudioViewStore } from '../state/audio-view-store.js';
import { reasonsOf, type Reasons } from '../state/reasons.js';

/** The part of a playback session the control drives. */
export type PlaybackSessionPort = Pick<
  PlaybackSession,
  | 'status'
  | 'subscribe'
  | 'load'
  | 'play'
  | 'pause'
  | 'stop'
  | 'seek'
  | 'position'
  | 'audiblePosition'
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
  /** The rate the context runs at, which the test signal is made at (REQ-ARCH-085). */
  readonly contextRate: () => number;
  /** The session, once the DSP module it runs has been loaded and compiled. */
  readonly session: Promise<PlaybackSessionPort>;
  /** Closes the context, for good. */
  readonly close: () => Promise<void>;
}

/** Makes the parts for a profile. */
export type OpenPlayback = (profile: ChosenProfile) => PlaybackParts;

/** One profile's parts, and what was made with them. */
interface Opened {
  readonly profile: ChosenProfile;
  readonly parts: PlaybackParts;
  session: PlaybackSessionPort | undefined;
  stopListening: (() => void) | undefined;
  /** The tone the graph reads, made at the context's rate once the context exists. */
  source: PcmSource | undefined;
}

/** Why Pause or Stop finds nothing to act on; their availability says so first. */
const NOTHING_PLAYING: Reasons = ['Nothing is playing.'];

/** A failure that only means a later command came first, which the later one reports. */
const SUPERSEDED = 'playback.superseded';

function reasonsFor(outcome: DomainResult<void>): Reasons | undefined {
  return outcome.ok ? undefined : reasonsOf(outcome.failures);
}

/** Plays, pauses and stops the test signal. */
export class PlaybackControl {
  readonly #view: AudioViewStore;
  readonly #open: OpenPlayback;
  readonly #profile: () => ChosenProfile;
  readonly #announce: (text: string) => void;
  #opened: Opened | undefined;
  /** Where playback paused before a change of profile closed its context, for the next Play. */
  #resumeFrom: SampleCount | undefined;

  constructor(options: {
    readonly view: AudioViewStore;
    readonly open: OpenPlayback;
    /** The profile the person chose, which the first Play opens with. */
    readonly profile: () => ChosenProfile;
    readonly announce: (text: string) => void;
  }) {
    this.#view = options.view;
    this.#open = options.open;
    this.#profile = options.profile;
    this.#announce = options.announce;
  }

  /** Plays from where the transport is, making whatever is not made yet. */
  play(): void {
    const from = this.#resumeFrom;
    this.#resumeFrom = undefined;
    this.#start(this.#opened ?? this.#openFor(this.#profile()), from);
  }

  pause(): Reasons | undefined {
    const session = this.#opened?.session;
    return session === undefined ? NOTHING_PLAYING : reasonsFor(session.pause());
  }

  stop(): Reasons | undefined {
    const session = this.#opened?.session;
    return session === undefined ? NOTHING_PLAYING : reasonsFor(session.stop());
  }

  /** Plays with `profile` from now on, which needs a context of its own. */
  useProfile(profile: ChosenProfile): void {
    const current = this.#opened;
    if (current === undefined || current.profile === profile) return;
    const mode = current.session?.status.transport.mode;
    const playing =
      this.#view.get().starting ||
      mode === TransportMode.Playing ||
      mode === TransportMode.Suspended;
    const position = current.session?.position();
    const from = position?.ok === true ? position.value : undefined;
    this.#close(current);
    // Chosen from a gesture, as every command is, so a context made now
    // starts as the first one did. A Play still on its way goes on too, since
    // the one it was waiting for has been closed under it. Paused, the new
    // context waits for Play, which goes on from where the old one paused.
    if (playing) this.#start(this.#openFor(profile), from);
    else if (mode === TransportMode.Paused) this.#resumeFrom = from;
  }

  /** The timeline frame the listener hears, at the context's rate, or `undefined` with no session. */
  audiblePosition(): number | undefined {
    const heard = this.#opened?.session?.audiblePosition();
    return heard?.ok === true ? heard.value : undefined;
  }

  /** Lets go of the session and closes the context. */
  dispose(): void {
    if (this.#opened !== undefined) this.#close(this.#opened);
  }

  #openFor(profile: ChosenProfile): Opened {
    const opened: Opened = {
      profile,
      parts: this.#open(profile),
      session: undefined,
      stopListening: undefined,
      source: undefined,
    };
    this.#opened = opened;
    return opened;
  }

  #close(current: Opened): void {
    if (this.#opened === current) this.#opened = undefined;
    current.stopListening?.();
    // A session still on its way is disposed by the Play awaiting it, which
    // finds its parts closed.
    current.session?.dispose();
    current.source?.release();
    void current.parts.close();
    this.#view.showPlayback(undefined);
  }

  #start(current: Opened, from: SampleCount | undefined): void {
    current.parts.startContext();
    this.#view.playbackStarting();
    void this.#run(current, from);
  }

  async #run(current: Opened, from: SampleCount | undefined): Promise<void> {
    try {
      const session = await current.parts.session;
      if (!this.#adopt(current, session)) return;
      const ready = await this.#loaded(current, session);
      // Closed while it loaded, by a change of profile whose own Play reports.
      if (this.#opened !== current) return;
      const moved = !ready.ok || from === undefined ? ready : await session.seek(from);
      this.#settle(moved.ok ? await session.play() : moved);
    } catch (error) {
      // The engine's code or its DSP module could not be loaded: a chunk the
      // server no longer has, or bytes the browser would not compile.
      if (!(error instanceof Error)) throw error;
      if (this.#opened === current) this.#close(current);
      this.#refused([`The audio engine could not be started: ${error.message}`]);
    }
  }

  /** Takes the session into use, or disposes of it where its parts were closed meanwhile. */
  #adopt(current: Opened, session: PlaybackSessionPort): boolean {
    if (this.#opened !== current) {
      session.dispose();
      return false;
    }
    if (current.session === undefined) {
      current.session = session;
      current.stopListening = session.subscribe(this.#view.showPlayback);
      this.#view.showPlayback(session.status);
    }
    return true;
  }

  /** Loads the test signal, unless the session has it or will load it again itself. */
  async #loaded(current: Opened, session: PlaybackSessionPort): Promise<DomainResult<void>> {
    const { phase } = session.status;
    // Lost with its context, the graph is loaded again by the session's Play.
    if (
      phase === PlaybackPhase.Ready ||
      (phase === PlaybackPhase.Unloaded && current.source !== undefined)
    ) {
      return succeed(undefined);
    }
    const { testSignalPlayback } = await import('./test-signal-tone.js');
    const made = testSignalPlayback(current.parts.contextRate());
    if (!made.ok) return made;
    // A refused or faulted graph is loaded again with a new tone, and the old
    // one released once the session has let go of it.
    const previous = current.source;
    current.source = made.value.source;
    const loaded = await session.load(made.value.request);
    previous?.release();
    return loaded;
  }

  /** Says how the Play ended. */
  #settle(result: DomainResult<void>): void {
    if (result.ok) {
      this.#view.playbackSettled([]);
      this.#announce('The test signal is playing.');
    } else if (result.failures.every((one) => one.code === SUPERSEDED)) {
      // Overtaken by a later command, which says what it did.
      this.#view.playbackSettled([]);
    } else {
      this.#refused(reasonsOf(result.failures));
    }
  }

  #refused(reasons: Reasons): void {
    this.#view.playbackSettled(reasons);
    this.#announce(reasons.join(' '));
  }
}
