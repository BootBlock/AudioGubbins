/**
 * A game preview's simulation as it runs (ADR-0104): every emitter's cursor,
 * cooldown, selection history, voices and lanes, the voices still to end, and
 * the count the voice budget is held to. One run is mutable and private to
 * the simulation that drives it; it is copied whole for a snapshot, so a later
 * simulation can go on from any point the snapshots mark.
 */

import { EndQueue } from './end-queue.js';
import type { SoundingVoice } from './voice-allocation.js';

/** A voice that counts against its emitter's limit and the preview's budget. */
export interface Voice extends SoundingVoice {
  /** The emitter's place in the scenario. */
  readonly emitter: number;
  /** The frame it ends at, played to its end; infinite for a loop. */
  readonly end: number;
}

/** The next repeat trigger of an emitter, taken in order of frames. */
export interface PendingRepeat {
  readonly k: number;
  readonly frame: number;
  /** Whether it is `k + 1` taken before `k`, its neighbour by a frame of rounding. */
  readonly ahead: boolean;
}

export class EmitterRun {
  /** The least repeat ordinal not yet taken. */
  cursor = 0;
  /** Whether `cursor + 1` was taken before `cursor`. */
  skip = false;
  /** The next repeat, where it has been worked out since the last was taken. */
  pending: PendingRepeat | undefined = undefined;
  /** How many hand triggers of this emitter were taken. */
  handTaken = 0;
  lastStarted: number | undefined = undefined;
  /** The pool indices chosen, most recent first. */
  recent: readonly number[] = [];
  /** In the order they started. */
  sounding: Voice[] = [];
  /** The frame each lane is free from. */
  laneFree: number[];

  constructor(lanes: number) {
    this.laneFree = Array.from({ length: lanes }, () => 0);
  }

  copy(): EmitterRun {
    const copied = new EmitterRun(0);
    copied.cursor = this.cursor;
    copied.skip = this.skip;
    copied.pending = this.pending;
    copied.handTaken = this.handTaken;
    copied.lastStarted = this.lastStarted;
    copied.recent = this.recent;
    copied.sounding = [...this.sounding];
    copied.laneFree = [...this.laneFree];
    return copied;
  }
}

export class SimulationRun {
  readonly emitters: readonly EmitterRun[];
  readonly ends: EndQueue;
  /** The number the next voice started takes. */
  nextVoice = 0;
  /** The voices sounding across every emitter. */
  sounding = 0;
  /** How many of the hand actions were taken. */
  handTaken = 0;

  constructor(emitters: readonly EmitterRun[], ends = new EndQueue()) {
    this.emitters = emitters;
    this.ends = ends;
  }

  copy(): SimulationRun {
    const copied = new SimulationRun(
      this.emitters.map((emitter) => emitter.copy()),
      this.ends.copy(),
    );
    copied.nextVoice = this.nextVoice;
    copied.sounding = this.sounding;
    copied.handTaken = this.handTaken;
    return copied;
  }
}

/** A run copied where every action before `at` was taken and none from it. */
export interface Snapshot {
  readonly at: number;
  readonly run: SimulationRun;
}
