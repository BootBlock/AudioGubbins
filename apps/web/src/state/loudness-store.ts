/**
 * The loudness of the members measured this session (ADR-0101): each member's
 * reading by its key, running, measured or failed, kept with the identity of
 * the audio it read, so a reader can tell when an edit since has made it
 * stale. A derived result of the session, never project state: nothing is
 * normalised because a member measured off its target, and the Asset groups
 * panel only says so beside the target its policy resolves.
 */

import type { LoudnessMeasurement } from '@audiogubbins/detection-runtime';

import { observable, type Observable } from './observable.js';

/** What a member's audio was made from when it was measured, and its name then. */
interface Measured {
  /** The audio's identity at the quality measured: its content and the final render's settings. */
  readonly identity: string;
  readonly name: string;
}

/** A member's reading of this session. */
export type LoudnessReading =
  | (Measured & {
      readonly kind: 'measuring';
      readonly framesRead: number;
      readonly framesTotal: number;
    })
  | (Measured & { readonly kind: 'measured'; readonly measurement: LoudnessMeasurement })
  | (Measured & { readonly kind: 'failed'; readonly reason: string })
  /** Waiting for the members before it in the same run. */
  | (Measured & { readonly kind: 'queued' });

/** Every member's reading, by its member key. */
export type LoudnessReadings = ReadonlyMap<string, LoudnessReading>;

/** The session's loudness readings, changed only by the measuring that makes them. */
export interface LoudnessStore extends Observable<LoudnessReadings> {
  /** Keeps `reading` as the member `key`'s. */
  readonly put: (key: string, reading: LoudnessReading) => void;

  /** Forgets the reading of the member `key`, as a measurement given up is. */
  readonly forget: (key: string) => void;
}

/** A store with no reading yet. */
export function createLoudnessStore(): LoudnessStore {
  const readings = observable<LoudnessReadings>(new Map());
  return {
    get: readings.get,
    subscribe: readings.subscribe,
    put: (key, reading) => {
      readings.update((current) => new Map([...current, [key, reading]]));
    },
    forget: (key) => {
      readings.update((current) => {
        if (!current.has(key)) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    },
  };
}
