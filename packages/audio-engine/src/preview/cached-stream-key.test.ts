import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_QUALITY,
  StandardLayouts,
  derivedSampleCount,
  namedQualityMode,
  sampleRate,
  unsafeBrandId,
  type EditPlan,
  type EffectChain,
  type ParameterId,
  type ProcessorInstance,
} from '@audiogubbins/domain';
import { expectSuccess } from '@audiogubbins/domain/testing';

import type { CachedStreamRequest } from '../pcm/cached-streams.js';
import { RACKED_ASSET, rackedMedia, rackedPlan } from '../testing/racked-plan.js';
import { cachedStreamKey } from './cached-stream-key.js';

const RATE = expectSuccess(sampleRate(48_000));
const LENGTH = 1_000;
const LEVEL = unsafeBrandId<'ParameterId'>('9a1e0001-0001');
const SHAPE = unsafeBrandId<'ParameterId'>('9a1e0001-0002');

function model(version: string) {
  return { pack: 'test-pack', version, modelHash: 'a'.repeat(64), runtimeHash: 'b'.repeat(64) };
}

function processor(values: ReadonlyMap<ParameterId, number | string>, version = '1.0.0') {
  return {
    kind: 'processor',
    id: unsafeBrandId<'ProcessorId'>('00000000-0e01'),
    typeKey: 'test-model',
    enabled: true,
    soloed: false,
    mix: 1,
    version: { implementation: 1, parameters: 1, model: model(version) },
    values,
  } satisfies ProcessorInstance;
}

function chainOf(slot: ProcessorInstance, id = '00000000-c4a1'): EffectChain {
  return { id: unsafeBrandId<'EffectChainId'>(id), slots: [slot] };
}

const VALUES = new Map<ParameterId, number | string>([
  [LEVEL, -6],
  [SHAPE, 'soft'],
]);
const SAMPLES = [Float32Array.from({ length: LENGTH }, (_, frame) => frame / LENGTH)];

function request(plan: EditPlan, place = 1, overrides: Partial<CachedStreamRequest> = {}) {
  return {
    plan,
    place,
    media: [rackedMedia(SAMPLES, RATE)],
    quality: MAXIMUM_QUALITY.settings,
    ...overrides,
  };
}

const BASE = cachedStreamKey(request(rackedPlan(chainOf(processor(VALUES)), LENGTH, RATE)));

/**
 * The plan with stream 1 moved to place 2 behind a stream nothing reads, as a
 * rack edit renumbers the streams after the one it adds.
 */
function renumbered(chain: EffectChain): EditPlan {
  const [first, second] = rackedPlan(chain, LENGTH, RATE).streams;
  if (second === undefined) throw new Error('A racked plan has two streams.');
  const unread = {
    sampleRate: RATE,
    layout: StandardLayouts.mono,
    segments: [
      {
        source: { kind: 'media' as const, asset: RACKED_ASSET },
        start: derivedSampleCount(0),
        length: derivedSampleCount(10),
        reversed: false,
        stages: [],
      },
    ],
  };
  return {
    streams: [
      {
        ...first,
        segments: first.segments.map((one) => ({ ...one, source: { kind: 'stream', stream: 2 } })),
      },
      unread,
      second,
    ],
  };
}

/**
 * A plan `depth` streams deep in which each stream reads the next twice, as a
 * rack edit and a cut over it make: stream 0 is heard, the last reads the
 * file through the chain.
 */
function doublyRead(depth: number, chain: EffectChain): EditPlan {
  const half = derivedSampleCount(LENGTH / 2);
  const layout = StandardLayouts.mono;
  const streams: EditPlan['streams'][number][] = [];
  for (let place = 0; place < depth; place += 1) {
    const source = { kind: 'stream' as const, stream: place + 1 };
    streams.push({
      sampleRate: RATE,
      layout,
      segments: [0, LENGTH / 2].map((start) => ({
        source,
        start: derivedSampleCount(start),
        length: half,
        reversed: false,
        stages: [],
      })),
    });
  }
  const [, last] = rackedPlan(chain, LENGTH, RATE).streams;
  const [first] = streams;
  if (last === undefined || first === undefined) throw new Error('The plan has two streams.');
  return { streams: [first, ...streams.slice(1), last] };
}

