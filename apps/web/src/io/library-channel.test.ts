import { describe, expect, it } from 'vitest';

import { createDiagnosticCentre, createLogStore } from '@audiogubbins/diagnostics';

import { wordChannels } from '../testing/word-channels.js';
import { libraryChannel, type WordChannel } from './library-channel.js';

/**
 * The word the tabs say on the library's channel (ADR-0060): a tab hears every
 * other tab's word and never its own, hears nothing else said on the channel,
 * and a browser that refuses the channel costs the tabs the word and nothing
 * more.
 */

function logged() {
  const logs = createLogStore();
  return { logs, logger: createDiagnosticCentre(logs, { now: () => 0 }).loggerFor('projects') };
}

/** Settles once every delivery queued so far has arrived. */
async function delivered(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('the library’s channel', () => {
  it('tells every other tab, never the one that said it, and nothing else said on it', async () => {
    const channels = wordChannels();
    const { logger } = logged();
    const first = libraryChannel(channels.open, logger);
    const second = libraryChannel(channels.open, logger);
    const heard: string[] = [];
    first.hear(() => heard.push('first'));
    second.hear(() => heard.push('second'));
    const stray = channels.open('audiogubbins.processing-library');

    first.say();
    stray.postMessage({ changed: true });
    await delivered();

    expect(heard).toEqual(['second']);
  });

  it('costs only the word where the browser refuses to open the channel or to post on it', () => {
    const { logs, logger } = logged();
    const refusing = libraryChannel(() => {
      throw new DOMException('An opaque origin.', 'SecurityError');
    }, logger);
    const closed: WordChannel = {
      postMessage: () => {
        throw new DOMException('The channel is closed.', 'InvalidStateError');
      },
      addEventListener: () => undefined,
    };
    const closing = libraryChannel(() => closed, logger);

    refusing.say();
    closing.say();

    expect(logs.snapshot().map((record) => record.message)).toEqual([
      'The browser refused the channel that tells other tabs the library changed.',
      'The other tabs could not be told the library changed.',
    ]);
  });
});
