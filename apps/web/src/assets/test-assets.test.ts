import { describe, expect, it } from 'vitest';

import {
  StandardLayouts,
  channelCount,
  labelledLayout,
  sampleCount,
  type SampleCount,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';
import {
  PcmDescriptionKind,
  REFERENCE_DSP,
  frameBlock,
  signalSource,
} from '@audiogubbins/audio-engine';

import { channelNames } from './channel-names.js';
import { revisionOf, type EditorAsset } from './editor-asset.js';
import { testAssets } from './test-assets.js';

const ASSETS = expectSuccess(testAssets());

function asset(id: string): EditorAsset {
  const found = ASSETS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`No test asset ${id}.`);
  return found;
}

/** The frames of `target` from `start`, `frames` long, made as a worker makes them. */
async function framesOf(
  target: EditorAsset,
  start: number,
  frames: number,
): Promise<readonly Float32Array[]> {
  const description = target.describe();
  if (description.kind !== PcmDescriptionKind.Signal) throw new Error('Not a recipe.');
  const source = expectSuccess(
    signalSource(REFERENCE_DSP, {
      layout: target.layout,
      sampleRate: target.sampleRate,
      recipe: description.recipe,
    }),
  );
  const channels = target.layout.roles.map(() => new Float32Array(frames));
  const block = expectSuccess(frameBlock(target.layout, target.sampleRate, channels));
  await source.read(expectSuccess(sampleCount(start)), block);
  source.release();
  return channels;
}

const peak = (samples: Float32Array): number =>
  samples.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0);

describe('the test assets', () => {
  it('are the five the editor offers, each at its native rate with a channel programme per channel', () => {
    expect(ASSETS.map((each) => each.id)).toEqual([
      'test:tone-bursts',
      'test:channel-identification-5.1',
      'test:ambisonic-first-order',
      'test:long-session',
      'test:loop',
    ]);
    for (const each of ASSETS) {
      const description = each.describe();
      expect(description.sampleRate).toBe(48_000);
      expect(
        description.kind === PcmDescriptionKind.Signal && description.recipe.channels,
      ).toHaveLength(channelCount(each.layout));
    }
  });

  it('describes the three-hour session in a recipe, never in samples', () => {
    const session = asset('test:long-session');

    expect(session.length).toBe(3 * 60 * 60 * 48_000);
    expect(JSON.stringify(session.describe()).length).toBeLessThan(2_000);
  });

  it('sounds each channel of the 5.1 set alone in its turn', async () => {
    const identification = asset('test:channel-identification-5.1');

    for (let turn = 0; turn < 6; turn += 1) {
      const heard = await framesOf(identification, turn * 96_000 + 10_000, 4_800);
      expect(heard.map((samples) => peak(samples) > 0.4)).toEqual(
        Array.from({ length: 6 }, (_, index) => index === turn),
      );
    }
  });

  it('reaches full scale in the tone bursts, which the waveform shows as clipping', async () => {
    const [left] = await framesOf(asset('test:tone-bursts'), 60_000, 12_000);

    expect(left?.[0]).toBe(1);
  });

  it('joins the looped region in phase: both loop points fall on the same point of the cycle', async () => {
    const loop = asset('test:loop');
    const [region] = loop.regions;
    const points = region?.loop;
    if (region === undefined || points === undefined) throw new Error('The loop test has no loop.');

    const at = async (offset: SampleCount): Promise<readonly number[]> =>
      (await framesOf(loop, region.start + offset, 4)).flatMap((samples) => [...samples]);

    expect(await at(points.loopEnd)).toEqual(await at(points.loopStart));
    expect(loop.markers.map((marker) => [marker.displayName, marker.position])).toEqual([
      ['Attack', 0],
      ['Sustain', 4_800],
      ['Release', 244_800],
    ]);
  });

  it('keeps each asset the same from one start to the next, identifiers included', () => {
    const again = expectSuccess(testAssets());

    expect(again.map((each) => [each.revision, each.markers, each.regions])).toEqual(
      ASSETS.map((each) => [each.revision, each.markers, each.regions]),
    );
  });
});

describe('a revision', () => {
  it('changes with the description it is taken from', () => {
    expect(revisionOf('{"a":1}')).toBe(revisionOf('{"a":1}'));
    expect(revisionOf('{"a":1}')).not.toBe(revisionOf('{"a":2}'));
    expect(revisionOf('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('channel names', () => {
  it('names every channel by its role, its component or its label', () => {
    expect(channelNames(StandardLayouts.surround5_1)).toEqual([
      'Left',
      'Right',
      'Centre',
      'Low-frequency effects',
      'Surround left',
      'Surround right',
    ]);
    expect(channelNames(asset('test:ambisonic-first-order').layout)).toEqual([
      'W (component 0)',
      'Y (component 1)',
      'Z (component 2)',
      'X (component 3)',
    ]);
    expect(channelNames(expectSuccess(labelledLayout(['Boom', 'Lav'])))).toEqual(['Boom', 'Lav']);
  });
});
