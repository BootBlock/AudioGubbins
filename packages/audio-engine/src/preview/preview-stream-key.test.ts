/**
 * The key a cached render is kept under, for what only a game preview's plan
 * holds (ADR-0104): a chain's automation, and a varispeed a processed stream
 * reads. Each decides the sound, so each is in the key; the identifiers of the
 * processors an automation moves are not, as the chain's own are not.
 */

import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  VARISPEED_DENOMINATOR,
  derivedSampleCount,
  sampleRate,
  unsafeBrandId,
  type EditPlan,
  type EffectChain,
  type ParameterAutomation,
  type ParameterId,
  type ProcessorId,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import { rackedMedia, rackedPlan } from '../testing/racked-plan.js';
import { cachedStreamKey } from './cached-stream-key.js';

const RATE = expectSuccess(sampleRate(48_000));
const LENGTH = 1_000;
const LEVEL = unsafeBrandId<'ParameterId'>('9a1e0001-0001');
const SAMPLES = [Float32Array.from({ length: LENGTH }, (_, frame) => frame / LENGTH)];

function processor(id: string): ProcessorInstance {
  return {
    kind: 'processor',
    id: unsafeBrandId<'ProcessorId'>(id),
    typeKey: 'test-gain',
    enabled: true,
    soloed: false,
    mix: 1,
    version: { implementation: 1, parameters: 1 },
    values: new Map<ParameterId, number>([[LEVEL, -6]]),
  };
}

/** Two processors, the second in a group's first branch, with identifiers from `tag`. */
function chainOf(tag: string): EffectChain {
  return {
    id: unsafeBrandId<'EffectChainId'>(`00000000-c4${tag}`),
    slots: [
      processor(`00000000-0e${tag}`),
      {
        kind: 'group',
        id: unsafeBrandId<'ProcessorGroupId'>(`00000000-9${tag}`),
        enabled: true,
        soloed: false,
        mix: 1,
        summing: 'sum',
        branches: [{ slots: [processor(`00000000-1e${tag}`)] }, { slots: [] }],
      },
    ],
  };
}

function lane(processorId: ProcessorId, to: number): ParameterAutomation {
  return {
    processor: processorId,
    parameter: LEVEL,
    points: [
      { frame: 0, value: -6 },
      { frame: 500, value: to },
    ],
  };
}

/** The racked plan with its chain moved by `automation` of `processorOf`'s processor. */
function automated(tag: string, to: number, inGroup: boolean): EditPlan {
  const chain = chainOf(tag);
  const [heard, racked] = rackedPlan(chain, LENGTH, RATE).streams;
  if (racked?.processing?.kind !== 'chain') throw new Error('A racked plan racks a stream.');
  const moved = unsafeBrandId<'ProcessorId'>(`00000000-${inGroup ? '1e' : '0e'}${tag}`);
  return {
    streams: [
      heard,
      { ...racked, processing: { ...racked.processing, automation: [lane(moved, to)] } },
    ],
  };
}

function keyOf(plan: EditPlan): string {
  return cachedStreamKey({
    plan,
    place: 1,
    media: [rackedMedia(SAMPLES, RATE)],
    quality: MAXIMUM_QUALITY.settings,
  });
}

describe('the key of a game preview’s processed stream', () => {
  it('changes with its chain’s automation and with which processor it moves', () => {
    const unmoved = keyOf(rackedPlan(chainOf('a1'), LENGTH, RATE));
    const moved = keyOf(automated('a1', -12, false));

    expect(moved).not.toBe(unmoved);
    expect(keyOf(automated('a1', -18, false))).not.toBe(moved);
    expect(keyOf(automated('a1', -12, true))).not.toBe(moved);
  });

  it('does not change with the identifiers of a copy of the chain it moves', () => {
    expect(keyOf(automated('b2', -12, true))).toBe(keyOf(automated('a1', -12, true)));
    expect(keyOf(automated('b2', -12, false))).toBe(keyOf(automated('a1', -12, false)));
  });

  it('changes with the ratio of a varispeed its stream reads', () => {
    const reading = (stream: number, length: number) => ({
      source: { kind: 'stream' as const, stream },
      start: derivedSampleCount(0),
      length: derivedSampleCount(length),
      reversed: false,
      stages: [],
    });
    const atRatio = (numerator: number): EditPlan => {
      const [, racked, ...rest] = rackedPlan(chainOf('a1'), LENGTH, RATE).streams;
      const [file] = rest;
      if (racked === undefined || file !== undefined)
        throw new Error('A racked plan has two streams.');
      const played = Math.ceil((LENGTH * VARISPEED_DENOMINATOR) / numerator);
      const { layout } = racked;
      return {
        streams: [
          { sampleRate: RATE, layout, segments: [reading(1, played)] },
          { ...racked, segments: [reading(2, played)] },
          {
            sampleRate: RATE,
            layout,
            segments: [reading(3, LENGTH)],
            processing: { kind: 'varispeed', numerator, denominator: VARISPEED_DENOMINATOR },
          },
          { sampleRate: RATE, layout, segments: racked.segments },
        ],
      };
    };

    expect(keyOf(atRatio(5_000))).not.toBe(keyOf(atRatio(5_001)));
  });
});
