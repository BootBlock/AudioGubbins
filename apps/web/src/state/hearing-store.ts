/**
 * Which sound of an edited asset the transport plays (REQ-AUDIO-019): as it is
 * processed, or its original, every chain it runs bypassed and every other edit
 * kept, for comparing the two. A listening choice of the page, never project
 * state, so it is neither saved nor undone; it starts at the processed sound
 * with every page.
 */

import { observable, type Observable } from './observable.js';

/** Which sound of an asset is heard. */
export const Hearing = { Processed: 'processed', Original: 'original' } as const;

/** Which sound of an asset is heard. */
export type Hearing = (typeof Hearing)[keyof typeof Hearing];

/** Which sound of an asset the transport plays, and the one way it is changed. */
export interface HearingStore extends Observable<Hearing> {
  readonly choose: (hearing: Hearing) => void;
}

/** A store hearing the processed sound. */
export function createHearingStore(): HearingStore {
  const state = observable<Hearing>(Hearing.Processed);
  return { get: state.get, subscribe: state.subscribe, choose: state.set };
}
