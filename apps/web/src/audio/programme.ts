/**
 * What the transport plays: an asset, or the test signal. One transport plays
 * one programme at a time; a programme says what it is, the rate its audio is
 * at, how to ask the session for it and what is said once it is heard.
 *
 * An asset plays at its native rate (REQ-ARCH-085): the audio context is made
 * at that rate, and the browser converts the context's output for the device,
 * so nothing in AudioGubbins resamples the asset to play it. The test signal
 * is made at whatever rate the context runs at.
 *
 * An asset's sound changes as the project does, so its programme says what
 * it is made from: the transport loads it again for a sound that changed,
 * and works out from its plan whether a change can be heard running instead.
 */

import type { DomainResult, EditPlan, QualityMode } from '@audiogubbins/domain';
import { runningChanges, type ParameterChange } from '@audiogubbins/audio-engine';
import type { PlaybackRequest } from '@audiogubbins/audio-runtime';

/** What the transport plays. */
export interface Programme {
  /** An asset's identity, or the test signal's. */
  readonly key: string;
  /** The rate its audio is at, which the context is made at; `undefined` to take the device's. */
  readonly rate: number | undefined;
  /** The request that plays it, in a context of `contextRate`, previewing at `quality`. */
  readonly request: (contextRate: number, quality: QualityMode) => DomainResult<PlaybackRequest>;
  /** What is said once it is heard. */
  readonly playing: string;
  /**
   * What its sound is made from, written out whole, where that can change: an
   * asset's content. Two programmes of one key and content sound alike.
   */
  readonly content?: string;
  /** The plan it plays, where it is an edited sound, which a running change is worked out from. */
  readonly plan?: EditPlan;
}

/**
 * How the transport follows `next`, the programme it holds as it now stands:
 * not at all where it sounds as before; by the numeric parameters it changes,
 * running, where that is all it changes; and otherwise by loading it again.
 */
export type Following =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'running'; readonly changes: readonly ParameterChange[] }
  | { readonly kind: 'reload' };

/** How the transport holding `loaded` follows `next` (see {@link Following}). */
export function followingOf(loaded: Programme, next: Programme): Following {
  if (loaded.content === next.content) return { kind: 'unchanged' };
  const changes =
    loaded.plan === undefined || next.plan === undefined
      ? undefined
      : runningChanges(loaded.plan, next.plan);
  if (changes === undefined) return { kind: 'reload' };
  return changes.length === 0 ? { kind: 'unchanged' } : { kind: 'running', changes };
}
