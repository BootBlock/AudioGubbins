/**
 * The clipboard (ADR-0053): what the last copy or cut took, held by the page
 * for its session, replaced by each copy, and never persisted or sent
 * anywhere. It is not project state, so undo leaves it as it is.
 */

import type { ClipboardPayload } from '@audiogubbins/clipboard';

import { observable, type Observable } from './observable.js';

/** What the clipboard holds: the audio copied last, and what it was copied from. */
export interface ClipboardState {
  readonly copied: ClipboardPayload | undefined;
  /** What the copy is called, as a reader is told what a paste will bring. */
  readonly description: string | undefined;
}

/** The page's clipboard. */
export interface ClipboardStore extends Observable<ClipboardState> {
  /** Holds `copied` in place of whatever was held. */
  readonly hold: (copied: ClipboardPayload, description: string) => void;
}

/** Makes an empty clipboard. */
export function createClipboardStore(): ClipboardStore {
  const state = observable<ClipboardState>({ copied: undefined, description: undefined });
  return {
    get: state.get,
    subscribe: state.subscribe,
    hold: (copied, description) => {
      state.set({ copied, description });
    },
  };
}
