/**
 * Hearing a loop by cycling it (ADR-0103, "Audition by cycling"): a lead-in
 * then the loop again and again, or the seam stress test, half a second either
 * side of the seam repeated, played as a programme of segments of the region's
 * own sound (`loopAuditionPlan`), so what is heard is exactly what the
 * region's plan makes, its loop's crossfade included.
 *
 * An audition lasts until it is stopped. Its plan holds a few seconds of
 * cycles, and before the feeder reaches its end the plan is extended by more
 * (`extendedAuditionPlan`), every segment before the old end unchanged, and the
 * transport goes on into it without stopping (ADR-0104's continued programme),
 * so the cycling is gapless. A candidate is heard from a plan whose loop is the
 * candidate's, without writing it to the region: nothing here changes the
 * project.
 *
 * The audition ends when the transport stops, pauses or plays anything else,
 * or a continuation is refused, which the playback control says.
 */

import {
  derivedSampleCount,
  streamLength,
  type EditPlan,
  type LoopDefinition,
  type SampleCount,
} from '@audiogubbins/domain';
import { TransportMode, type PcmDescription } from '@audiogubbins/audio-engine';
import {
  extendedAuditionPlan,
  loopAuditionPlan,
  type LoopAudition,
  type LoopAuditionMode,
} from '@audiogubbins/loop-analysis';
import { quoted } from '@audiogubbins/text';

import type { EditorAsset } from '../assets/editor-asset.js';
import type { AudioView } from '../state/audio-view-store.js';
import { Hearing } from '../state/hearing-store.js';
import { observable, type Observable } from '../state/observable.js';
import { assetProgramme } from './asset-playback.js';
import type { PlaybackControl } from './playback-control.js';
import type { Programme } from './programme.js';

/** How far past the feeder an audition keeps cycles planned, in seconds. */
const AHEAD_SECONDS = 2;

/** How much an extension adds at least, in seconds; the first plan holds as much. */
const STRETCH_SECONDS = 4;

/** The fewest cycles the first plan holds, so the seam is heard more than once. */
const FEWEST_CYCLES = 2;

/** How often the feeder's progress is looked at, in milliseconds. */
const WATCH_MS = 250;

/** Runs a callback after a delay, answering how to call it off: the page's timers (`browserSchedule`). */
type Schedule = (callback: () => void, milliseconds: number) => () => void;

/** A loop to hear, in a region whose plan is `heard`. */
export interface AuditionRequest {
  /** The region, by its identity in the project. */
  readonly region: string;
  /** What the region is called, for what is said. */
  readonly name: string;
  /** The region's sound, whose graph the audition plays through. */
  readonly sound: EditorAsset;
  /** The region's audio described with another plan, over the files it reads. */
  readonly describedWith: (plan: EditPlan) => PcmDescription;
  /** The region's plan with `loop` as its loop, its crossfade realised. */
  readonly heard: EditPlan;
  /** The loop heard, in region frames. */
  readonly loop: LoopDefinition;
  readonly mode: LoopAuditionMode;
  /** The candidate's rank, where the loop is a candidate's rather than the region's own. */
  readonly candidate?: number;
}

/** What is being heard. */
export interface Auditioning {
  readonly region: string;
  readonly name: string;
  readonly mode: LoopAuditionMode['kind'];
  readonly candidate?: number;
}

/** The audition playing, and its plan as the transport now holds it. */
interface Playing {
  readonly key: string;
  readonly request: AuditionRequest;
  readonly heard: Auditioning;
  audition: LoopAudition;
  /** Whether the transport has taken it, after which anything else it does ends the audition. */
  taken: boolean;
  /** Whether an extension is being gone on into. */
  extending: boolean;
  /** Stops watching the feeder. */
  unwatch: () => void;
}

/** The frames of a cycle of `audition`. */
function cycleFrames(audition: LoopAudition): number {
  return audition.cycle.reduce((sum, segment) => sum + segment.length, 0);
}

/** The cycles that hold at least `seconds` of `audition` at `rate`, and at least one. */
function cyclesFor(audition: LoopAudition, seconds: number, rate: number): number {
  return Math.max(1, Math.ceil((seconds * rate) / cycleFrames(audition)));
}

/** Where `audition`'s plan ends, in frames of its timeline. */
function endOf(audition: LoopAudition): number {
  return streamLength(audition.plan.streams[0]);
}

/** What is said once an audition is heard. */
function playingWords(heard: Auditioning): string {
  const what =
    heard.candidate === undefined ? 'loop' : `candidate ${String(heard.candidate)}’s loop`;
  return heard.mode === 'cycles'
    ? `Cycling the ${what} of ${quoted(heard.name)} until you stop it.`
    : `Stress-testing the seam of the ${what} of ${quoted(heard.name)} until you stop it.`;
}

/** The loop auditions of the session, one at a time, played on the transport. */
export class LoopAuditioning implements Observable<Auditioning | undefined> {
  readonly #playback: Pick<
    PlaybackControl,
    'play' | 'continue' | 'readFrame' | 'programme' | 'stop'
  >;
  readonly #audio: Observable<AudioView>;
  readonly #schedule: Schedule;
  readonly #heard = observable<Auditioning | undefined>(undefined);
  #playing: Playing | undefined;
  #auditions = 0;

