/**
 * Playing a programme, an asset or the test signal: the order of things
 * between the person's Play and the playback session, and nothing the session
 * decides itself.
 *
 * Nothing is made before the first Play. A browser starts an audio context
 * only from a click or a key press, and AudioGubbins starts no audio of its
 * own accord, so the context is made and started inside the command the press
 * ran, before anything is awaited; the session, which needs the DSP module
 * compiled, follows it. A context keeps its latency hint and its rate for its
 * life, so a change of profile, or a programme at another rate, closes it and
 * makes another, going on from where playback was if it was playing. A change
 * of preview quality keeps the context and loads the programme again at it.
 *
 * A programme whose sound the project changed while it plays is followed
 * (REQ-AUDIO-019): numeric parameters changed by a command reach the running
 * chains, smoothed, without playback starting again; a change a running chain
 * cannot take, a chain heard from a cached render among them, loads the
 * programme again where it plays, which makes the render again, and says so.
 */

import {
  flatMapResult,
  succeed,
  type DomainResult,
  type QualityMode,
  type SampleCount,
} from '@audiogubbins/domain';
import type { Logger } from '@audiogubbins/diagnostics';
import type { NodeId } from '@audiogubbins/audio-graph';
import { TransportMode } from '@audiogubbins/audio-engine';
import { PLAYBACK_SUPERSEDED, PlaybackPhase, type MeterLevels } from '@audiogubbins/audio-runtime';

import type { ChosenProfile } from '../state/audio-settings-store.js';
import type { AudioViewStore } from '../state/audio-view-store.js';
import { reasonsOf, type Reasons } from '../state/reasons.js';
import type { OpenPlayback, PlaybackParts, PlaybackSessionPort } from './playback-parts.js';
import { followingOf, type Programme } from './programme.js';

