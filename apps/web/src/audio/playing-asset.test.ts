import { describe, expect, it } from 'vitest';

import { derivedSampleCount, unsafeBrandId, type EditPlan } from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { EditorAsset } from '../assets/editor-asset.js';
import { testAssets } from '../assets/test-assets.js';
import { Hearing, createHearingStore } from '../state/hearing-store.js';
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

/** A plan of a second of silence's media, standing for the one an original is made by. */
const PLAN: EditPlan = {
  streams: [
    {
      sampleRate: TEST_ASSET.sampleRate,
      layout: TEST_ASSET.layout,
      segments: [
        {
          source: { kind: 'media', asset: unsafeBrandId<'AssetId'>('00000000-asset') },
          start: derivedSampleCount(0),
          length: derivedSampleCount(48_000),
          reversed: false,
          stages: [],
        },
      ],
    },
  ],
};

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
      createHearingStore(),
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

  it('hands the transport the original sound once it is chosen, and the processed once that is', () => {
    const held: EditorAsset = {
      ...asset('one', 'processed'),
      original: {
        content: 'bypassed',
        layout: TEST_ASSET.layout,
        describe: TEST_ASSET.describe,
        plan: PLAN,
      },
    };
    const hearing = createHearingStore();
    const followed: Programme[] = [];
    followPlayingAsset({ subscribe: () => () => undefined, find: () => held }, hearing, {
      programme: () => 'one',
      follow: (programme) => {
        followed.push(programme);
      },
    });

    hearing.choose(Hearing.Original);
    hearing.choose(Hearing.Processed);

    expect(followed.map((programme) => [programme.key, programme.content])).toEqual([
      ['one', 'bypassed'],
      ['one', 'processed'],
    ]);
    expect(followed[0]?.plan).toBe(PLAN);
  });
});