  constructor(options: {
    readonly playback: Pick<
      PlaybackControl,
      'play' | 'continue' | 'readFrame' | 'programme' | 'stop'
    >;
    /** What the transport is doing, which ends an audition it no longer plays. */
    readonly audio: Observable<AudioView>;
    readonly schedule: Schedule;
  }) {
    this.#playback = options.playback;
    this.#audio = options.audio;
    this.#schedule = options.schedule;
  }

  readonly get = (): Auditioning | undefined => this.#heard.get();

  readonly subscribe = (listener: () => void): (() => void) => this.#heard.subscribe(listener);

  /** Plays `request`'s audition in place of what plays, answering why it cannot be heard. */
  start(request: AuditionRequest): string | undefined {
    const first = loopAuditionPlan(request.heard, request.loop, request.mode, 1);
    if (!first.ok) return first.failures[0].summary;
    const rate = request.sound.sampleRate;
    const cycles = Math.max(FEWEST_CYCLES, cyclesFor(first.value, STRETCH_SECONDS, rate));
    const audition = extendedAuditionPlan(first.value, cycles - 1);
    this.#end();
    this.#auditions += 1;
    const heard: Auditioning = {
      region: request.region,
      name: request.name,
      mode: request.mode.kind,
      ...(request.candidate === undefined ? {} : { candidate: request.candidate }),
    };
    const playing: Playing = {
      key: `loop-audition:${String(this.#auditions)}`,
      request,
      heard,
      audition,
      taken: false,
      extending: false,
      unwatch: () => undefined,
    };
    this.#playing = playing;
    this.#heard.set(heard);
    this.#playback.play(this.#programmeOf(playing, audition), derivedSampleCount(0));
    this.#watch(playing);
    return undefined;
  }

  /** Stops the audition playing, answering whether one was. */
  stop(): boolean {
    const playing = this.#playing;
    if (playing === undefined) return false;
    this.#end();
    if (this.#playback.programme() === playing.key) this.#playback.stop();
    return true;
  }

  /** Stops watching; what plays is the playback control's to stop. */
  dispose(): void {
    this.#end();
  }

  /** The programme that plays `audition` of `playing`, continuing what plays from `from` where given. */
  #programmeOf(playing: Playing, audition: LoopAudition, from?: SampleCount): Programme {
    const { request, key } = playing;
    const { plan } = audition;
    const sound: EditorAsset = {
      ...request.sound,
      content: `${key}\u0000${String(endOf(audition))}`,
      describe: () => request.describedWith(plan),
      owner:
        request.sound.owner.kind === 'project'
          ? { ...request.sound.owner, plan }
          : request.sound.owner,
    };
    return {
      ...assetProgramme(sound, Hearing.Processed),
      key,
      playing: playingWords(playing.heard),
      ...(from === undefined ? {} : { continues: { key, from } }),
    };
  }

  #watch(playing: Playing): void {
    playing.unwatch = this.#schedule(() => {
      this.#look(playing);
    }, WATCH_MS);
  }

  /** Looks at how far the feeder has read, extending the audition before it runs out. */
  #look(playing: Playing): void {
    if (this.#playing !== playing) return;
    if (!this.#stillPlaying(playing)) {
      this.#end();
      return;
    }
    const read = this.#playback.readFrame();
    const rate = playing.request.sound.sampleRate;
    if (
      !playing.extending &&
      read !== undefined &&
      endOf(playing.audition) - read < AHEAD_SECONDS * rate
    ) {
      void this.#extend(playing);
    }
    this.#watch(playing);
  }

  /** Whether the transport still plays `playing`, or is still starting it. */
  #stillPlaying(playing: Playing): boolean {
    const held = this.#playback.programme();
    const view = this.#audio.get();
    if (held === playing.key) playing.taken = true;
    // Until the transport takes it, the play is still starting, or it was
    // refused, which the playback control said.
    if (!playing.taken) return view.starting;
    if (held !== playing.key) return false;
    return view.starting || view.playback?.transport.mode === TransportMode.Playing;
  }

  /** Goes on into the audition with more cycles, from where its plan ends now. */
  async #extend(playing: Playing): Promise<void> {
    playing.extending = true;
    const rate = playing.request.sound.sampleRate;
    const extended = extendedAuditionPlan(
      playing.audition,
      cyclesFor(playing.audition, STRETCH_SECONDS, rate),
    );
    const from = derivedSampleCount(endOf(playing.audition));
    const outcome = await this.#playback.continue(
      this.#programmeOf(playing, extended, from),
      // Every segment from any later frame on is the extended plan's too.
      (later) => this.#programmeOf(playing, extended, later),
    );
    if (this.#playing !== playing) return;
    playing.extending = false;
    if (outcome.kind === 'refused') {
      this.#end();
      return;
    }
    playing.audition = extended;
  }

  #end(): void {
    this.#playing?.unwatch();
    this.#playing = undefined;
    this.#heard.set(undefined);
  }
}