/** One profile's parts at one rate, and what was made with them. */
interface Opened {
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

/** Why Pause or Stop finds nothing to act on; their availability says so first. */
const NOTHING_PLAYING: Reasons = ['Nothing is playing.'];

const NO_METERS: ReadonlyMap<NodeId, MeterLevels> = new Map();

function reasonsFor(outcome: DomainResult<void>): Reasons | undefined {
  return outcome.ok ? undefined : reasonsOf(outcome.failures);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Plays, pauses, stops and moves a programme. */
export class PlaybackControl {
  readonly #view: AudioViewStore;
  readonly #open: OpenPlayback;
  readonly #profile: () => ChosenProfile;
  readonly #quality: () => QualityMode;
  readonly #announce: (text: string) => void;
  readonly #logger: Logger;
  #opened: Opened | undefined;
  /**
   * Where playback paused before a change of profile closed its context, and
   * what it was playing, for the next Play of that programme.
   */
  #resumeFrom: { readonly key: string; readonly at: SampleCount } | undefined;

  constructor(options: {
    readonly view: AudioViewStore;
    readonly open: OpenPlayback;
    /** The profile the person chose, which the first Play opens with. */
    readonly profile: () => ChosenProfile;
    /**
     * The quality playback previews at, the same object until it changes:
     * read at each load, and compared by identity to learn whether it did.
     */
    readonly quality: () => QualityMode;
    readonly announce: (text: string) => void;
    readonly logger: Logger;
  }) {
    this.#view = options.view;
    this.#open = options.open;
    this.#profile = options.profile;
    this.#quality = options.quality;
    this.#announce = options.announce;
    this.#logger = options.logger;
  }

  /**
   * Plays `programme` from `from`, or from where the transport is where it
   * holds the programme already, making whatever is not made yet.
   */
  play(programme: Programme, from?: SampleCount): void {
    const resume = this.#resumeFrom?.key === programme.key ? this.#resumeFrom.at : undefined;
    this.#resumeFrom = undefined;
    let current = this.#opened;
    // A context keeps its rate for life, so a programme at another rate needs
    // a context of its own.
    if (current !== undefined && programme.rate !== undefined && current.rate !== programme.rate) {
      this.#close(current);
      current = undefined;
    }
    this.#start(
      current ?? this.#openFor(this.#profile(), programme.rate),
      programme,
      from ?? resume,
    );
  }

  /**
   * Holds `programme` ready at `from` without playing it, making whatever is
   * not made yet: the context is made at its rate now, so an input that joins
   * it, as a punch's does, records on the clock the programme then plays on.
   */
  cue(programme: Programme, from: SampleCount): void {
    this.#resumeFrom = undefined;
    let current = this.#opened;
    if (current !== undefined && programme.rate !== undefined && current.rate !== programme.rate) {
      this.#close(current);
      current = undefined;
    }
    this.#start(current ?? this.#openFor(this.#profile(), programme.rate), programme, from, false);
  }

  /**
   * The transport frame that context frame `at`, of a context at
   * `contextRate`, plays: before the transport's start, and so below zero,
   * where `at` is before the frame playback started on. Where the transport
   * is not playing, the frame it stands at; `undefined` where it holds no
   * programme.
   */
  transportAt(at: number, contextRate: number): number | undefined {
    const current = this.#opened;
    const session = current?.session;
    const loaded = current?.loaded;
    if (session === undefined || loaded === undefined) return undefined;
    const { transport } = session.status;
    if (transport.mode !== TransportMode.Playing) return transport.position;
    const timelineRate = loaded.rate ?? contextRate;
    return (
      transport.anchor.timelineFrame +
      Math.floor(((at - transport.anchor.contextFrame) * timelineRate) / contextRate)
    );
  }

  /**
   * Moves the transport to `to` where it holds programme `key`, answering
   * whether it did; playback that was running goes on from there.
   */
  seek(key: string, to: SampleCount): boolean {
    const current = this.#opened;
    const session = current?.session;
    if (current === undefined || session === undefined || current.loaded?.key !== key) return false;
    // A programme loaded again while stopped goes on at the next Play from
    // where it stood then; a move made since is where it goes on from.
    if (this.#resumeFrom?.key === key) this.#resumeFrom = { key, at: to };
    this.#moveTo(current, session, to);
    return true;
  }

  #moveTo(current: Opened, session: PlaybackSessionPort, to: SampleCount): void {
    void session.seek(to).then((moved) => {
      if (!moved.ok && this.#opened === current) this.#refused(reasonsOf(moved.failures));
    }, this.#recorded('The transport could not be moved.'));
  }

  /** The key of the programme the transport holds, or `undefined` where it holds none. */
  programme(): string | undefined {
    const current = this.#opened;
    return current?.session === undefined ? undefined : current.loaded?.key;
  }

  /**
   * Pauses where the listener stopped hearing. The processor counts ahead of
   * the device by its output latency, so the transport is moved back to the
   * frame heard: the playhead, a marker placed at it and a picture parked on it
   * are what was heard, and Play goes on from there. Stop still returns to
   * where the play started, since the move is no seek of the person's.
   */
  pause(): Reasons | undefined {
    const current = this.#opened;
    const session = current?.session;
    if (current === undefined || session === undefined) return NOTHING_PLAYING;
    const playing = session.status.transport.mode === TransportMode.Playing;
    const heard = playing ? session.audiblePosition() : undefined;
    const refused = reasonsFor(session.pause());
    const position = session.position();
    if (
      refused === undefined &&
      heard?.ok === true &&
      position.ok &&
      heard.value < position.value
    ) {
      return reasonsFor(session.park(heard.value));
    }
    return refused;
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
    const programme = current.loaded;
    this.#close(current);
    // Chosen from a gesture, as every command is, so a context made now
    // starts as the first one did. A Play still on its way goes on too, since
    // the one it was waiting for has been closed under it. Paused, the new
    // context waits for Play, which goes on from where the old one paused.
    if (programme === undefined) return;
    if (playing) this.#start(this.#openFor(profile, current.rate), programme, from);
    else if (mode === TransportMode.Paused && from !== undefined) {
      this.#resumeFrom = { key: programme.key, at: from };
    }
  }

  /**
   * Plays at the preview quality in force from now on. The context is kept;
   * the programme is loaded again at the new quality, playing on from where it
   * was if it was playing, and otherwise at the next Play from where it
   * stands.
   */
  usePreviewQuality(): void {
    const current = this.#opened;
    const session = current?.session;
    const programme = current?.loaded;
    if (current === undefined || session === undefined || programme === undefined) return;
    if (current.quality !== this.#quality()) this.#reload(current, session, programme);
  }

  /**
   * Follows the sound of the programme the transport holds, which the
   * project changed: `programme` is the same programme as it now stands.
   * Numeric parameters changed while it plays reach its running chains; any
   * other change, or one a chain cannot take running, loads it again, going
   * on from where it plays if it is playing and otherwise at the next Play.
   */
  follow(programme: Programme): void {
    const current = this.#opened;
    const session = current?.session;
    const loaded = current?.loaded;
    if (current === undefined || session === undefined || loaded?.key !== programme.key) return;
    const following = followingOf(loaded, programme);
    if (following.kind === 'reload') this.#reload(current, session, programme);
    if (following.kind !== 'running') return;
    // Followed now, so a change that follows this one is worked out from it.
    current.loaded = programme;
    void session.changeParameters(following.changes).then((taken) => {
      if (taken.ok || this.#opened !== current || current.loaded !== programme) return;
      this.#reload(current, session, programme);
      if (taken.failures.some((one) => one.code === 'playback.parameter-rendered')) {
        this.#announce('The change is heard once its preview is made again.');
      }
    }, this.#recorded('A change could not be given to playback.'));
  }

  /**
   * Loads `programme` again, as it now stands, going on from where it plays
   * if it is playing, and otherwise at the next Play from where it stands.
   */
  #reload(current: Opened, session: PlaybackSessionPort, programme: Programme): void {
    current.loaded = programme;
    current.stale = true;
    const mode = session.status.transport.mode;
    const position = session.position();
    const from = position.ok ? position.value : undefined;
    if (mode === TransportMode.Playing || mode === TransportMode.Suspended) {
      this.#start(current, programme, from);
    } else if (from !== undefined) {
      this.#resumeFrom = { key: programme.key, at: from };
    }
  }

  /** The timeline frame the listener hears, at the context's rate, or `undefined` with no session. */
  audiblePosition(): SampleCount | undefined {
    const heard = this.#opened?.session?.audiblePosition();
    return heard?.ok === true ? heard.value : undefined;
  }

  /**
   * Where the transport is, as a playhead shows it: the frame heard while it
   * plays, and the frame it stands at otherwise, which a seek while paused or
   * stopped moves at once. `undefined` with no session.
   */
  playheadPosition(): SampleCount | undefined {
    const session = this.#opened?.session;
    if (session === undefined) return undefined;
    const read =
      session.status.transport.mode === TransportMode.Playing
        ? session.audiblePosition()
        : session.position();
    return read.ok ? read.value : undefined;
  }

  /** Each meter's latest levels, read once a display frame, or none with no session. */
  meters(): ReadonlyMap<NodeId, MeterLevels> {
    return this.#opened?.session?.meters() ?? NO_METERS;
  }

  /** Lets go of the session and closes the context. */
  dispose(): void {
    if (this.#opened !== undefined) this.#close(this.#opened);
  }

  #openFor(profile: ChosenProfile, rate: number | undefined): Opened {
    const opened: Opened = {
      profile,
      rate,
      parts: this.#open(profile, rate),
      session: undefined,
      stopListening: undefined,
      loaded: undefined,
      quality: undefined,
      stale: false,
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
    // Nothing waits on the close, so a fault in it is recorded here, where
    // the diagnostic log shows it, rather than left to reach no one.
    void current.parts.close().catch(this.#recorded('The audio context could not be closed.'));
    this.#view.showPlayback(undefined);
  }

  /** What records a fault in work nothing awaits, saying what could not be done. */
  #recorded(what: string): (error: unknown) => void {
    return (error) => {
      this.#logger.error(what, { reason: messageOf(error) });
    };
  }

  #start(
    current: Opened,
    programme: Programme,
    from: SampleCount | undefined,
    andPlay = true,
  ): void {
    current.parts.startContext();
    this.#view.playbackStarting();
    // The Play the person pressed is waiting on this, so a fault in it ends
    // that Play with the reason and is recorded, rather than leaving the
    // transport starting for ever.
    void this.#run(current, programme, from, andPlay).catch((error: unknown) => {
      this.#logger.error('Playback stopped on a fault.', { reason: messageOf(error) });
      if (this.#opened === current) this.#close(current);
      this.#refused([`Playback stopped on a fault: ${messageOf(error)}`]);
    });
  }

  async #run(
    current: Opened,
    programme: Programme,
    from: SampleCount | undefined,
    andPlay: boolean,
  ): Promise<void> {
    let session: PlaybackSessionPort;
    try {
      session = await current.parts.session;
    } catch (error) {
      // The engine's code could not be loaded, a chunk the server no longer
      // has, which is all the session's promise waits on besides compiling
      // the DSP module, which answers a refusal rather than throwing.
      if (!(error instanceof Error)) throw error;
      if (this.#opened === current) this.#close(current);
      this.#refused([`The audio engine could not be started: ${error.message}`]);
      return;
    }
    if (!this.#adopt(current, session)) return;
    const ready = await this.#loaded(current, session, programme);
    // Closed while it loaded, by a change of profile whose own Play reports.
    if (this.#opened !== current) return;
    const moved = !ready.ok || from === undefined ? ready : await session.seek(from);
    if (andPlay) this.#settle(moved.ok ? await session.play() : moved, programme);
    else if (moved.ok) this.#view.playbackSettled([]);
    else this.#settle(moved, programme);
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

  /**
   * Loads `programme`, unless the session has it at the preview quality in
   * force or will load it again itself. The audio is described, at the
   * context's rate, and the feeder worker makes it: the page makes no audio of
   * its own.
   */
  #loaded(
    current: Opened,
    session: PlaybackSessionPort,
    programme: Programme,
  ): Promise<DomainResult<void>> {
    const { phase } = session.status;
    const quality = this.#quality();
    const holds =
      !current.stale &&
      current.loaded?.key === programme.key &&
      current.loaded.content === programme.content &&
      current.quality === quality;
    // Lost with its context, the graph is loaded again by the session's Play.
    if (holds && (phase === PlaybackPhase.Ready || phase === PlaybackPhase.Unloaded)) {
      return Promise.resolve(succeed(undefined));
    }
    const request = flatMapResult(current.parts.contextRate(), (rate) =>
      programme.request(rate, quality),
    );
    if (!request.ok) return Promise.resolve(request);
    current.loaded = programme;
    current.quality = quality;
    current.stale = false;
    return session.load(request.value);
  }

  /** Says how the Play ended. */
  #settle(result: DomainResult<void>, programme: Programme): void {
    if (result.ok) {
      this.#view.playbackSettled([]);
      this.#announce(programme.playing);
    } else if (result.failures.every((one) => one.code === PLAYBACK_SUPERSEDED)) {
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
