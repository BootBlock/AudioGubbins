/**
 * The page's game preview (`preview-runner.ts`): the renders the scenario set
 * up needs are asked for as it is set up, and a run waits until they are made,
 * so no voice waits on a measurement mid-run.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VOICE_VARIATION,
  DEFAULT_EMITTER_RULES,
  memberKey,
  type GamePreviewScenario,
  type GroupMember,
} from '@audiogubbins/game-audio';
import {
  QualityLevel,
  StandardLayouts,
  derivedSampleCount,
  instantiateProcessor,
  namedQualityMode,
  sampleRate,
  succeed,
  unsafeBrandId,
  type EditPlan,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import type { CachedStream, CachedStreams } from '@audiogubbins/audio-engine';
import { PROCESSOR_CATALOGUE } from '@audiogubbins/processors';

import { createGamePreviewStore } from '../state/game-preview-store.js';
import { PreviewRunner } from './preview-runner.js';
import type { PreviewPlayback } from './preview-run.js';
import type { PreviewSetup } from './preview-setup.js';
import type { Programme } from './programme.js';

const RATE = expectSuccess(sampleRate(48_000));
const MEMBER: GroupMember = { kind: 'region', region: unsafeBrandId<'RegionId'>('0000a000-0001') };

const NORMALISER = (() => {
  const found = PROCESSOR_CATALOGUE.get('loudness-normalisation');
  if (found === undefined) throw new Error('The catalogue has a loudness normaliser.');
  return found;
})();

/** A member's sound through a loudness normaliser, which measures its whole input first. */
const NORMALISED: EditPlan = {
  streams: [
    {
      sampleRate: RATE,
      layout: StandardLayouts.stereo,
      segments: [
        {
          source: { kind: 'stream', stream: 1 },
          start: derivedSampleCount(0),
          length: derivedSampleCount(4_800),
          reversed: false,
          stages: [],
        },
      ],
    },
    {
      sampleRate: RATE,
      layout: StandardLayouts.stereo,
      processing: {
        kind: 'chain',
        chain: {
          id: unsafeBrandId<'EffectChainId'>('c4000000-0001'),
          slots: [instantiateProcessor(unsafeBrandId<'ProcessorId'>('7e000000-0001'), NORMALISER)],
        },
        input: StandardLayouts.stereo,
      },
      segments: [
        {
          source: { kind: 'media', asset: unsafeBrandId<'AssetId'>('0000beef-0001') },
          start: derivedSampleCount(0),
          length: derivedSampleCount(4_800),
          reversed: false,
          stages: [],
        },
      ],
    },
  ],
};

const SCENARIO: GamePreviewScenario = {
  id: unsafeBrandId<'GamePreviewScenarioId'>('5ce00000-0001'),
  name: 'Normalised steps',
  space: '3d',
  panWidth: 1_000,
  panningStrength: 0.5,
  listener: { at: { x: 0, y: 0, z: 0 }, facingTurns: 0 },
  emitters: [
    {
      id: unsafeBrandId<'PreviewEmitterId'>('e0000000-0001'),
      name: 'Feet',
      subject: { kind: 'member', member: MEMBER },
      trigger: { kind: 'by-hand' },
      motion: { kind: 'still', at: { x: 0, y: 0, z: -2 } },
    },
  ],
  seed: 1,
  busLevels: [],
};

const SETUP: PreviewSetup = {
  scenario: SCENARIO,
  subjects: {
    emitterRules: () => DEFAULT_EMITTER_RULES,
    poolOf: () => [
      {
        member: MEMBER,
        variation: DEFAULT_VOICE_VARIATION,
        bus: undefined,
        sampleRate: RATE,
        length: 4_800,
      },
    ],
  },
  members: new Map([[memberKey(MEMBER), NORMALISED]]),
  media: [],
  rate: RATE,
  layout: StandardLayouts.stereo,
  budget: 64,
  catalogue: PROCESSOR_CATALOGUE,
};

/** A playback that holds what it is given. */
class HeldPlayback implements PreviewPlayback {
  loaded: Programme | undefined;
  play(programme: Programme): void {
    this.loaded = programme;
  }
  continue(): Promise<never> {
    return Promise.reject(new Error('Nothing here continues.'));
  }
  readFrame(): SampleCount | undefined {
    return undefined;
  }
  audiblePosition(): SampleCount | undefined {
    return undefined;
  }
  follow(): void {
    return undefined;
  }
  stop(): undefined {
    return undefined;
  }
  programme(): string | undefined {
    return this.loaded?.key;
  }
}

describe('the page’s game preview', () => {
  it('asks for its members’ renders as it is set up, and runs once they are made', async () => {
    const store = createGamePreviewStore();
    const finishes: (() => void)[] = [];
    const renders: CachedStreams = {
      open: (): CachedStream => ({
        ready: Promise.resolve(succeed(undefined)),
        read: () =>
          new Promise<void>((resolve) => {
            finishes.push(resolve);
          }),
        release: () => undefined,
      }),
    };
    const playback = new HeldPlayback();
    const runner = new PreviewRunner(store, {
      playback,
      schedule: () => () => undefined,
      now: () => 0,
      quality: () => namedQualityMode(QualityLevel.Draft).settings,
      renders: () => renders,
      setupOf: () => ({ ok: true, setup: SETUP }),
      changes: [],
    });

    store.open(SCENARIO, undefined);
    await Promise.resolve();

    expect(store.get().renders).toMatchObject({ needed: 1, made: 0 });
    expect(runner.start(SETUP).ok).toBe(false);
    expect(playback.loaded).toBeUndefined();

    for (const finish of finishes) finish();
    await expect.poll(() => store.get().renders.made).toBe(1);

    expect(runner.start(SETUP).ok).toBe(true);
    expect(playback.loaded?.key).toBe('game-preview:1');
    runner.dispose();
  });
});
