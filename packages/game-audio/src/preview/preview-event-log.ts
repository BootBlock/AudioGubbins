/**
 * What a game preview's simulation did, trigger by trigger and voice by voice
 * (ADR-0104): what its tests pin, the test vectors an engine's runtime is held
 * to, the panel's table, and what its plan is built from.
 *
 * Events are in the order the simulation made them, which is by frame: at one
 * frame, the voices that ended first, then each trigger in the order taken
 * (`preview-simulation.ts`), each with the voice it stole before the voice it
 * started. Voices are numbered from 0 in the order they started; a trigger is
 * its emitter's ordinal, a repeat's `k` or, by hand, the repeat count and then
 * the hand triggers in the order given.
 */

import type { GroupMember } from '../groups/membership.js';
import type { BusName } from '../policy/bus-name.js';
import type { PreviewEmitterId } from './preview-scenario.js';

/** A trigger that started a voice, with every choice it made. */
export interface StartedEvent {
  readonly kind: 'started';
  readonly frame: number;
  readonly emitter: PreviewEmitterId;
  readonly trigger: number;
  readonly voice: number;
  readonly lane: number;
  readonly member: GroupMember;
  readonly pitchCents: number;
  readonly gainDecibels: number;
  /** In the member's own frames, at its own rate. */
  readonly offsetFrames: number;
  /** The member's bus, `undefined` where none is set, which plays on Godot's `Master`. */
  readonly bus: BusName | undefined;
}

/**
 * A trigger that started nothing: within the cooldown (`suppressed`), past a
 * full emitter that rejects (`rejected`), or past the preview's voice budget
 * where the emitter rejects (`budget-rejected`).
 */
export interface RefusedEvent {
  readonly kind: 'suppressed' | 'rejected' | 'budget-rejected';
  readonly frame: number;
  readonly emitter: PreviewEmitterId;
  readonly trigger: number;
}

/**
 * A voice that stopped sounding: stolen by its emitter's limit (`stolen`) or
 * the preview's budget (`budget-stolen`), stopped by hand (`stopped`), each
 * fading out from `frame`, or played to its end (`ended`).
 */
export interface VoiceEndEvent {
  readonly kind: 'stolen' | 'budget-stolen' | 'stopped' | 'ended';
  readonly frame: number;
  readonly emitter: PreviewEmitterId;
  readonly voice: number;
}

export type PreviewEvent = StartedEvent | RefusedEvent | VoiceEndEvent;

export interface PreviewEventLog {
  /**
   * Every event before `horizonFrame`, in the order made, but for those a
   * simulation that plays for long has forgotten (`forgetPreviewBefore`).
   */
  readonly events: readonly PreviewEvent[];
  readonly horizonFrame: number;
  /** How many events were made before the first of `events`, and forgotten. */
  readonly forgotten: number;
}