describe('the key a cached render is kept under', () => {
  it('grows with the plan, not with the ways through it', () => {
    // Each stream written once per reader made the text double at every
    // level: 30 levels threw "Invalid string length".
    const chain = chainOf(processor(VALUES));
    const shallow = cachedStreamKey(request(doublyRead(15, chain), 0)).length;
    const deep = cachedStreamKey(request(doublyRead(30, chain), 0)).length;
    expect(deep).toBeLessThan(shallow * 3);
  });

  it('tells a stream read twice from two streams that sound different', () => {
    const plan = doublyRead(1, chainOf(processor(VALUES)));
    const [heard, read] = plan.streams;
    if (read === undefined) throw new Error('The plan has two streams.');
    const louder = chainOf(processor(new Map(VALUES).set(LEVEL, -3)));
    const other = {
      ...read,
      processing: { kind: 'chain' as const, chain: louder, input: read.layout },
    };
    const [first, second] = heard.segments;
    if (first === undefined || second === undefined) throw new Error('Stream 0 has two segments.');
    const apart: EditPlan = {
      streams: [
        { ...heard, segments: [first, { ...second, source: { kind: 'stream', stream: 2 } }] },
        read,
        other,
      ],
    };
    expect(cachedStreamKey(request(apart, 0))).not.toBe(cachedStreamKey(request(plan, 0)));
    // The same plan with its second stream a copy of the first sounds the same.
    const copied: EditPlan = { streams: [apart.streams[0], read, read] };
    expect(cachedStreamKey(request(copied, 0))).toBe(cachedStreamKey(request(plan, 0)));
  });

  it('changes with a parameter value, the quality and a model version', () => {
    const louder = new Map(VALUES).set(LEVEL, -3);
    expect(cachedStreamKey(request(rackedPlan(chainOf(processor(louder)), LENGTH, RATE)))).not.toBe(
      BASE,
    );
    const shaped = new Map(VALUES).set(SHAPE, 'hard');
    expect(cachedStreamKey(request(rackedPlan(chainOf(processor(shaped)), LENGTH, RATE)))).not.toBe(
      BASE,
    );
    expect(
      cachedStreamKey(
        request(rackedPlan(chainOf(processor(VALUES)), LENGTH, RATE), 1, {
          quality: namedQualityMode('draft').settings,
        }),
      ),
    ).not.toBe(BASE);
    expect(
      cachedStreamKey(request(rackedPlan(chainOf(processor(VALUES, '1.0.1')), LENGTH, RATE))),
    ).not.toBe(BASE);
  });

  it('changes with the file its stream reads, by what the file is known by', () => {
    expect(
      cachedStreamKey(
        request(rackedPlan(chainOf(processor(VALUES)), LENGTH, RATE), 1, {
          media: [rackedMedia(SAMPLES, RATE, 'memory:another')],
        }),
      ),
    ).not.toBe(BASE);
  });

  it('does not change with what does not decide the sound', () => {
    // The same values set in another order, as a command may rebuild them.
    const reordered = new Map([...VALUES].reverse());
    expect(cachedStreamKey(request(rackedPlan(chainOf(processor(reordered)), LENGTH, RATE)))).toBe(
      BASE,
    );
    // A copy of the chain, with new identifiers for it and its slot.
    const copied = chainOf(
      { ...processor(VALUES), id: unsafeBrandId<'ProcessorId'>('00000000-0e02') },
      '00000000-c4a2',
    );
    expect(cachedStreamKey(request(rackedPlan(copied, LENGTH, RATE)))).toBe(BASE);
    // The stream at another place, after a rack edit added one before it.
    expect(cachedStreamKey(request(renumbered(chainOf(processor(VALUES))), 2))).toBe(BASE);
    // Why playback hears it from a render is said, not heard.
    expect(
      cachedStreamKey(
        request(rackedPlan(chainOf(processor(VALUES)), LENGTH, RATE), 1, {
          reason: 'It measures the whole of its input first.',
        }),
      ),
    ).toBe(BASE);
  });
});
