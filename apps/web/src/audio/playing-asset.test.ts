import { describe, expect, it } from 'vitest';

import { expectSuccess } from '@audiogubbins/domain/testing';

import type { EditorAsset } from '../assets/editor-asset.js';
import { testAssets } from '../assets/test-assets.js';
import { observable } from '../state/observable.js';
import { followPlayingAsset } from './playing-asset.js';
import type { Programme } from './programme.js';

/** The first of the session's test assets, which every asset here is a copy of. */
function testAsset(): EditorAsset {
  const [first] = expectSuccess(testAssets());
  if (first === undefined) throw new Error('The session has a test asset.');
  return first;
}

const TEST_ASSET = testAsset();

/** An asset of the session as the catalogue holds it, named `id`, of content `content`. */
function asset(id: string, content: string): EditorAsset {
  return { ...TEST_ASSET, id, content };
}

describe('playback following the asset it plays', () => {
  it('hands the transport each new state of the asset it holds, and of no other', () => {
    const held = new Map<string, EditorAsset>([['one', asset('one', 'first')]]);
    const catalogue = observable(0);
    const followed: Programme[] = [];
    let playing: string | undefined = 'one';
    const stop = followPlayingAsset(
      { subscribe: catalogue.subscribe, find: (id) => held.get(id) },
      {
        programme: () => playing,
        follow: (programme) => {
          followed.push(programme);
        },
      },
    );

    held.set('one', asset('one', 'second'));
    catalogue.update((count) => count + 1);
    expect(followed.map((programme) => [programme.key, programme.content])).toEqual([
      ['one', 'second'],
    ]);

    playing = 'two';
    catalogue.update((count) => count + 1);
    playing = undefined;
    catalogue.update((count) => count + 1);
    expect(followed).toHaveLength(1);

    stop();
    playing = 'one';
    catalogue.update((count) => count + 1);
    expect(followed).toHaveLength(1);
  });
});
