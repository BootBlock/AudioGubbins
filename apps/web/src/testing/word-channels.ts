/**
 * Broadcast channels in memory, which the windows of one test's browser
 * profile share as a profile's tabs share `BroadcastChannel`: a message is
 * cloned as the browser clones it and delivered in a later turn to every other
 * channel of its name, never to the one that posted it.
 */

import type { OpenWordChannel, WordChannel } from '../io/library-channel.js';

type Listener = (event: { readonly data: unknown }) => void;

/** One profile's channels, and every message posted on them. */
export interface WordChannels {
  readonly open: OpenWordChannel;
  /** Every message posted, by the channel's name, in order. */
  readonly posted: (readonly [string, unknown])[];
}

/** A profile's channels in memory (see the module comment). */
export function wordChannels(): WordChannels {
  const open: { readonly name: string; readonly listeners: Listener[] }[] = [];
  const posted: (readonly [string, unknown])[] = [];
  return {
    posted,
    open: (name) => {
      const listeners: Listener[] = [];
      const own = { name, listeners };
      open.push(own);
      const channel: WordChannel = {
        postMessage: (message) => {
          posted.push([name, message]);
          const data = structuredClone(message);
          for (const other of open) {
            if (other === own || other.name !== name) continue;
            void Promise.resolve().then(() => {
              for (const listener of other.listeners) listener({ data: structuredClone(data) });
            });
          }
        },
        addEventListener: (_type, listener) => {
          own.listeners.push(listener);
        },
      };
      return channel;
    },
  };
}
