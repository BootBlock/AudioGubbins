import type { CodecEnvironment } from '@audiogubbins/codecs';
import { describe, expect, it } from 'vitest';

import { createCodecEnvironmentStore } from './codec-environment.js';

/** What a page knows before its codec worker has said anything. */
function unstartedEnvironment(webAssembly: boolean): CodecEnvironment {
  return {
    webAssembly,
    codecModule: 'not-loaded',
    prebuiltModules: new Map(),
    browserDecoders: new Set(),
    browserEncoders: new Set(),
  };
}

describe('the codecs’ environment as the page holds it', () => {
  it('knows at first only whether WebAssembly runs', () => {
    const store = createCodecEnvironmentStore(false);

    expect(store.get()).toEqual(unstartedEnvironment(false));
    expect(store.capability('flac', 'write')).toMatchObject({
      kind: 'unavailable',
      reason: 'Exporting FLAC needs WebAssembly, which this browser does not run.',
    });
    // The application's own codecs need nothing.
    expect(store.capability('pcm', 'write')).toMatchObject({ kind: 'available' });
  });

  it('takes each environment the worker sends in place of the one before, telling its readers', () => {
    const store = createCodecEnvironmentStore(true);
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });

    store.adopt({
      ...unstartedEnvironment(true),
      prebuiltModules: new Map([['mp3', 'failed']]),
      browserEncoders: new Set(['aac-lc']),
    });

    expect(told).toBe(1);
    expect(store.capability('mp3', 'write')).toMatchObject({
      kind: 'unavailable',
      reason: 'The MP3 encoder could not be loaded, so MP3 cannot be exported here.',
    });
    expect(store.capability('aac-lc', 'write')).toMatchObject({ kind: 'available' });

    store.adopt(unstartedEnvironment(true));

    expect(told).toBe(2);
    expect(store.capability('mp3', 'write')).toMatchObject({ kind: 'available' });
    expect(store.capability('aac-lc', 'write')).toMatchObject({ kind: 'unavailable' });
  });
});
