/**
 * How the tabs of one browser profile tell each other that the person's library
 * of saved chains and presets changed: a `BroadcastChannel` of one name, open
 * for the page's life, on which each change is a word and nothing more, since
 * every tab reads the library from storage itself (ADR-0060).
 *
 * A message never comes back to the channel that posted it, so a tab never
 * hears its own word. A browser that will not open the channel, or closes it
 * under the page, costs the tabs only the word: each still reads the library
 * again when the person comes back to it, so the warning is logged and nothing
 * fails.
 */

import type { Logger } from '@audiogubbins/diagnostics';

/**
 * How the tabs of one browser profile tell each other that the library changed:
 * a word said, never the change, since each tab reads the library itself.
 */
export interface LibraryChanges {
  /** Tells every other tab that the library changed. */
  readonly say: () => void;

  /** Hears another tab say so, until the answer is called. */
  readonly hear: (heard: () => void) => () => void;
}

/** The name of the channel the library's changes are said on. */
const LIBRARY_CHANNEL = 'audiogubbins.processing-library';

/** What is said on it: that the library changed. */
const CHANGED = 'changed';

/** The members of a `BroadcastChannel` the word takes. */
export interface WordChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

/** Opens a channel of a name, as `StoragePlatform.openBroadcastChannel` does. */
export type OpenWordChannel = (name: string) => WordChannel;

/**
 * The library's changes said and heard on the channel `open` opens, or on none
 * where it is absent or refuses (see the module comment).
 */
export function libraryChannel(open: OpenWordChannel | undefined, logger: Logger): LibraryChanges {
  const listeners = new Set<() => void>();
  const refused = (what: string, error: unknown): void => {
    // An opaque origin may refuse to open one, and a channel closed under the
    // page refuses to post, each with a `DOMException`; anything else is a
    // fault.
    if (!(error instanceof DOMException)) throw error;
    logger.warning(what, { reason: error.name });
  };
  let channel: WordChannel | undefined;
  try {
    channel = open?.(LIBRARY_CHANNEL);
  } catch (error) {
    refused('The browser refused the channel that tells other tabs the library changed.', error);
  }
  channel?.addEventListener('message', (event) => {
    if (event.data !== CHANGED) return;
    for (const listener of [...listeners]) listener();
  });
  return {
    say: () => {
      try {
        channel?.postMessage(CHANGED);
      } catch (error) {
        refused('The other tabs could not be told the library changed.', error);
      }
    },
    hear: (heard) => {
      listeners.add(heard);
      return () => {
        listeners.delete(heard);
      };
    },
  };
}
